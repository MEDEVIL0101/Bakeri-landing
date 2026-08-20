// Ported 1:1 from Bakerly/Bakerly/Bakeri/Models/MenuItem.swift.
import 'dart:convert';
import 'dart:typed_data';
import 'enums.dart';
import 'box_item.dart';

class MenuItem {
  String id;
  String name;
  String itemDescription;
  String category; // e.g. "Cakes", "Cookies"
  double defaultQuantity;
  YieldUnit unit;
  double defaultPrice;
  bool isActive;
  int sortOrder;
  DateTime createdAt;
  DateTime updatedAt;
  Uint8List? imageData;

  /// Cached recipe name(s) — comma-separated, written on every save so views
  /// never fault through the relationship for display.
  String? linkedRecipeName;

  /// Legacy single-recipe link (kept for backward compatibility).
  String? recipeId;
  /// Multi-recipe links — the primary field going forward.
  List<String> recipeIds;

  // MARK: Storefront/listing fields
  bool isListedInMarketplace;
  ListingKind listingKind;
  int leadDays;
  int availableQtyToday;
  double marketplacePriceFrom;

  // Pre-order scheduling — legacy single-date fields, kept for backward
  // compatibility with the paused in-app buyer flow. New listings are
  // driven by preorderScheduleMode/preorderDatesJson/etc. below.
  bool useDropDate;
  DateTime? preorderDropDate;
  int maxPreorderQuantity; // 0 = unlimited

  // MARK: Pre-order scheduling modes
  PreorderScheduleMode preorderScheduleMode;
  String? preorderDatesJson; // JSON array of ISO8601 date strings — mode == fixedDates
  int? preorderWeekday; // 1=Sunday...7=Saturday — mode == weekday
  DateTime? preorderOrderCutoffDate; // order-by deadline — mode == weekday
  bool isDeliveryAvailable;
  double deliveryFee;
  bool acceptsBuyerNote;
  /// When set, this listing's intake form replaces the default brief/buyer-note field.
  String? intakeFormId;

  // MARK: Tax classification
  TaxCategory taxCategory;
  int? unitWeightGrams;

  // MARK: Storefront detail (free text, not a rule engine)
  String allergens;
  String leadTimeNote;

  // MARK: Digital goods
  /// Storage path within the private "digital-products" bucket
  /// ({userID}/{filename}) — only set/meaningful when listingKind == digital.
  String? digitalFilePath;

  // MARK: Assorted box
  /// When true, price/availability come from sizeTiers instead of
  /// defaultPrice/availableQtyToday, and the buyer picks a flavor mix from variants.
  bool isAssortedBox;
  List<BoxSizeTier> sizeTiers;
  List<BoxVariant> variants;

  MenuItem({
    required this.id,
    required this.name,
    this.itemDescription = '',
    this.category = '',
    this.defaultQuantity = 1,
    this.unit = YieldUnit.pieces,
    this.defaultPrice = 0,
    this.recipeId,
    this.isActive = true,
    this.sortOrder = 0,
    DateTime? createdAt,
    DateTime? updatedAt,
    this.imageData,
    this.linkedRecipeName,
    List<String>? recipeIds,
    this.isListedInMarketplace = false,
    this.listingKind = ListingKind.readyNow,
    this.leadDays = 2,
    this.availableQtyToday = 0,
    this.marketplacePriceFrom = 0,
    this.useDropDate = false,
    this.preorderDropDate,
    this.maxPreorderQuantity = 0,
    this.preorderScheduleMode = PreorderScheduleMode.fixedDates,
    this.preorderDatesJson,
    this.preorderWeekday,
    this.preorderOrderCutoffDate,
    this.isDeliveryAvailable = false,
    this.deliveryFee = 0,
    this.acceptsBuyerNote = false,
    this.intakeFormId,
    this.taxCategory = TaxCategory.sweetenedSingleServing,
    this.unitWeightGrams,
    this.allergens = '',
    this.leadTimeNote = '',
    this.digitalFilePath,
    this.isAssortedBox = false,
    List<BoxSizeTier>? sizeTiers,
    List<BoxVariant>? variants,
  })  : createdAt = createdAt ?? DateTime.now(),
        updatedAt = updatedAt ?? DateTime.now(),
        recipeIds = recipeIds ?? [],
        sizeTiers = sizeTiers ?? [],
        variants = variants ?? [] {
    linkedRecipeName ??= null;
  }

  void touch() => updatedAt = DateTime.now();

  /// Candidate pickup dates for `.fixedDates` mode. Falls back to the legacy
  /// single `preorderDropDate` for any listing created before scheduling
  /// modes existed, so old data keeps working with no migration step.
  List<DateTime> get preorderDates {
    if (preorderDatesJson != null) {
      try {
        final strings = (jsonDecode(preorderDatesJson!) as List<dynamic>).cast<String>();
        return strings.map((s) => DateTime.parse(s)).toList();
      } catch (_) {
        // fall through
      }
    }
    if (useDropDate && preorderDropDate != null) return [preorderDropDate!];
    return [];
  }

  set preorderDates(List<DateTime> dates) {
    if (dates.isEmpty) {
      preorderDatesJson = null;
      return;
    }
    final sorted = List<DateTime>.of(dates)..sort();
    preorderDatesJson = jsonEncode(sorted.map((d) => d.toUtc().toIso8601String()).toList());
  }

  /// True once a pre-order listing can no longer accept new orders —
  /// `.weekday` mode's cutoff has passed, or every `.fixedDates` candidate
  /// is in the past. `.leadTime` is never closed (always N days out).
  bool get isPreorderOrderingClosed {
    switch (preorderScheduleMode) {
      case PreorderScheduleMode.weekday:
        if (preorderOrderCutoffDate == null) return false;
        return DateTime.now().isAfter(preorderOrderCutoffDate!);
      case PreorderScheduleMode.fixedDates:
        final dates = preorderDates;
        if (dates.isEmpty) return false;
        return dates.every((d) => d.isBefore(DateTime.now()));
      case PreorderScheduleMode.leadTime:
        return false;
    }
  }

  /// For `.weekday` mode: the first date strictly after the order cutoff
  /// matching the chosen weekday. Stable for the listing's lifetime once
  /// the cutoff is set — not a rolling "next occurrence from today".
  DateTime? get weekdayComputedReadyDate {
    if (preorderScheduleMode != PreorderScheduleMode.weekday ||
        preorderWeekday == null ||
        preorderOrderCutoffDate == null) {
      return null;
    }
    // Dart's DateTime.weekday: 1=Monday...7=Sunday. Source uses Swift
    // Calendar convention: 1=Sunday...7=Saturday. Convert on comparison.
    var date = preorderOrderCutoffDate!.add(const Duration(days: 1));
    for (var i = 0; i < 7; i++) {
      final swiftWeekday = date.weekday % 7 + 1; // Mon(1)->2 ... Sun(7)->1
      if (swiftWeekday == preorderWeekday) return date;
      date = date.add(const Duration(days: 1));
    }
    return null;
  }

  double get effectiveMarketplacePrice => marketplacePriceFrom > 0 ? marketplacePriceFrom : defaultPrice;

  String get displayCategory => category.trim().isEmpty ? 'Uncategorized' : category;
}
