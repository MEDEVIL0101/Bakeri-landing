// Drift table schema — mirrors the iOS app's SwiftData @Model classes 1:1
// (same fields, same relationships/delete rules). See:
//   Bakerly/Bakerly/Bakeri/Models/{Recipe,Order,MenuItem,BakingTask,
//   IngredientCost,IngredientDensity,BoxItemModels}.swift
//
// JSON-encoded columns (formResponsesJson, variantBreakdownJson,
// preorderDatesJson) hold the exact same JSON string shape SwiftData stores
// them as — no re-modeling, just a different host database.
import 'package:drift/drift.dart';

class Recipes extends Table {
  TextColumn get id => text()();
  TextColumn get name => text()();
  RealColumn get yieldQuantity => real().withDefault(const Constant(1))();
  TextColumn get yieldUnit => text().withDefault(const Constant('servings'))();
  IntColumn get prepTimeMinutes => integer().withDefault(const Constant(0))();
  IntColumn get bakeTimeMinutes => integer().withDefault(const Constant(0))();
  TextColumn get instructions => text().withDefault(const Constant(''))();
  TextColumn get notes => text().withDefault(const Constant(''))();
  BlobColumn get imageData => blob().nullable()();
  BoolColumn get hasRemoteImage => boolean().withDefault(const Constant(false))();
  TextColumn get tagsJson => text().withDefault(const Constant('[]'))();
  BoolColumn get isFavorite => boolean().withDefault(const Constant(false))();
  DateTimeColumn get createdAt => dateTime()();
  DateTimeColumn get updatedAt => dateTime()();

  @override
  Set<Column> get primaryKey => {id};
}

