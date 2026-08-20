// Ported 1:1 from Bakerly/Bakerly/Bakeri/Models/Enums.swift.
// sfSymbol names are kept as the original SF Symbol identifiers (comments
// note the closest Cupertino/Material equivalent) — icon resolution happens
// in the view layer when each screen is ported, not here.

// MARK: - Volume Units

enum VolumeUnit {
  cup,
  tablespoon,
  teaspoon,
  fluidOunce,
  pint,
  quart,
  milliliter,
  liter,
  gram,
  kilogram,
  pound,
  pinch,
  none;

  String get rawValue => switch (this) {
        VolumeUnit.cup => 'cup',
        VolumeUnit.tablespoon => 'tbsp',
        VolumeUnit.teaspoon => 'tsp',
        VolumeUnit.fluidOunce => 'fl oz',
        VolumeUnit.pint => 'pt',
        VolumeUnit.quart => 'qt',
        VolumeUnit.milliliter => 'ml',
        VolumeUnit.liter => 'L',
        VolumeUnit.gram => 'g',
        VolumeUnit.kilogram => 'kg',
        VolumeUnit.pound => 'lb',
        VolumeUnit.pinch => 'pinch',
        VolumeUnit.none => 'none',
      };

  static VolumeUnit fromRawValue(String raw) =>
      VolumeUnit.values.firstWhere((u) => u.rawValue == raw, orElse: () => VolumeUnit.cup);

  String get displayName => switch (this) {
        VolumeUnit.cup => 'Cup',
        VolumeUnit.tablespoon => 'Tablespoon',
        VolumeUnit.teaspoon => 'Teaspoon',
        VolumeUnit.fluidOunce => 'Fluid Ounce',
        VolumeUnit.pint => 'Pint',
        VolumeUnit.quart => 'Quart',
        VolumeUnit.milliliter => 'Milliliter',
        VolumeUnit.liter => 'Liter',
        VolumeUnit.gram => 'Gram',
        VolumeUnit.kilogram => 'Kilogram',
        VolumeUnit.pound => 'Pound',
        VolumeUnit.pinch => 'Pinch',
        VolumeUnit.none => 'None',
      };

  String get abbreviation => this == VolumeUnit.none ? '—' : rawValue;

  /// True for gram/kg/lb — direct weight measurements, not volume.
  bool get isWeightUnit =>
      this == VolumeUnit.gram || this == VolumeUnit.kilogram || this == VolumeUnit.pound;

  /// Conversion factor to milliliters (0 for weight units and none).
  double get toMilliliters => switch (this) {
        VolumeUnit.cup => 236.588,
        VolumeUnit.tablespoon => 14.7868,
        VolumeUnit.teaspoon => 4.92892,
        VolumeUnit.fluidOunce => 29.5735,
        VolumeUnit.pint => 473.176,
        VolumeUnit.quart => 946.353,
        VolumeUnit.milliliter => 1.0,
        VolumeUnit.liter => 1000.0,
        // ~1/16 tsp; treated as immeasurable for scaling.
        VolumeUnit.pinch => 0.3,
        VolumeUnit.gram || VolumeUnit.kilogram || VolumeUnit.pound || VolumeUnit.none => 0.0,
      };

  /// Grams per unit (only meaningful for .gram, .kilogram, and .pound).
  double get toGrams => switch (this) {
        VolumeUnit.gram => 1.0,
        VolumeUnit.kilogram => 1000.0,
        VolumeUnit.pound => 453.592,
        _ => 0.0,
      };

  bool get isMetric =>
      this == VolumeUnit.milliliter || this == VolumeUnit.liter || this == VolumeUnit.gram || this == VolumeUnit.kilogram;

  static const List<VolumeUnit> usUnits = [
    VolumeUnit.cup,
    VolumeUnit.tablespoon,
    VolumeUnit.teaspoon,
    VolumeUnit.fluidOunce,
    VolumeUnit.pint,
    VolumeUnit.quart,
  ];
  static const List<VolumeUnit> metricUnits = [VolumeUnit.milliliter, VolumeUnit.liter];

  /// All measurable units (excludes .none) — use in calculators.
  static List<VolumeUnit> get measuredCases => VolumeUnit.values.where((u) => u != VolumeUnit.none).toList();

  /// Ordered list for the ingredient picker: weight first, then volume.
  static const List<VolumeUnit> ingredientPickerCases = [
    VolumeUnit.gram,
    VolumeUnit.kilogram,
    VolumeUnit.pound,
    VolumeUnit.cup,
    VolumeUnit.tablespoon,
    VolumeUnit.teaspoon,
    VolumeUnit.pinch,
    VolumeUnit.fluidOunce,
    VolumeUnit.pint,
    VolumeUnit.quart,
    VolumeUnit.milliliter,
    VolumeUnit.liter,
  ];
}

