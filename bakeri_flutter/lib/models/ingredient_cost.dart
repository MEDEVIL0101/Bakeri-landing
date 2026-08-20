// Ported 1:1 from Bakerly/Bakerly/Bakeri/Models/IngredientCost.swift.
import 'enums.dart';
import 'order.dart';
import 'recipe.dart';
import '../utils/extensions.dart';

/// Stores the purchase price for a named ingredient so the app can
/// calculate cost-of-goods for each order.
/// Example: "All Purpose Flour — $9.99 for 20 lb"
class IngredientCost {
  String id;
  String ingredientName;
  double purchaseCost; // total price paid (e.g. 9.99)
  double purchaseAmount; // quantity purchased (e.g. 20)
  WeightUnit purchaseUnit;
  DateTime createdAt;
  DateTime updatedAt;

  IngredientCost({
    required this.id,
    required this.ingredientName,
    required this.purchaseCost,
    required this.purchaseAmount,
    this.purchaseUnit = WeightUnit.pound,
    DateTime? createdAt,
  })  : createdAt = createdAt ?? DateTime.now(),
        updatedAt = createdAt ?? DateTime.now();

  void touch() => updatedAt = DateTime.now();

  /// Derived cost per gram from the purchase price and quantity.
  double get costPerGram {
    final totalGrams = purchaseAmount * purchaseUnit.toGrams;
    if (totalGrams <= 0 || purchaseCost <= 0) return 0;
    return purchaseCost / totalGrams;
  }
}

/// Per-ingredient breakdown row (used by FinancialReportView).
class IngredientLineItem {
  final String ingredient;
  final double weightGrams;
  final double costPerGram;
  const IngredientLineItem({required this.ingredient, required this.weightGrams, required this.costPerGram});
  double get lineCost => weightGrams * costPerGram;
}

class IngredientAmount {
  final String ingredient;
  final double weightGrams;
  final bool hasCostData;
  final double costPerGram; // 0 when hasCostData == false
  const IngredientAmount({
    required this.ingredient,
    required this.weightGrams,
    required this.hasCostData,
    required this.costPerGram,
  });
  double get lineCost => weightGrams * costPerGram;
}

/// Order cost-of-goods helpers — ported 1:1 from Order.swift's
/// IngredientCost.swift extension.
extension OrderIngredientCosting on Order {
  /// Total ingredient cost for this order, based on the supplied cost list.
  /// Only counts order items linked to a Recipe with known ingredient
  /// costs. Pass `recipes` to enable name-based fallback for items whose
  /// recipe link is null.
  double totalIngredientCost({required List<IngredientCost> costs, List<Recipe> recipes = const []}) {
    if (costs.isEmpty) return 0;
    final costMap = <String, IngredientCost>{};
    for (final c in costs) {
      costMap[c.ingredientName.toLowerCase()] = c;
    }
    final recipeByName = <String, Recipe>{};
    for (final r in recipes) {
      recipeByName[r.name.toLowerCase()] = r;
    }
    var total = 0.0;
    for (final item in orderItems) {
      final recipe = _resolveRecipe(item, recipeByName);
      if (recipe == null) continue;
      final scale = _ingredientScaleFactor(
        itemQty: item.quantity,
        itemUnit: item.unit,
        recipeYield: recipe.yieldQuantity,
        recipeUnit: recipe.yieldUnit,
      );
      var itemCost = 0.0;
      for (final ing in recipe.sortedIngredients) {
        final cost = costMap[ing.name.toLowerCase()];
        if (cost == null) continue;
        itemCost += _ingredientWeightInGrams(ing) * scale * cost.costPerGram;
      }
      total += itemCost;
    }
    return total;
  }

  /// Returns ALL ingredients used across every recipe item in this order,
  /// whether or not they have a matching cost entry. Items without cost
  /// data will have `hasCostData == false` and `costPerGram == 0`.
  List<IngredientAmount> allIngredientAmounts({required List<IngredientCost> costs, List<Recipe> recipes = const []}) {
    final costMap = <String, IngredientCost>{};
    for (final c in costs) {
      costMap[c.ingredientName.toLowerCase()] = c;
    }
    final recipeByName = <String, Recipe>{};
    for (final r in recipes) {
      recipeByName[r.name.toLowerCase()] = r;
    }
    final result = <IngredientAmount>[];
    for (final item in orderItems) {
      final recipe = _resolveRecipe(item, recipeByName);
      if (recipe == null) continue;
      final scale = _ingredientScaleFactor(
        itemQty: item.quantity,
        itemUnit: item.unit,
        recipeYield: recipe.yieldQuantity,
        recipeUnit: recipe.yieldUnit,
      );
      for (final ing in recipe.sortedIngredients) {
        final grams = _ingredientWeightInGrams(ing) * scale;
        if (grams <= 0) continue;
        final entry = costMap[ing.name.toLowerCase()];
        result.add(IngredientAmount(
          ingredient: ing.name,
          weightGrams: grams,
          hasCostData: entry != null,
          costPerGram: entry?.costPerGram ?? 0,
        ));
      }
    }
    return result;
  }

