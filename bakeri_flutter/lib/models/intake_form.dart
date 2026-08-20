// Ported 1:1 from Bakerly/Bakerly/Bakeri/Models/IntakeFormModels.swift.
import 'dart:convert';
import 'enums.dart';

/// A single pickable item within a `.productSelector` field. Snapshotted at
/// add-time (name/price) rather than joined live — same "flat,
/// self-describing" philosophy as `IntakeFormAnswer` below — so a form
/// keeps rendering and pricing correctly even if the source menu item is
/// later edited or deleted.
class FormProductOption {
  final String id;
  /// Links back to the baker's real MenuItem for traceability. Null for a
  /// one-off bundle item (e.g. "Party tray") added by hand, not from the catalog.
  final String? sourceMenuItemId;
  String name;
  double price;
  /// 0 means unlimited.
  int maxQuantity;

  FormProductOption({
    required this.id,
    this.sourceMenuItemId,
    required this.name,
    required this.price,
    this.maxQuantity = 0,
  });

  Map<String, dynamic> toJson() => {
        'id': id,
        'sourceMenuItemID': sourceMenuItemId,
        'name': name,
        'price': price,
        'maxQuantity': maxQuantity,
      };

  factory FormProductOption.fromJson(Map<String, dynamic> json) => FormProductOption(
        id: json['id'] as String,
        sourceMenuItemId: json['sourceMenuItemID'] as String?,
        name: json['name'] as String,
        price: (json['price'] as num).toDouble(),
        maxQuantity: json['maxQuantity'] as int? ?? 0,
      );
}

class IntakeFormField {
  final String id;
  int position;
  IntakeFieldType fieldType;
  String label;
  String? helpText;
  bool isRequired;
  List<String> options;
  List<FormProductOption> productOptions;

  IntakeFormField({
    required this.id,
    required this.position,
    required this.fieldType,
    this.label = '',
    this.helpText,
    bool isRequired = true,
    List<String>? options,
    List<FormProductOption>? productOptions,
  })  : // Headings have nothing to answer, so they're never "required".
        isRequired = fieldType.isAnswerField ? isRequired : false,
        options = options ?? [],
        productOptions = productOptions ?? [];
}

class IntakeForm {
  final String id;
  String title;
  List<IntakeFormField> fields;
  DateTime updatedAt;

  IntakeForm({
    required this.id,
    this.title = '',
    List<IntakeFormField>? fields,
    DateTime? updatedAt,
  })  : fields = fields ?? [],
        updatedAt = updatedAt ?? DateTime.now();

  int get answerFieldCount => fields.where((f) => f.fieldType.isAnswerField).length;
}

/// A submitted quantity against one `FormProductOption` — snapshots
/// name/unitPrice at submission time, same flat-and-self-describing
/// reasoning as `IntakeFormAnswer` itself.
class FormProductSelection {
  final String id;
  String name;
  double unitPrice;
  int quantity;

  FormProductSelection({
    required this.id,
    required this.name,
    required this.unitPrice,
    required this.quantity,
  });

  double get lineTotal => unitPrice * quantity;

  Map<String, dynamic> toJson() =>
      {'id': id, 'name': name, 'unitPrice': unitPrice, 'quantity': quantity};

  factory FormProductSelection.fromJson(Map<String, dynamic> json) => FormProductSelection(
        id: json['id'] as String,
        name: json['name'] as String,
        unitPrice: (json['unitPrice'] as num).toDouble(),
        quantity: json['quantity'] as int,
      );
}

/// Flat, self-describing shape so a submitted answer still reads correctly
/// even if the source form/field is edited or deleted afterward.
class IntakeFormAnswer {
  final String fieldId;
  final String label;
  final IntakeFieldType fieldType;
  String? textValue;
  List<String>? choiceValues;
  List<String>? photoPaths;
  List<FormProductSelection>? productSelections;

  IntakeFormAnswer({
    required this.fieldId,
    required this.label,
    required this.fieldType,
    this.textValue,
    this.choiceValues,
    this.photoPaths,
    this.productSelections,
  });

  String get id => fieldId;

  /// Sum of `quantity * unitPrice` across selections with quantity > 0.
  double get productSelectionsTotal =>
      (productSelections ?? []).fold(0.0, (sum, s) => sum + s.unitPrice * s.quantity);

