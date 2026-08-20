// Ported 1:1 from Bakerly/Bakerly/Bakeri/Models/BakingTask.swift.
import 'enums.dart';
import 'order.dart';

enum UrgencyLevel { done, overdue, today, upcoming }

class BakingTask {
  String id;
  String title;
  DateTime dueDate;
  bool isCompleted;
  String notes;
  DateTime createdAt;
  DateTime updatedAt;

  /// Legacy single-order / single-recipe links (kept for backward compatibility).
  String? orderId;
  String? recipeId;

  /// How many batches of each linked recipe this task requires. Defaults to 1.
  double recipeMultiplier;

  /// User-chosen calendar dot colour.
  EventColor colorName;

  /// Multi-order links — the primary field going forward.
  List<String> orderIds;
  /// Multi-recipe links — the primary field going forward.
  List<String> recipeIds;

  BakingTask({
    required this.id,
    required this.title,
    DateTime? dueDate,
    this.isCompleted = false,
    this.notes = '',
    DateTime? createdAt,
    DateTime? updatedAt,
    this.orderId,
    this.recipeId,
    this.recipeMultiplier = 1.0,
    this.colorName = EventColor.gold,
    List<String>? orderIds,
    List<String>? recipeIds,
  })  : dueDate = dueDate ?? DateTime.now(),
        createdAt = createdAt ?? DateTime.now(),
        updatedAt = updatedAt ?? DateTime.now(),
        orderIds = orderIds ?? [],
        recipeIds = recipeIds ?? [];

  void touch() => updatedAt = DateTime.now();

  bool get isDueToday {
    final now = DateTime.now();
    return dueDate.year == now.year && dueDate.month == now.month && dueDate.day == now.day;
  }

  bool get isOverdue => dueDate.isBefore(DateTime.now()) && !isCompleted;

  /// Prefer the new multi-order list; fall back to the legacy single-order
  /// field. Needs the resolved `Order`s passed in since this model layer
  /// doesn't own relationship-fetching (that's the repository's job).
  String displayTitle(List<Order> linkedOrders) {
    final linked = linkedOrders.isNotEmpty
        ? linkedOrders
        : (orderId != null ? <Order>[] : <Order>[]); // legacy single-order resolution happens in the repository
    if (linked.isEmpty) return title;
    final names = linked.map((o) => o.displayTitle).join(', ');
    return '$title — $names';
  }

  UrgencyLevel get urgencyLevel {
    if (isCompleted) return UrgencyLevel.done;
    if (isOverdue) return UrgencyLevel.overdue;
    if (isDueToday) return UrgencyLevel.today;
    return UrgencyLevel.upcoming;
  }
}
