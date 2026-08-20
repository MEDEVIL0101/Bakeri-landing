// Ported 1:1 from Bakerly/Bakerly/Bakeri/Models/Order.swift.
import 'dart:typed_data';
import 'enums.dart';
import 'box_item.dart';
import 'intake_form.dart';

/// `PaymentFlow` isn't defined in Enums.swift/Order.swift itself — it's read
/// from MarketplaceModels.swift/BuyerOrderModels.swift (marketplace scope,
/// not ported). Kept minimal here since `Order.paymentFlow` only needs the
/// raw-value round-trip; values match the payment_flow strings documented
/// in the storefront/edge-function contract (rebuild spec §8.5).
enum PaymentFlow {
  authHold,
  depositAndSave,
  setupIntent,
  immediate;

  String get rawValue => switch (this) {
        PaymentFlow.authHold => 'auth_hold',
        PaymentFlow.depositAndSave => 'deposit_and_save',
        PaymentFlow.setupIntent => 'setup_intent',
        PaymentFlow.immediate => 'immediate',
      };

  static PaymentFlow fromRawValue(String raw) =>
      PaymentFlow.values.firstWhere((f) => f.rawValue == raw, orElse: () => PaymentFlow.authHold);
}

class Order {
  String id;
  String orderName;
  String customerName;
  String customerPhone;
  String customerEmail;
  DateTime dueDate;
  OrderStatus status;
  String notes;
  bool isPaid;
  DateTime? paidAt;
  String paymentNote;
  double depositAmount;
  DateTime? depositPaidAt;
  String depositNote;
  DateTime createdAt;
  DateTime updatedAt;
  FulfillmentType fulfillmentType;
  String deliveryDetails;

  /// User-chosen calendar dot colour.
  EventColor colorName;
  /// Optional start date — when set, the order spans startDate through dueDate.
  DateTime? startDate;

  List<Uint8List> referencePhotos;
  List<Uint8List> referenceDocuments;
  List<String> referenceDocumentNames;

  // MARK: Marketplace fields (order lifecycle, not the cross-baker system)
  OrderSource orderSource;
  MarketplaceStatus? marketplaceStatus;
  String? buyerProfileId;
  String buyerDisplayName;
  DateTime? scheduledPickupDate;
  String? paymentIntentId;
  String? paymentStatus;
  PaymentFlow paymentFlow;
  int depositAmountCents;
  double? quotedPrice;
  /// Baker's note attached when sending a custom-order quote.
  String? quoteNote;
  /// Baker's reason for declining a request.
  String? declineMessage;
  /// Synced count of order_messages rows.
  int messageCount;
  /// Short shareable code for the pay-by-invoice-code feature.
  String? invoiceCode;
  /// Structured intake-form answers captured on a custom-quote request.
  List<IntakeFormAnswer> formResponses;
  /// "website" for guest orders placed via the public storefront/custom-order
  /// pages; null for orders placed through the app.
  String? leadChannel;
  /// Real payout breakdown, written server-side by release-baker-payouts —
  /// null until then.
  int? platformFeeCents;
  int? stripeFeeCents;
  int? bakerPayoutCents;

  List<OrderItem> orderItems;
  List<String> bakingTaskIds;