  /// Single-line rendering for read-only Q&A displays.
  String get displayValue {
    switch (fieldType) {
      case IntakeFieldType.heading:
        return '';
      case IntakeFieldType.shortText:
      case IntakeFieldType.longText:
      case IntakeFieldType.number:
        final v = textValue?.trim() ?? '';
        return v.isEmpty ? '—' : v;
      case IntakeFieldType.date:
        final raw = textValue;
        if (raw == null) return '—';
        final date = DateTime.tryParse(raw);
        if (date == null) return raw.isEmpty ? '—' : raw;
        return '${date.month}/${date.day}/${date.year}';
      case IntakeFieldType.singleChoice:
        return (choiceValues != null && choiceValues!.isNotEmpty) ? choiceValues!.first : '—';
      case IntakeFieldType.multiChoice:
        if (choiceValues == null || choiceValues!.isEmpty) return '—';
        return choiceValues!.join(', ');
      case IntakeFieldType.photo:
        final count = photoPaths?.length ?? 0;
        return count > 0 ? '$count photo${count == 1 ? '' : 's'}' : '—';
      case IntakeFieldType.productSelector:
        final selections = (productSelections ?? []).where((s) => s.quantity > 0).toList();
        if (selections.isEmpty) return '—';
        final itemCount = selections.fold<int>(0, (sum, s) => sum + s.quantity);
        return '$itemCount item${itemCount == 1 ? '' : 's'} · \$${productSelectionsTotal.toStringAsFixed(2)}';
    }
  }

  /// True when this answer has no content worth submitting or displaying.
  bool get isBlank {
    switch (fieldType) {
      case IntakeFieldType.heading:
        return true;
      case IntakeFieldType.shortText:
      case IntakeFieldType.longText:
      case IntakeFieldType.number:
      case IntakeFieldType.date:
        return (textValue?.trim().isEmpty) ?? true;
      case IntakeFieldType.singleChoice:
      case IntakeFieldType.multiChoice:
        return choiceValues?.isEmpty ?? true;
      case IntakeFieldType.photo:
        return photoPaths?.isEmpty ?? true;
      case IntakeFieldType.productSelector:
        return !(productSelections ?? []).any((s) => s.quantity > 0);
    }
  }

  Map<String, dynamic> toJson() => {
        'fieldID': fieldId,
        'label': label,
        'fieldType': fieldType.rawValue,
        'textValue': textValue,
        'choiceValues': choiceValues,
        'photoPaths': photoPaths,
        'productSelections': productSelections?.map((s) => s.toJson()).toList(),
      };

  factory IntakeFormAnswer.fromJson(Map<String, dynamic> json) => IntakeFormAnswer(
        fieldId: json['fieldID'] as String,
        label: json['label'] as String,
        fieldType: IntakeFieldType.fromRawValue(json['fieldType'] as String),
        textValue: json['textValue'] as String?,
        choiceValues: (json['choiceValues'] as List<dynamic>?)?.cast<String>(),
        photoPaths: (json['photoPaths'] as List<dynamic>?)?.cast<String>(),
        productSelections: (json['productSelections'] as List<dynamic>?)
            ?.map((e) => FormProductSelection.fromJson(e as Map<String, dynamic>))
            .toList(),
      );

  /// Decodes a JSON string (from a synced `form_responses` jsonb column)
  /// into answers. Nil/blank/invalid input decodes to an empty array —
  /// callers treat "no structured answers" as the normal fallback rather
  /// than an error.
  static List<IntakeFormAnswer> decode(String? json) {
    if (json == null || json.isEmpty) return [];
    try {
      final list = jsonDecode(json) as List<dynamic>;
      return list.map((e) => IntakeFormAnswer.fromJson(e as Map<String, dynamic>)).toList();
    } catch (_) {
      return [];
    }
  }
}

extension IntakeFormAnswerListEncoding on List<IntakeFormAnswer> {
  /// Serializes to a JSON string for storing on the order/order-item's
  /// `formResponsesJSON`-equivalent column. Empty list encodes to null.
  String? encodedJSON() {
    if (isEmpty) return null;
    return jsonEncode(map((e) => e.toJson()).toList());
  }
}
