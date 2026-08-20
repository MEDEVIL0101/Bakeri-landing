// Ported 1:1 from Bakerly/Bakerly/Bakeri/Models/BoxItemModels.swift.
import 'dart:convert';
import 'dart:typed_data';

/// One purchasable size option on an Assorted Box listing, e.g. "Box of 6"
/// at $18. unitCount is the total number of pieces the customer must
/// distribute across variants.
class BoxSizeTier {
  String id;
  String label;
  int unitCount;
  double price;
  int sortOrder;
  DateTime updatedAt;
  String? menuItemId;

  BoxSizeTier({
    required this.id,
    required this.label,
    this.unitCount = 1,
    this.price = 0,
    this.sortOrder = 0,
    DateTime? updatedAt,
    this.menuItemId,
  }) : updatedAt = updatedAt ?? DateTime.now();

  void touch() => updatedAt = DateTime.now();
}

/// One flavor/option a customer can choose within an Assorted Box, e.g.
/// "Chocolate Chip".
class BoxVariant {
  String id;
  String name;
  int sortOrder;
  DateTime updatedAt;
  bool hasRemoteImage; // set true after a successful bucket upload
  Uint8List? imageData;
  String? menuItemId;

  BoxVariant({
    required this.id,
    required this.name,
    this.sortOrder = 0,
    DateTime? updatedAt,
    this.hasRemoteImage = false,
    this.imageData,
    this.menuItemId,
  }) : updatedAt = updatedAt ?? DateTime.now();

  void touch() => updatedAt = DateTime.now();
}

/// A read-only, point-in-time record of a buyer's flavor picks for one order
/// line, stored as JSON so it never goes stale if the baker later
/// renames/deletes a variant.
class BoxVariantSnapshot {
  final String name;
  final int quantity;

  const BoxVariantSnapshot({required this.name, required this.quantity});

  String get id => name;

  Map<String, dynamic> toJson() => {'name': name, 'quantity': quantity};

  factory BoxVariantSnapshot.fromJson(Map<String, dynamic> json) =>
      BoxVariantSnapshot(name: json['name'] as String, quantity: json['quantity'] as int);

  static List<BoxVariantSnapshot> decode(String? json) {
    if (json == null || json.isEmpty) return [];
    try {
      final list = jsonDecode(json) as List<dynamic>;
      return list.map((e) => BoxVariantSnapshot.fromJson(e as Map<String, dynamic>)).toList();
    } catch (_) {
      return [];
    }
  }
}

extension BoxVariantSnapshotListEncoding on List<BoxVariantSnapshot> {
  /// Serializes to a JSON string for storing on the order item's
  /// `variantBreakdownJSON`-equivalent column. Empty list encodes to null,
  /// matching the source's "nil rather than an empty array" convention.
  String? encodedJSON() {
    if (isEmpty) return null;
    return jsonEncode(map((e) => e.toJson()).toList());
  }
}