// MARK: - Weight Units

enum WeightUnit {
  gram,
  kilogram,
  ounce,
  pound;

  String get rawValue => switch (this) {
        WeightUnit.gram => 'g',
        WeightUnit.kilogram => 'kg',
        WeightUnit.ounce => 'oz',
        WeightUnit.pound => 'lb',
      };

  static WeightUnit fromRawValue(String raw) =>
      WeightUnit.values.firstWhere((u) => u.rawValue == raw, orElse: () => WeightUnit.pound);

  String get displayName => switch (this) {
        WeightUnit.gram => 'Gram',
        WeightUnit.kilogram => 'Kilogram',
        WeightUnit.ounce => 'Ounce',
        WeightUnit.pound => 'Pound',
      };

  String get abbreviation => rawValue;

  double get toGrams => switch (this) {
        WeightUnit.gram => 1.0,
        WeightUnit.kilogram => 1000.0,
        WeightUnit.ounce => 28.3495,
        WeightUnit.pound => 453.592,
      };

  bool get isMetric => this == WeightUnit.gram || this == WeightUnit.kilogram;
}

// MARK: - Unit System

enum UnitSystem {
  us,
  metric;

  String get rawValue => this == UnitSystem.us ? 'US' : 'Metric';

  static UnitSystem fromRawValue(String raw) => raw == 'Metric' ? UnitSystem.metric : UnitSystem.us;

  List<VolumeUnit> get preferredVolumeUnits =>
      this == UnitSystem.us ? VolumeUnit.usUnits : VolumeUnit.metricUnits;

  WeightUnit get preferredWeightUnit => this == UnitSystem.us ? WeightUnit.ounce : WeightUnit.gram;

  VolumeUnit get defaultVolumeUnit => this == UnitSystem.us ? VolumeUnit.cup : VolumeUnit.milliliter;
}

// MARK: - Baker Country
//
// The country a baker's Stripe Connect account is created under. Chosen
// once, before onboarding — Stripe doesn't allow changing a connected
// account's country afterward, so this can't be edited post-connection,
// only fixed by disconnecting and reconnecting with the right value.

enum BakerCountry {
  us,
  ca;

  String get rawValue => this == BakerCountry.us ? 'US' : 'CA';

  static BakerCountry fromRawValue(String raw) => raw == 'CA' ? BakerCountry.ca : BakerCountry.us;

  String get displayName => this == BakerCountry.us ? 'United States' : 'Canada';
}

// MARK: - Order Status

enum OrderStatus {
  confirmed,
  baked,
  decorated,
  packaged,
  delivered,
  completed, // auto-set when delivered + paid
  cancelled;

  String get rawValue => switch (this) {
        OrderStatus.confirmed => 'Confirmed',
        OrderStatus.baked => 'Baked',
        OrderStatus.decorated => 'Decorated',
        OrderStatus.packaged => 'Packaged',
        OrderStatus.delivered => 'Delivered',
        OrderStatus.completed => 'Completed',
        OrderStatus.cancelled => 'Cancelled',
      };

  static OrderStatus fromRawValue(String raw) =>
      OrderStatus.values.firstWhere((s) => s.rawValue == raw, orElse: () => OrderStatus.confirmed);

  /// SF Symbol name from the source app — resolve to a Flutter icon when the
  /// screen that uses it is ported.
  String get sfSymbol => switch (this) {
        OrderStatus.confirmed => 'checkmark.circle',
        OrderStatus.baked => 'oven.fill',
        OrderStatus.decorated => 'wand.and.stars',
        OrderStatus.packaged => 'shippingbox.fill',
        OrderStatus.delivered => 'checkmark.seal.fill',
        OrderStatus.completed => 'star.circle.fill',
        OrderStatus.cancelled => 'xmark.circle.fill',
      };

  /// Next logical status in the manual workflow.
  /// .completed is never set manually — it's triggered automatically.
  OrderStatus? get next => switch (this) {
        OrderStatus.confirmed => OrderStatus.baked,
        OrderStatus.baked => OrderStatus.decorated,
        OrderStatus.decorated => OrderStatus.packaged,
        OrderStatus.packaged => OrderStatus.delivered,
        OrderStatus.delivered || OrderStatus.completed || OrderStatus.cancelled => null,
      };