  Order({
    required this.id,
    this.orderName = '',
    required this.customerName,
    this.customerPhone = '',
    this.customerEmail = '',
    DateTime? dueDate,
    this.status = OrderStatus.confirmed,
    this.notes = '',
    this.isPaid = false,
    this.paidAt,
    this.paymentNote = '',
    this.depositAmount = 0,
    this.depositPaidAt,
    this.depositNote = '',
    DateTime? createdAt,
    DateTime? updatedAt,
    this.fulfillmentType = FulfillmentType.pickup,
    this.deliveryDetails = '',
    this.colorName = EventColor.red,
    this.startDate,
    List<Uint8List>? referencePhotos,
    List<Uint8List>? referenceDocuments,
    List<String>? referenceDocumentNames,
    this.orderSource = OrderSource.manual,
    this.marketplaceStatus,
    this.buyerProfileId,
    this.buyerDisplayName = '',
    this.scheduledPickupDate,
    this.paymentIntentId,
    this.paymentStatus,
    this.paymentFlow = PaymentFlow.authHold,
    this.depositAmountCents = 0,
    this.quotedPrice,
    this.quoteNote,
    this.declineMessage,
    this.messageCount = 0,
    this.invoiceCode,
    List<IntakeFormAnswer>? formResponses,
    this.leadChannel,
    this.platformFeeCents,
    this.stripeFeeCents,
    this.bakerPayoutCents,
    List<OrderItem>? orderItems,
    List<String>? bakingTaskIds,
  })  : dueDate = dueDate ?? DateTime.now().add(const Duration(days: 3)),
        createdAt = createdAt ?? DateTime.now(),
        updatedAt = updatedAt ?? DateTime.now(),
        referencePhotos = referencePhotos ?? [],
        referenceDocuments = referenceDocuments ?? [],
        referenceDocumentNames = referenceDocumentNames ?? [],
        formResponses = formResponses ?? [],
        orderItems = orderItems ?? [],
        bakingTaskIds = bakingTaskIds ?? [];

  void touch() => updatedAt = DateTime.now();

  /// Stamps the current time as the payment date and marks the order paid.
  /// Preserves an existing paidAt so editing an order twice doesn't reset it.
  void markPaid() {
    isPaid = true;
    paidAt ??= DateTime.now();
    touch();
  }

  /// Clears payment state entirely.
  void markUnpaid() {
    isPaid = false;
    paidAt = null;
    touch();
  }

  /// Stamps the deposit received date. Safe to call repeatedly.
  void markDepositPaid() {
    depositPaidAt ??= DateTime.now();
    touch();
  }

  /// Revenue received from this order that falls within [start, end).
  /// Deposit is counted on depositPaidAt; balance (or full amount) on
  /// paidAt ?? updatedAt.
  double revenueReceived(DateTime start, DateTime end) {
    if (status == OrderStatus.cancelled) return 0;
    var total = 0.0;
    if (depositAmount > 0 && depositPaidAt != null) {
      if (!depositPaidAt!.isBefore(start) && depositPaidAt!.isBefore(end)) {
        total += depositAmount;
      }
    }
    if (isPaid) {
      final balanceDate = paidAt ?? updatedAt;
      final balance = depositAmount > 0 ? (effectiveTotal - depositAmount).clamp(0, double.infinity) : effectiveTotal;
      if (!balanceDate.isBefore(start) && balanceDate.isBefore(end)) {
        total += balance;
      }
    }
    return total;
  }

  /// Transitions to .completed when the order is both delivered and paid.
  /// Call after any change to `status` or `isPaid`.
  void autoCompleteIfNeeded() {
    if (status == OrderStatus.delivered && isPaid) {
      status = OrderStatus.completed;
      touch();
    }
  }

  /// Reverts a completed order back to .delivered when payment is removed.
  void revertCompletionIfNeeded() {
    if (status == OrderStatus.completed) {
      status = OrderStatus.delivered;
    }
  }

  // MARK: Computed properties

  bool get isMarketplaceOrder => orderSource == OrderSource.marketplace;

  /// True for guest orders placed via the public storefront/custom-order web
  /// pages, as opposed to marketplace orders placed by a signed-in buyer.
  bool get isFromWebsite => leadChannel == 'website';

  /// True for a Custom-listing quote request the customer hasn't accepted
  /// yet — either not yet quoted (.pendingQuote) or quoted but not paid
  /// (.quoteProvided). `status` (the generic kitchen-workflow field) is
  /// unreliable here: submitQuoteRequest hardcodes it to "Confirmed" at
  /// request time and nothing ever advances it as the quote progresses, so
  /// anything reading `status` alone (financial reports, revenue totals)
  /// sees a real accepted order, not a still-pending quote —
  /// `marketplaceStatus` is the field that's actually kept current.
  bool get isUnacceptedQuote {
    if (!isMarketplaceOrder || marketplaceStatus == null) return false;
    return marketplaceStatus == MarketplaceStatus.pendingQuote ||
        marketplaceStatus == MarketplaceStatus.quoteProvided;
  }

  double get totalPrice => orderItems.fold(0.0, (sum, item) => sum + item.pricePerUnit * item.quantity);

