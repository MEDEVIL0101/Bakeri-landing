// Ported 1:1 from Bakerly/Bakerly/Bakeri/Services/TaxCalculator.swift.
import '../models/enums.dart';

class TaxResult {
  final int taxAmountCents;
  final double taxRate;
  final int taxableSubtotalCents;
  final bool isZeroRated;
  final String province;

  const TaxResult({
    required this.taxAmountCents,
    required this.taxRate,
    required this.taxableSubtotalCents,
    required this.isZeroRated,
    required this.province,
  });

  static const zero = TaxResult(
    taxAmountCents: 0,
    taxRate: 0,
    taxableSubtotalCents: 0,
    isZeroRated: true,
    province: '',
  );

  double get taxAmountDollars => taxAmountCents / 100.0;

  String get taxRateLabel => taxRate == 0 ? '0%' : '${(taxRate * 100).toStringAsPrecision(3)}%';

  String get taxLabel {
    switch (province.toUpperCase()) {
      case 'ON':
      case 'NB':
      case 'NL':
      case 'PE':
      case 'NS':
        return 'HST ($taxRateLabel)';
      case 'QC':
        return 'GST+QST ($taxRateLabel)';
      default:
        return 'GST ($taxRateLabel)';
    }
  }
}

class TaxableItem {
  final TaxCategory taxCategory;
  final int? unitWeightGrams;
  final int quantity;
  final double pricePerUnit;
  final ListingKind listingKind;

  const TaxableItem({
    required this.taxCategory,
    this.unitWeightGrams,
    required this.quantity,
    required this.pricePerUnit,
    this.listingKind = ListingKind.readyNow,
  });
}

class TaxCalculator {
  TaxCalculator._();

  static double taxRate(String province) {
    switch (province.toUpperCase().trim()) {
      case 'ON':
        return 0.13;
      case 'NB':
      case 'NL':
      case 'PE':
        return 0.15;
      case 'NS':
        return 0.14;
      case 'QC':
        return 0.14975;
      default:
        return 0.05;
    }
  }

  // An item is a "single serving" if it is a sweetened good AND each unit
  // ≤ 230g. Unknown weight is treated as a single serving (conservative /
  // pro-remittance).
  static bool isSingleServing(TaxableItem item) {
    if (item.taxCategory != TaxCategory.sweetenedSingleServing) return false;
    if (item.unitWeightGrams != null) return item.unitWeightGrams! <= 230;
    return true;
  }

  static TaxResult calculate({
    required List<TaxableItem> items,
    required bool bakerIsGSTRegistered,
    required String province,
  }) {
    if (!bakerIsGSTRegistered) return TaxResult.zero;

    final rate = taxRate(province.isEmpty ? 'AB' : province);

    // Count all single-serving sweetened items across this baker's order.
    final totalSingleServings = items
        .where(isSingleServing)
        .fold<int>(0, (sum, item) => sum + item.quantity);

    var taxableSubtotal = 0.0;
    for (final item in items) {
      // Digital goods (know-how/PDFs/courses) are never taxed here — no
      // physical single-serving/weight concept applies to them.
      if (item.listingKind == ListingKind.digital) continue;
      switch (item.taxCategory) {
        case TaxCategory.plainBread:
        case TaxCategory.wholeItem:
          break;
        case TaxCategory.sweetenedSingleServing:
          // Single servings taxable only when total < 6.
          if (isSingleServing(item) && totalSingleServings < 6) {
            taxableSubtotal += item.pricePerUnit * item.quantity;
          }
      }
    }

    final taxAmountCents = (taxableSubtotal * rate * 100).round();
    final taxableSubtotalCents = (taxableSubtotal * 100).round();

    return TaxResult(
      taxAmountCents: taxAmountCents,
      taxRate: rate,
      taxableSubtotalCents: taxableSubtotalCents,
      isZeroRated: taxAmountCents == 0,
      province: province,
    );
  }
}