  bool get isActive =>
      !(this == OrderStatus.delivered || this == OrderStatus.completed || this == OrderStatus.cancelled);

  /// Terminal states that shouldn't appear in the active workflow.
  bool get isTerminal => this == OrderStatus.completed || this == OrderStatus.cancelled;
}

// MARK: - Event Color

enum EventColor {
  red,
  orange,
  gold,
  green,
  teal,
  blue,
  purple,
  pink,
  brown,
  indigo;

  String get rawValue => name;

  static EventColor fromRawValue(String raw) =>
      EventColor.values.firstWhere((c) => c.rawValue == raw, orElse: () => EventColor.red);

  /// RGB triplet (0-1 range, matches the Color(red:green:blue:) values in
  /// AppTheme.swift) — resolved to a Flutter Color in the theme layer.
  (double, double, double) get rgb => switch (this) {
        EventColor.red => (0.82, 0.41, 0.41),
        EventColor.orange => (0.94, 0.55, 0.24),
        EventColor.gold => (0.85, 0.67, 0.26),
        EventColor.green => (0.24, 0.74, 0.44),
        EventColor.teal => (0.18, 0.68, 0.65),
        EventColor.blue => (0.37, 0.57, 0.90),
        EventColor.purple => (0.58, 0.24, 0.82),
        EventColor.pink => (0.94, 0.40, 0.68),
        EventColor.brown => (0.55, 0.37, 0.26),
        EventColor.indigo => (0.37, 0.36, 0.84),
      };

  String get displayName => name[0].toUpperCase() + name.substring(1);
}

// MARK: - Marketplace-adjacent enums still used by baker-tools-scope data
// (listings on the baker's own storefront, order lifecycle) — kept per the
// rebuild spec; the cross-baker marketplace/discovery system itself is out
// of scope.

enum ListingKind {
  readyNow,
  preorder,
  custom,
  digital;

  String get rawValue => switch (this) {
        ListingKind.readyNow => 'ready_now',
        ListingKind.preorder => 'preorder',
        ListingKind.custom => 'custom',
        ListingKind.digital => 'digital',
      };

  static ListingKind fromRawValue(String raw) =>
      ListingKind.values.firstWhere((k) => k.rawValue == raw, orElse: () => ListingKind.readyNow);

  String get displayName => switch (this) {
        ListingKind.readyNow => 'Ready Now',
        ListingKind.preorder => 'Pre-order',
        ListingKind.custom => 'Custom Order',
        ListingKind.digital => 'Digital Download',
      };

  String get sfSymbol => switch (this) {
        ListingKind.readyNow => 'basket.fill',
        ListingKind.preorder => 'calendar.badge.clock',
        ListingKind.custom => 'pencil.and.list.clipboard',
        ListingKind.digital => 'arrow.down.doc.fill',
      };
}

enum MarketplaceStatus {
  pending,
  confirmed,
  declined,
  cancelled,
  pendingQuote,
  quoteProvided,
  readyForPickup,
  outForDelivery,
  completed;

  String get rawValue => switch (this) {
        MarketplaceStatus.pending => 'pending',
        MarketplaceStatus.confirmed => 'confirmed',
        MarketplaceStatus.declined => 'declined',
        MarketplaceStatus.cancelled => 'cancelled',
        MarketplaceStatus.pendingQuote => 'pending_quote',
        MarketplaceStatus.quoteProvided => 'quote_provided',
        MarketplaceStatus.readyForPickup => 'ready_for_pickup',
        MarketplaceStatus.outForDelivery => 'out_for_delivery',
        MarketplaceStatus.completed => 'completed',
      };

  static MarketplaceStatus fromRawValue(String raw) =>
      MarketplaceStatus.values.firstWhere((s) => s.rawValue == raw, orElse: () => MarketplaceStatus.pending);

  String get displayName => switch (this) {
        MarketplaceStatus.pending => 'Pending',
        MarketplaceStatus.confirmed => 'Confirmed',
        MarketplaceStatus.declined => 'Declined',
        MarketplaceStatus.cancelled => 'Cancelled',
        MarketplaceStatus.pendingQuote => 'Quote Requested',
        MarketplaceStatus.quoteProvided => 'Quote Received',
        MarketplaceStatus.readyForPickup => 'Ready for Pickup',
        MarketplaceStatus.outForDelivery => 'Out for Delivery',
        MarketplaceStatus.completed => 'Completed',
      };

