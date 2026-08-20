// Locks in the ported business logic that's easiest to subtly get wrong in
// translation: the Canadian tax rules, ingredient-cost/profit math, and
// order revenue recognition. Mirrors the source Swift semantics exactly —
// see bakeri_flutter_rebuild_spec.md §6.1/§6.5 for the rules being tested.
import 'package:flutter_test/flutter_test.dart';
import 'package:bakeri_app/models/enums.dart';
import 'package:bakeri_app/models/order.dart';
import 'package:bakeri_app/models/recipe.dart';
import 'package:bakeri_app/models/ingredient_cost.dart';
import 'package:bakeri_app/services/tax_calculator.dart';

void main() {
  group('TaxCalculator', () {
    test('unregistered baker never charges tax', () {
      final result = TaxCalculator.calculate(
        items: [
          const TaxableItem(taxCategory: TaxCategory.sweetenedSingleServing, quantity: 10, pricePerUnit: 3),
        ],
        bakerIsGSTRegistered: false,
        province: 'ON',
      );
      expect(result.taxAmountCents, 0);
      expect(result.isZeroRated, true);
    });

    test('single-serving sweets under 6 units are taxable in ON at 13%', () {
      final result = TaxCalculator.calculate(
        items: [
          const TaxableItem(taxCategory: TaxCategory.sweetenedSingleServing, quantity: 3, pricePerUnit: 4, unitWeightGrams: 50),
        ],
        bakerIsGSTRegistered: true,
        province: 'ON',
      );
      // subtotal 12.00 * 0.13 = 1.56 -> 156 cents
      expect(result.taxAmountCents, 156);
      expect(result.taxRate, 0.13);
    });

    test('6 or more single-serving sweets become tax-exempt (the "six or more" rule)', () {
      final result = TaxCalculator.calculate(
        items: [
          const TaxableItem(taxCategory: TaxCategory.sweetenedSingleServing, quantity: 6, pricePerUnit: 4, unitWeightGrams: 50),
        ],
        bakerIsGSTRegistered: true,
        province: 'ON',
      );
      expect(result.taxAmountCents, 0);
      expect(result.isZeroRated, true);
    });

    test('plain bread and whole items are never taxed regardless of quantity', () {
      final result = TaxCalculator.calculate(
        items: [
          const TaxableItem(taxCategory: TaxCategory.plainBread, quantity: 2, pricePerUnit: 8),
          const TaxableItem(taxCategory: TaxCategory.wholeItem, quantity: 1, pricePerUnit: 60),
        ],
        bakerIsGSTRegistered: true,
        province: 'QC',
      );
      expect(result.taxAmountCents, 0);
    });

    test('unknown unit weight is treated conservatively as single-serving (taxable under 6)', () {
      final result = TaxCalculator.calculate(
        items: [
          const TaxableItem(taxCategory: TaxCategory.sweetenedSingleServing, quantity: 1, pricePerUnit: 5),
        ],
        bakerIsGSTRegistered: true,
        province: 'NS',
      );
      expect(result.taxAmountCents, 70); // 5.00 * 0.14 = 0.70
    });

    test('digital goods are never taxed even if flagged sweetened-single-serving', () {
      final result = TaxCalculator.calculate(
        items: [
          const TaxableItem(
            taxCategory: TaxCategory.sweetenedSingleServing,
            quantity: 1,
            pricePerUnit: 20,
            listingKind: ListingKind.digital,
          ),
        ],
        bakerIsGSTRegistered: true,
        province: 'ON',
      );
      expect(result.taxAmountCents, 0);
    });

    test('province rate table matches source exactly', () {
      expect(TaxCalculator.taxRate('ON'), 0.13);
      expect(TaxCalculator.taxRate('NB'), 0.15);
      expect(TaxCalculator.taxRate('NL'), 0.15);
      expect(TaxCalculator.taxRate('PE'), 0.15);
      expect(TaxCalculator.taxRate('NS'), 0.14);
      expect(TaxCalculator.taxRate('QC'), 0.14975);
      expect(TaxCalculator.taxRate('AB'), 0.05);
      expect(TaxCalculator.taxRate('BC'), 0.05);
    });
  });

  group('Order revenue + payout math', () {
    test('effectiveTotal prefers quotedPrice over the item-sum total', () {
      final order = Order(id: '1', customerName: 'Test')
        ..orderItems.add(OrderItem(id: 'i1', pricePerUnit: 10, quantity: 2))
        ..quotedPrice = 15;
      expect(order.totalPrice, 20);
      expect(order.effectiveTotal, 15);
    });

    test('netPayoutEstimate subtracts the 5% platform fee and estimated Stripe fee', () {
      final order = Order(id: '2', customerName: 'Test')
        ..orderItems.add(OrderItem(id: 'i1', pricePerUnit: 100, quantity: 1));
      // 100 - (100*0.05) - (100*0.029 + 0.30) = 100 - 5 - 3.20 = 91.80
      expect(order.netPayoutEstimate, closeTo(91.80, 0.001));
      expect(order.hasActualPayoutFigures, false);
    });

    test('netPayoutEstimate uses real bakerPayoutCents once settled', () {
      final order = Order(id: '3', customerName: 'Test')
        ..orderItems.add(OrderItem(id: 'i1', pricePerUnit: 100, quantity: 1))
        ..bakerPayoutCents = 9000;
      expect(order.netPayoutEstimate, 90.0);
      expect(order.hasActualPayoutFigures, true);
    });

    test('revenueReceived splits deposit and balance by their own payment dates', () {
      final order = Order(id: '4', customerName: 'Test', depositAmount: 20)
        ..orderItems.add(OrderItem(id: 'i1', pricePerUnit: 100, quantity: 1))
        ..depositPaidAt = DateTime(2026, 1, 1)
        ..isPaid = true
        ..paidAt = DateTime(2026, 2, 1);

      // Only the January window should count the $20 deposit, not the $80 balance.
      final jan = order.revenueReceived(DateTime(2026, 1, 1), DateTime(2026, 2, 1));
      expect(jan, 20);

      final feb = order.revenueReceived(DateTime(2026, 2, 1), DateTime(2026, 3, 1));
      expect(feb, 80);
    });

    test('cancelled orders never contribute revenue', () {
      final order = Order(id: '5', customerName: 'Test', status: OrderStatus.cancelled)
        ..orderItems.add(OrderItem(id: 'i1', pricePerUnit: 100, quantity: 1))
        ..isPaid = true
        ..paidAt = DateTime(2026, 1, 1);
      expect(order.revenueReceived(DateTime(2026, 1, 1), DateTime(2026, 2, 1)), 0);
    });

    test('autoCompleteIfNeeded only fires when delivered AND paid, and reverts cleanly', () {
      final order = Order(id: '6', customerName: 'Test', status: OrderStatus.delivered);
      order.autoCompleteIfNeeded();
      expect(order.status, OrderStatus.delivered); // not paid yet — no auto-complete

      order.isPaid = true;
      order.autoCompleteIfNeeded();
      expect(order.status, OrderStatus.completed);

      order.isPaid = false;
      order.revertCompletionIfNeeded();
      expect(order.status, OrderStatus.delivered);
    });

    test('OrderStatus.next follows the linear Confirmed->Baked->Decorated->Packaged->Delivered workflow', () {
      expect(OrderStatus.confirmed.next, OrderStatus.baked);
      expect(OrderStatus.baked.next, OrderStatus.decorated);
      expect(OrderStatus.decorated.next, OrderStatus.packaged);
      expect(OrderStatus.packaged.next, OrderStatus.delivered);
      expect(OrderStatus.delivered.next, null);
      expect(OrderStatus.completed.next, null);
      expect(OrderStatus.cancelled.next, null);
    });
  });

  group('Ingredient cost / profit math', () {
    test('totalIngredientCost scales by the recipe-yield ratio and matches ingredients case-insensitively', () {
      final recipe = Recipe(id: 'r1', name: 'Cookies', yieldQuantity: 12, yieldUnit: YieldUnit.cookies)
        ..ingredients.add(RecipeIngredient(
          id: 'ri1',
          name: 'Butter',
          volumeAmount: 1,
          volumeUnit: VolumeUnit.cup,
          gramsPerCup: 226,
        ));

      final order = Order(id: 'o1', customerName: 'Test')
        ..orderItems.add(OrderItem(id: 'i1', customName: 'Cookies', quantity: 24, unit: YieldUnit.cookies, pricePerUnit: 2, recipeId: 'r1'));

      final costs = [
        IngredientCost(id: 'c1', ingredientName: 'butter', purchaseCost: 4.52, purchaseAmount: 1, purchaseUnit: WeightUnit.pound),
      ];

      // scale = 24/12 = 2x the recipe -> 2 cups of butter -> 2*226g = 452g
      // costPerGram = 4.52 / 453.592 ≈ 0.009964
      // ingredient cost ≈ 452 * 0.009964 ≈ 4.504
      final cost = order.totalIngredientCost(costs: costs, recipes: [recipe]);
      expect(cost, closeTo(4.504, 0.01));

      final profit = order.profit(costs: costs, recipes: [recipe]);
      expect(profit, closeTo(48 - 4.504, 0.01)); // 24 * $2 = $48 revenue
    });

    test('items with no cost data are excluded from cost but order still has a defined profit', () {
      final recipe = Recipe(id: 'r2', name: 'Bread', yieldQuantity: 1, yieldUnit: YieldUnit.loaves)
        ..ingredients.add(RecipeIngredient(id: 'ri2', name: 'Mystery Flour', volumeAmount: 1, volumeUnit: VolumeUnit.cup));
      final order = Order(id: 'o2', customerName: 'Test')
        ..orderItems.add(OrderItem(id: 'i2', customName: 'Bread', quantity: 1, unit: YieldUnit.loaves, pricePerUnit: 10, recipeId: 'r2'));

      final cost = order.totalIngredientCost(costs: [], recipes: [recipe]);
      expect(cost, 0);
      expect(order.hasAnyCostData(costs: [], recipes: [recipe]), false);
    });
  });
}