  /// Full ingredient cost breakdown for every recipe item in this order.
  /// Only includes ingredients that have a matching entry in `costs`.
  List<IngredientLineItem> ingredientCostBreakdown({required List<IngredientCost> costs, List<Recipe> recipes = const []}) {
    if (costs.isEmpty) return [];
    final costMap = <String, IngredientCost>{};
    for (final c in costs) {
      costMap[c.ingredientName.toLowerCase()] = c;
    }
    final recipeByName = <String, Recipe>{};
    for (final r in recipes) {
      recipeByName[r.name.toLowerCase()] = r;
    }
    final result = <IngredientLineItem>[];
    for (final item in orderItems) {
      final recipe = _resolveRecipe(item, recipeByName);
      if (recipe == null) continue;
      final scale = _ingredientScaleFactor(
        itemQty: item.quantity,
        itemUnit: item.unit,
        recipeYield: recipe.yieldQuantity,
        recipeUnit: recipe.yieldUnit,
      );
      for (final ing in recipe.sortedIngredients) {
        final entry = costMap[ing.name.toLowerCase()];
        if (entry == null) continue;
        final grams = _ingredientWeightInGrams(ing) * scale;
        if (grams <= 0) continue;
        result.add(IngredientLineItem(ingredient: ing.name, weightGrams: grams, costPerGram: entry.costPerGram));
      }
    }
    return result;
  }

  /// True when at least one order item's recipe has an ingredient that
  /// matches an entry in `costs`.
  bool hasAnyCostData({required List<IngredientCost> costs, List<Recipe> recipes = const []}) {
    if (costs.isEmpty) return false;
    final names = costs.map((c) => c.ingredientName.toLowerCase()).toSet();
    final recipeByName = <String, Recipe>{};
    for (final r in recipes) {
      recipeByName[r.name.toLowerCase()] = r;
    }
    return orderItems.any((item) {
      final recipe = _resolveRecipe(item, recipeByName);
      if (recipe == null) return false;
      return recipe.sortedIngredients.any((i) => names.contains(i.name.toLowerCase()));
    });
  }

  String formattedIngredientCost({required List<IngredientCost> costs}) =>
      totalIngredientCost(costs: costs).asCurrency;

  // effectiveTotal, not totalPrice — totalPrice sums order_items, which for
  // a quoted marketplace order still reflects the listing's original "from"
  // price rather than what the baker actually quoted, overstating
  // revenue/profit on any order quoted below its listing price (2026-08-07).
  double profit({required List<IngredientCost> costs, List<Recipe> recipes = const []}) =>
      effectiveTotal - totalIngredientCost(costs: costs, recipes: recipes);

  double marginPercent({required List<IngredientCost> costs, List<Recipe> recipes = const []}) {
    if (effectiveTotal <= 0) return 0;
    return (profit(costs: costs, recipes: recipes) / effectiveTotal) * 100;
  }

  // MARK: - Private helpers

  /// Matches source's `item.recipe ?? recipeByName[item.customName.lowercased()]`:
  /// prefer the item's direct recipe link, fall back to a name match.
  Recipe? _resolveRecipe(OrderItem item, Map<String, Recipe> recipeByName) {
    if (item.recipeId != null) {
      for (final r in recipeByName.values) {
        if (r.id == item.recipeId) return r;
      }
    }
    return recipeByName[item.customName.toLowerCase()];
  }

  /// Computes how many recipe batches are needed to fulfil an order item.
  double _ingredientScaleFactor({
    required double itemQty,
    required YieldUnit itemUnit,
    required double recipeYield,
    required YieldUnit recipeUnit,
  }) {
    final itemBase = _normaliseYieldUnits(itemQty, itemUnit);
    final recipeBase = _normaliseYieldUnits(recipeYield, recipeUnit);
    if (recipeBase <= 0) return itemQty;
    return itemBase / recipeBase;
  }

  /// Converts a YieldUnit quantity to a "base" count for comparison.
  /// A dozen = 12; everything else is 1:1.
  double _normaliseYieldUnits(double amount, YieldUnit unit) =>
      unit == YieldUnit.dozen ? amount * 12 : amount;

  /// Robust weight-in-grams that handles both volume units (via density)
  /// and explicit weight units (g/kg), which the plain `weightInGrams`
  /// getter returns 0 for.
  double _ingredientWeightInGrams(RecipeIngredient ing) {
    if (ing.volumeUnit.isWeightUnit) {
      return ing.volumeAmount * ing.volumeUnit.toGrams;
    }
    const mlPerCup = 236.588; // VolumeUnit.cup.toMilliliters
    final cups = (ing.volumeAmount * ing.volumeUnit.toMilliliters) / mlPerCup;
    return cups * ing.gramsPerCup;
  }
}