class RecipeIngredients extends Table {
  TextColumn get id => text()();
  TextColumn get recipeId =>
      text().references(Recipes, #id, onDelete: KeyAction.cascade)();
  TextColumn get name => text()();
  RealColumn get volumeAmount => real().withDefault(const Constant(1))();
  TextColumn get volumeUnit => text().withDefault(const Constant('cup'))();
  RealColumn get gramsPerCup => real().withDefault(const Constant(120))();
  TextColumn get notes => text().withDefault(const Constant(''))();
  IntColumn get sortOrder => integer().withDefault(const Constant(0))();
  DateTimeColumn get updatedAt => dateTime()();
  BlobColumn get imageData => blob().nullable()();

  @override
  Set<Column> get primaryKey => {id};
}

class MenuItems extends Table {
  TextColumn get id => text()();
  TextColumn get name => text()();
  TextColumn get itemDescription => text().withDefault(const Constant(''))();
  TextColumn get category => text().withDefault(const Constant(''))();
  RealColumn get defaultQuantity => real().withDefault(const Constant(1))();
  TextColumn get unit => text().withDefault(const Constant('pieces'))();
  RealColumn get defaultPrice => real().withDefault(const Constant(0))();
  BoolColumn get isActive => boolean().withDefault(const Constant(true))();
  IntColumn get sortOrder => integer().withDefault(const Constant(0))();
  DateTimeColumn get createdAt => dateTime()();
  DateTimeColumn get updatedAt => dateTime()();
  BlobColumn get imageData => blob().nullable()();
  TextColumn get linkedRecipeName => text().nullable()();
  // Legacy single-recipe link (kept for backward compatibility).
  TextColumn get recipeId =>
      text().nullable().references(Recipes, #id, onDelete: KeyAction.setNull)();

  BoolColumn get isListedInMarketplace => boolean().withDefault(const Constant(false))();
  TextColumn get listingKind => text().withDefault(const Constant('ready_now'))();
  IntColumn get leadDays => integer().withDefault(const Constant(2))();
  IntColumn get availableQtyToday => integer().withDefault(const Constant(0))();
  RealColumn get marketplacePriceFrom => real().withDefault(const Constant(0))();
  BoolColumn get useDropDate => boolean().withDefault(const Constant(false))();
  DateTimeColumn get preorderDropDate => dateTime().nullable()();
  IntColumn get maxPreorderQuantity => integer().withDefault(const Constant(0))();

  TextColumn get preorderScheduleMode => text().withDefault(const Constant('fixed_dates'))();
  TextColumn get preorderDatesJson => text().nullable()();
  IntColumn get preorderWeekday => integer().nullable()();
  DateTimeColumn get preorderOrderCutoffDate => dateTime().nullable()();
  BoolColumn get isDeliveryAvailable => boolean().withDefault(const Constant(false))();
  RealColumn get deliveryFee => real().withDefault(const Constant(0))();
  BoolColumn get acceptsBuyerNote => boolean().withDefault(const Constant(false))();
  TextColumn get intakeFormId => text().nullable()();

  TextColumn get taxCategory => text().withDefault(const Constant('sweetened_single_serving'))();
  IntColumn get unitWeightGrams => integer().nullable()();

  TextColumn get allergens => text().withDefault(const Constant(''))();
  TextColumn get leadTimeNote => text().withDefault(const Constant(''))();

  TextColumn get digitalFilePath => text().nullable()();

  BoolColumn get isAssortedBox => boolean().withDefault(const Constant(false))();

  @override
  Set<Column> get primaryKey => {id};
}

/// Multi-recipe links on a MenuItem (`recipes: [Recipe]` in source) — a
/// many-to-many junction table since Drift/SQL has no native array-of-FK column.
class MenuItemRecipes extends Table {
  TextColumn get menuItemId =>
      text().references(MenuItems, #id, onDelete: KeyAction.cascade)();
  TextColumn get recipeId =>
      text().references(Recipes, #id, onDelete: KeyAction.cascade)();

  @override
  Set<Column> get primaryKey => {menuItemId, recipeId};
}

class BoxSizeTiers extends Table {
  TextColumn get id => text()();
  TextColumn get menuItemId =>
      text().references(MenuItems, #id, onDelete: KeyAction.cascade)();
  TextColumn get label => text()();
  IntColumn get unitCount => integer().withDefault(const Constant(1))();
  RealColumn get price => real().withDefault(const Constant(0))();
  IntColumn get sortOrder => integer().withDefault(const Constant(0))();
  DateTimeColumn get updatedAt => dateTime()();

  @override
  Set<Column> get primaryKey => {id};
}

class BoxVariants extends Table {
  TextColumn get id => text()();
  TextColumn get menuItemId =>
      text().references(MenuItems, #id, onDelete: KeyAction.cascade)();
  TextColumn get name => text()();
  IntColumn get sortOrder => integer().withDefault(const Constant(0))();
  DateTimeColumn get updatedAt => dateTime()();
  BoolColumn get hasRemoteImage => boolean().withDefault(const Constant(false))();
  BlobColumn get imageData => blob().nullable()();

  @override
  Set<Column> get primaryKey => {id};
}

class Orders extends Table {
  TextColumn get id => text()();
  TextColumn get orderName => text().withDefault(const Constant(''))();
  TextColumn get customerName => text()();
  TextColumn get customerPhone => text().withDefault(const Constant(''))();
  TextColumn get customerEmail => text().withDefault(const Constant(''))();
  DateTimeColumn get dueDate => dateTime()();
  TextColumn get status => text().withDefault(const Constant('Confirmed'))();
  TextColumn get notes => text().withDefault(const Constant(''))();
  BoolColumn get isPaid => boolean().withDefault(const Constant(false))();
  DateTimeColumn get paidAt => dateTime().nullable()();
  TextColumn get paymentNote => text().withDefault(const Constant(''))();
  RealColumn get depositAmount => real().withDefault(const Constant(0))();
  DateTimeColumn get depositPaidAt => dateTime().nullable()();
  TextColumn get depositNote => text().withDefault(const Constant(''))();
  DateTimeColumn get createdAt => dateTime()();
  DateTimeColumn get updatedAt => dateTime()();
  TextColumn get fulfillmentType => text().withDefault(const Constant('Pickup'))();
  TextColumn get deliveryDetails => text().withDefault(const Constant(''))();
  TextColumn get colorName => text().withDefault(const Constant('red'))();
  DateTimeColumn get startDate => dateTime().nullable()();
  TextColumn get referenceDocumentNamesJson => text().withDefault(const Constant('[]'))();

  TextColumn get orderSource => text().withDefault(const Constant('manual'))();
  TextColumn get marketplaceStatus => text().nullable()();
  TextColumn get buyerProfileId => text().nullable()();
  TextColumn get buyerDisplayName => text().withDefault(const Constant(''))();
  DateTimeColumn get scheduledPickupDate => dateTime().nullable()();
  TextColumn get paymentIntentId => text().nullable()();
  TextColumn get paymentStatus => text().nullable()();
  TextColumn get paymentFlow => text().withDefault(const Constant('auth_hold'))();
  IntColumn get depositAmountCents => integer().withDefault(const Constant(0))();
  RealColumn get quotedPrice => real().nullable()();
  TextColumn get quoteNote => text().nullable()();
  TextColumn get declineMessage => text().nullable()();
  IntColumn get messageCount => integer().withDefault(const Constant(0))();
  TextColumn get invoiceCode => text().nullable()();
  TextColumn get formResponsesJson => text().nullable()();
  TextColumn get leadChannel => text().nullable()();
  IntColumn get platformFeeCents => integer().nullable()();
  IntColumn get stripeFeeCents => integer().nullable()();
  IntColumn get bakerPayoutCents => integer().nullable()();

  @override
  Set<Column> get primaryKey => {id};
}

/// Reference photos/documents are stored as separate rows (one blob per
/// row) rather than a single array column — Drift has no array-of-blob
/// column type, and this also avoids loading every photo just to read one.
class OrderReferencePhotos extends Table {
  IntColumn get rowId => integer().autoIncrement()();
  TextColumn get orderId =>
      text().references(Orders, #id, onDelete: KeyAction.cascade)();
  BlobColumn get imageData => blob()();
  IntColumn get sortOrder => integer().withDefault(const Constant(0))();
}

class OrderReferenceDocuments extends Table {
  IntColumn get rowId => integer().autoIncrement()();
  TextColumn get orderId =>
      text().references(Orders, #id, onDelete: KeyAction.cascade)();
  TextColumn get fileName => text()();
  BlobColumn get fileData => blob()();
  IntColumn get sortOrder => integer().withDefault(const Constant(0))();
}

class OrderItems extends Table {
  TextColumn get id => text()();
  TextColumn get orderId =>
      text().references(Orders, #id, onDelete: KeyAction.cascade)();
  TextColumn get customName => text().withDefault(const Constant(''))();
  RealColumn get quantity => real().withDefault(const Constant(1))();
  TextColumn get unit => text().withDefault(const Constant('pieces'))();
  RealColumn get pricePerUnit => real().withDefault(const Constant(0))();
  TextColumn get notes => text().withDefault(const Constant(''))();
  DateTimeColumn get updatedAt => dateTime()();
  TextColumn get recipeId =>
      text().nullable().references(Recipes, #id, onDelete: KeyAction.setNull)();
  TextColumn get formResponsesJson => text().nullable()();
  TextColumn get tierLabel => text().nullable()();
  TextColumn get variantBreakdownJson => text().nullable()();
  DateTimeColumn get preorderDate => dateTime().nullable()();

  @override
  Set<Column> get primaryKey => {id};
}

class BakingTasks extends Table {
  TextColumn get id => text()();
  TextColumn get title => text()();
  DateTimeColumn get dueDate => dateTime()();
  BoolColumn get isCompleted => boolean().withDefault(const Constant(false))();
  TextColumn get notes => text().withDefault(const Constant(''))();
  DateTimeColumn get createdAt => dateTime()();
  DateTimeColumn get updatedAt => dateTime()();
  // Legacy single-order / single-recipe links (kept for backward compatibility).
  TextColumn get orderId =>
      text().nullable().references(Orders, #id, onDelete: KeyAction.setNull)();
  TextColumn get recipeId =>
      text().nullable().references(Recipes, #id, onDelete: KeyAction.setNull)();
  RealColumn get recipeMultiplier => real().withDefault(const Constant(1.0))();
  TextColumn get colorName => text().withDefault(const Constant('gold'))();

  @override
  Set<Column> get primaryKey => {id};
}

/// Multi-order links on a BakingTask — many-to-many junction (nullify
/// semantics: deleting either side just removes the junction row).
class BakingTaskOrders extends Table {
  TextColumn get taskId =>
      text().references(BakingTasks, #id, onDelete: KeyAction.cascade)();
  TextColumn get orderId =>
      text().references(Orders, #id, onDelete: KeyAction.cascade)();

  @override
  Set<Column> get primaryKey => {taskId, orderId};
}

/// Multi-recipe links on a BakingTask.
class BakingTaskRecipes extends Table {
  TextColumn get taskId =>
      text().references(BakingTasks, #id, onDelete: KeyAction.cascade)();
  TextColumn get recipeId =>
      text().references(Recipes, #id, onDelete: KeyAction.cascade)();

  @override
  Set<Column> get primaryKey => {taskId, recipeId};
}

class IngredientCosts extends Table {
  TextColumn get id => text()();
  TextColumn get ingredientName => text()();
  RealColumn get purchaseCost => real().withDefault(const Constant(0))();
  RealColumn get purchaseAmount => real().withDefault(const Constant(1))();
  TextColumn get purchaseUnit => text().withDefault(const Constant('lb'))();
  DateTimeColumn get createdAt => dateTime()();
  DateTimeColumn get updatedAt => dateTime()();

  @override
  Set<Column> get primaryKey => {id};
}

class IngredientDensities extends Table {
  TextColumn get id => text()();
  TextColumn get name => text()();
  RealColumn get gramsPerCup => real()();
  BoolColumn get isCustom => boolean().withDefault(const Constant(false))();
  DateTimeColumn get updatedAt => dateTime()();

  @override
  Set<Column> get primaryKey => {id};
}