  double get effectiveTotal {
    if (quotedPrice != null && quotedPrice! > 0) return quotedPrice!;
    return totalPrice;
  }

  // Bakeri's 5% service charge always comes out of the baker's own price
  // (see supabase/functions/_shared/fees.ts, the shared source of truth).
  // For in-app orders it's *also* added on top of what the customer pays;
  // for guest/website orders the customer never sees it — baker-side only.
  static const double platformFeeRate = 0.05;
  // Standard CA card rate, used only for the pre-payout estimate below.
  static const double estimatedStripeFeeRate = 0.029;
  static const double estimatedStripeFeeFlat = 0.30;

  /// True once release-baker-payouts has actually run for this order (24h+
  /// after completion) and written the real Stripe/platform fee split back.
  bool get hasActualPayoutFigures => bakerPayoutCents != null;

  /// Net amount the baker actually receives (or is estimated to receive).
  double get netPayoutEstimate {
    if (bakerPayoutCents != null) return bakerPayoutCents! / 100;
    final serviceCharge = platformFeeCents != null ? platformFeeCents! / 100 : effectiveTotal * platformFeeRate;
    final stripeFee = effectiveTotal * estimatedStripeFeeRate + estimatedStripeFeeFlat;
    final net = effectiveTotal - serviceCharge - stripeFee;
    return net < 0 ? 0 : net;
  }

  bool get isOverdue => dueDate.isBefore(DateTime.now()) && status.isActive;

  bool get isDueToday {
    final now = DateTime.now();
    return dueDate.year == now.year && dueDate.month == now.month && dueDate.day == now.day;
  }

  bool get isDueSoon {
    final soon = DateTime.now().add(const Duration(hours: 48));
    return !dueDate.isAfter(soon) && status.isActive;
  }

  /// Primary display title — order name if set, otherwise customer name.
  String get displayTitle {
    final t = orderName.trim();
    return t.isEmpty ? customerName : t;
  }

  String get itemSummary {
    if (orderItems.isEmpty) return 'No items';
    return orderItems.map((i) => i.displayName).join(', ');
  }

  List<OrderItem> get sortedItems {
    final list = List<OrderItem>.of(orderItems);
    list.sort((a, b) => a.displayName.compareTo(b.displayName));
    return list;
  }
}

class OrderItem {
  String id;
  String customName;
  double quantity;
  YieldUnit unit;
  double pricePerUnit;
  String notes;
  DateTime updatedAt;
  String? orderId;
  String? recipeId;
  String? recipeName; // resolved display name, set by the repository layer

  /// Structured intake-form answers captured on a Ready Now/Pre-order cart item.
  List<IntakeFormAnswer> formResponses;

  /// Assorted Box purchases only. Both are server-written snapshots at order
  /// time — never overwritten by the baker's own app on sync push.
  String? tierLabel;
  List<BoxVariantSnapshot> variantBreakdown;

  /// Pre-order purchases only. Server-resolved pickup date for this specific
  /// line — an order can hold several preorder lines for the same listing
  /// on different dates, so this rides per-item rather than only on the
  /// order's own dueDate/scheduledPickupDate (which stays the earliest
  /// across lines). Server-written at order time, same never-overwritten
  /// rule as tierLabel/variantBreakdown above.
  DateTime? preorderDate;

  OrderItem({
    required this.id,
    this.customName = '',
    this.quantity = 1,
    this.unit = YieldUnit.pieces,
    this.pricePerUnit = 0,
    this.notes = '',
    DateTime? updatedAt,
    this.orderId,
    this.recipeId,
    this.recipeName,
    List<IntakeFormAnswer>? formResponses,
    this.tierLabel,
    List<BoxVariantSnapshot>? variantBreakdown,
    this.preorderDate,
  })  : updatedAt = updatedAt ?? DateTime.now(),
        formResponses = formResponses ?? [],
        variantBreakdown = variantBreakdown ?? [];

  void touch() => updatedAt = DateTime.now();

  double get lineTotal => pricePerUnit * quantity;

  String get displayName {
    if (customName.isNotEmpty) return customName;
    return recipeName ?? 'Custom Item';
  }
}