  String get sfSymbol => switch (this) {
        MarketplaceStatus.pending => 'clock',
        MarketplaceStatus.confirmed => 'checkmark.circle',
        MarketplaceStatus.declined => 'xmark.circle.fill',
        MarketplaceStatus.cancelled => 'xmark.circle.fill',
        MarketplaceStatus.pendingQuote => 'text.bubble',
        MarketplaceStatus.quoteProvided => 'tag.fill',
        MarketplaceStatus.readyForPickup => 'bag.fill',
        MarketplaceStatus.outForDelivery => 'box.truck.fill',
        MarketplaceStatus.completed => 'star.circle.fill',
      };
}

enum OrderSource {
  manual,
  marketplace;

  String get rawValue => name;

  static OrderSource fromRawValue(String raw) =>
      OrderSource.values.firstWhere((s) => s.rawValue == raw, orElse: () => OrderSource.manual);
}

enum FulfillmentType {
  pickup,
  delivery;

  String get rawValue => this == FulfillmentType.pickup ? 'Pickup' : 'Delivery';

  static FulfillmentType fromRawValue(String raw) =>
      raw == 'Delivery' ? FulfillmentType.delivery : FulfillmentType.pickup;
}

// MARK: - Tax Classification

enum TaxCategory {
  sweetenedSingleServing,
  plainBread,
  wholeItem;

  String get rawValue => switch (this) {
        TaxCategory.sweetenedSingleServing => 'sweetened_single_serving',
        TaxCategory.plainBread => 'plain_bread',
        TaxCategory.wholeItem => 'whole_item',
      };

  static TaxCategory fromRawValue(String raw) => TaxCategory.values
      .firstWhere((c) => c.rawValue == raw, orElse: () => TaxCategory.sweetenedSingleServing);

  String get displayName => switch (this) {
        TaxCategory.sweetenedSingleServing => 'Baked Good (single serving)',
        TaxCategory.plainBread => 'Plain Bread / Roll',
        TaxCategory.wholeItem => 'Whole Cake / Large Item',
      };

  String get helpText => switch (this) {
        TaxCategory.sweetenedSingleServing =>
          'Cookies, cupcakes, muffins, tarts, brownies, sweetened croissants',
        TaxCategory.plainBread => 'Bagels, dinner rolls, scones, plain croissants',
        TaxCategory.wholeItem => 'Whole cakes, any single item over 230g',
      };

  bool get isTaxable => this == TaxCategory.sweetenedSingleServing;
}

// MARK: - Pre-order Scheduling Mode

enum PreorderScheduleMode {
  /// 1+ candidate dates, buyer picks if >1.
  fixedDates,
  /// Day-of-week + explicit order cutoff.
  weekday,
  /// Ready N days after order (reuses leadDays).
  leadTime;

  String get rawValue => switch (this) {
        PreorderScheduleMode.fixedDates => 'fixed_dates',
        PreorderScheduleMode.weekday => 'weekday',
        PreorderScheduleMode.leadTime => 'lead_time',
      };

  static PreorderScheduleMode fromRawValue(String raw) => PreorderScheduleMode.values
      .firstWhere((m) => m.rawValue == raw, orElse: () => PreorderScheduleMode.fixedDates);
}

// MARK: - Intake Form Field Type

enum IntakeFieldType {
  heading,
  shortText,
  longText,
  number,
  singleChoice,
  multiChoice,
  date,
  photo,
  productSelector;

  String get rawValue => switch (this) {
        IntakeFieldType.heading => 'heading',
        IntakeFieldType.shortText => 'short_text',
        IntakeFieldType.longText => 'long_text',
        IntakeFieldType.number => 'number',
        IntakeFieldType.singleChoice => 'single_choice',
        IntakeFieldType.multiChoice => 'multi_choice',
        IntakeFieldType.date => 'date',
        IntakeFieldType.photo => 'photo',
        IntakeFieldType.productSelector => 'product_selector',
      };

  static IntakeFieldType fromRawValue(String raw) =>
      IntakeFieldType.values.firstWhere((t) => t.rawValue == raw, orElse: () => IntakeFieldType.shortText);

  String get displayName => switch (this) {
        IntakeFieldType.heading => 'Section Title',
        IntakeFieldType.shortText => 'Short text',
        IntakeFieldType.longText => 'Paragraph',
        IntakeFieldType.number => 'Number',
        IntakeFieldType.singleChoice => 'Single choice',
        IntakeFieldType.multiChoice => 'Multiple choice',
        IntakeFieldType.date => 'Date',
        IntakeFieldType.photo => 'Photo',
        IntakeFieldType.productSelector => 'Item picker',
      };

