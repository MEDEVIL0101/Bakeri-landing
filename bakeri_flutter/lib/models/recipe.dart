// Ported 1:1 from Bakerly/Bakerly/Bakeri/Models/Recipe.swift.
import 'dart:typed_data';
import 'enums.dart';

class Recipe {
  String id;
  String name;
  double yieldQuantity;
  YieldUnit yieldUnit;
  int prepTimeMinutes;
  int bakeTimeMinutes;
  String instructions;
  String notes;
  Uint8List? imageData;
  bool hasRemoteImage; // set true after a successful bucket upload
  List<String> tags;
  bool isFavorite;
  DateTime createdAt;
  DateTime updatedAt;
  List<RecipeIngredient> ingredients;

  Recipe({
    required this.id,
    required this.name,
    this.yieldQuantity = 1,
    this.yieldUnit = YieldUnit.servings,
    this.prepTimeMinutes = 0,
    this.bakeTimeMinutes = 0,
    this.instructions = '',
    this.notes = '',
    this.imageData,
    this.hasRemoteImage = false,
    List<String>? tags,
    this.isFavorite = false,
    DateTime? createdAt,
    DateTime? updatedAt,
    List<RecipeIngredient>? ingredients,
  })  : tags = tags ?? [],
        createdAt = createdAt ?? DateTime.now(),
        updatedAt = updatedAt ?? DateTime.now(),
        ingredients = ingredients ?? [];

  void touch() => updatedAt = DateTime.now();

  int get totalTimeMinutes => prepTimeMinutes + bakeTimeMinutes;

  String get formattedPrepTime => _formatMinutes(prepTimeMinutes);
  String get formattedBakeTime => _formatMinutes(bakeTimeMinutes);
  String get formattedTotalTime => _formatMinutes(totalTimeMinutes);

  String get yieldDescription {
    final qty = yieldQuantity % 1 == 0
        ? yieldQuantity.toInt().toString()
        : yieldQuantity.toStringAsFixed(1);
    return '$qty ${yieldUnit.rawValue}';
  }

  List<RecipeIngredient> get sortedIngredients {
    final list = List<RecipeIngredient>.of(ingredients);
    list.sort((a, b) => a.sortOrder.compareTo(b.sortOrder));
    return list;
  }

  static String _formatMinutes(int minutes) {
    if (minutes <= 0) return '—';
    if (minutes < 60) return '$minutes min';
    final h = minutes ~/ 60;
    final m = minutes % 60;
    return m == 0 ? '$h hr' : '$h hr $m min';
  }
}

class RecipeIngredient {
  String id;
  String name;
  double volumeAmount;
  VolumeUnit volumeUnit;

  /// Grams per 1 cup — serves as density factor for weight conversion.
  double gramsPerCup;
  String notes;
  int sortOrder;
  DateTime updatedAt;
  Uint8List? imageData;
  String? recipeId;

  RecipeIngredient({
    required this.id,
    required this.name,
    this.volumeAmount = 1,
    this.volumeUnit = VolumeUnit.cup,
    this.gramsPerCup = 120,
    this.notes = '',
    this.sortOrder = 0,
    DateTime? updatedAt,
    this.imageData,
    this.recipeId,
  }) : updatedAt = updatedAt ?? DateTime.now();

  void touch() => updatedAt = DateTime.now();

  /// Weight in grams for the stored volume amount.
  double get weightInGrams {
    final cups = (volumeAmount * volumeUnit.toMilliliters) / VolumeUnit.cup.toMilliliters;
    return cups * gramsPerCup;
  }

  double scaledVolumeAmount(double factor) => volumeAmount * factor;

  double scaledWeightInGrams(double factor) => weightInGrams * factor;

  /// Formatted volume string: "2 cups", "1 tbsp", etc.
  /// (Source uses "%.2g" fractional rendering — plain decimal here; a
  /// fraction-glyph formatter belongs in the view layer when
  /// AddEditRecipeView/RecipeDetailView are ported, matching the exact
  /// fraction-preset UI, not re-derived here.)
  String formattedVolume({double? amount}) {
    final amt = amount ?? volumeAmount;
    final formatted = amt % 1 == 0 ? amt.toInt().toString() : amt.toStringAsFixed(2);
    return '$formatted ${volumeUnit.abbreviation}';
  }
}