  String get sfSymbol => switch (this) {
        IntakeFieldType.heading => 'text.alignleft',
        IntakeFieldType.shortText => 'textformat',
        IntakeFieldType.longText => 'text.justify.left',
        IntakeFieldType.number => 'number',
        IntakeFieldType.singleChoice => 'list.bullet.circle',
        IntakeFieldType.multiChoice => 'checklist',
        IntakeFieldType.date => 'calendar',
        IntakeFieldType.photo => 'photo.badge.plus',
        IntakeFieldType.productSelector => 'cart.badge.plus',
      };

  /// False only for `.heading` — a section label has no answer to collect or require.
  bool get isAnswerField => this != IntakeFieldType.heading;

  /// True for the two choice types, which need an editable list of string options.
  bool get hasOptions => this == IntakeFieldType.singleChoice || this == IntakeFieldType.multiChoice;

  /// True only for `.productSelector`, which needs an editable list of priced items instead.
  bool get hasProductOptions => this == IntakeFieldType.productSelector;
}

// MARK: - Yield Unit

enum YieldUnit {
  // --- Generic ---
  servings, pieces, dozen,
  // --- Cookies & Bars ---
  cookies, bars, brownies, shortbreads, biscotti,
  // --- Cakes & Cupcakes ---
  cakes, cupcakes, cake6inch, cake8inch, cake9inch, cake10inch, sheetCake, bundtCake, cheesecakes, cakePops,
  // --- Pies & Tarts ---
  pies, pie6inch, pie8inch, pie9inch, pie10inch, miniPies, tarts, miniTarts,
  // --- Pastries ---
  muffins, scones, croissants, donuts, eclairs, macarons, truffles, crepes, waffles, pancakes,
  // --- Bread & Rolls ---
  loaves, rolls, buns, bagels, pretzels, biscuits, breadsticks,
  // --- By Weight ---
  grams, kilograms, ounces, pounds;

  String get rawValue => switch (this) {
        YieldUnit.servings => 'servings',
        YieldUnit.pieces => 'pieces',
        YieldUnit.dozen => 'dozen',
        YieldUnit.cookies => 'cookies',
        YieldUnit.bars => 'bars',
        YieldUnit.brownies => 'brownies',
        YieldUnit.shortbreads => 'shortbreads',
        YieldUnit.biscotti => 'biscotti',
        YieldUnit.cakes => 'cakes',
        YieldUnit.cupcakes => 'cupcakes',
        YieldUnit.cake6inch => '6-inch cakes',
        YieldUnit.cake8inch => '8-inch cakes',
        YieldUnit.cake9inch => '9-inch cakes',
        YieldUnit.cake10inch => '10-inch cakes',
        YieldUnit.sheetCake => 'sheet cakes',
        YieldUnit.bundtCake => 'bundt cakes',
        YieldUnit.cheesecakes => 'cheesecakes',
        YieldUnit.cakePops => 'cake pops',
        YieldUnit.pies => 'pies',
        YieldUnit.pie6inch => '6-inch pies',
        YieldUnit.pie8inch => '8-inch pies',
        YieldUnit.pie9inch => '9-inch pies',
        YieldUnit.pie10inch => '10-inch pies',
        YieldUnit.miniPies => 'mini pies',
        YieldUnit.tarts => 'tarts',
        YieldUnit.miniTarts => 'mini tarts',
        YieldUnit.muffins => 'muffins',
        YieldUnit.scones => 'scones',
        YieldUnit.croissants => 'croissants',
        YieldUnit.donuts => 'donuts',
        YieldUnit.eclairs => 'eclairs',
        YieldUnit.macarons => 'macarons',
        YieldUnit.truffles => 'truffles',
        YieldUnit.crepes => 'crepes',
        YieldUnit.waffles => 'waffles',
        YieldUnit.pancakes => 'pancakes',
        YieldUnit.loaves => 'loaves',
        YieldUnit.rolls => 'rolls',
        YieldUnit.buns => 'buns',
        YieldUnit.bagels => 'bagels',
        YieldUnit.pretzels => 'pretzels',
        YieldUnit.biscuits => 'biscuits',
        YieldUnit.breadsticks => 'breadsticks',
        YieldUnit.grams => 'g',
        YieldUnit.kilograms => 'kg',
        YieldUnit.ounces => 'oz',
        YieldUnit.pounds => 'lb',
      };

  static YieldUnit fromRawValue(String raw) =>
      YieldUnit.values.firstWhere((u) => u.rawValue == raw, orElse: () => YieldUnit.servings);

  String get displayName => rawValue;
}
