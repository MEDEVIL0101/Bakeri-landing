//
//  OrderAdminDetailView.swift
//  Bakeri Admin
//
//  Full order detail for the admin Orders panel.
//  Shows order metadata, line items, message thread, and audit log.
//  Allows admin to cancel the order (with reason + refund flag).
//

import SwiftUI

struct OrderAdminDetailView: View {
    let order: AdminOrder
    var onCancelled: ((AdminOrder) -> Void)? = nil

    @State private var items: [AdminOrderItem]    = []
    @State private var messages: [AdminOrderMessage] = []
    @State private var auditLog: [AdminOrderAction]  = []

    @State private var isLoadingItems    = true
    @State private var isLoadingMessages = true
    @State private var isLoadingAudit    = true

    @State private var showCancelSheet   = false
    @State private var cancelReason      = ""
    @State private var refundRequested   = false
    @State private var isCancelling      = false
    @State private var cancelError: String? = nil

    @State private var isCancelled       = false

    private var effectiveStatus: String {
        isCancelled ? "admin_cancelled" : (order.marketplace_status ?? order.status)
    }
    private var canCancel: Bool {
        !isCancelled && !["admin_cancelled", "completed", "delivered", "cancelled"]
            .contains(effectiveStatus.lowercased())
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                orderHeader
                if !items.isEmpty || isLoadingItems {
                    lineItemsCard
                }
                messagesCard
                auditCard
                if canCancel {
                    cancelButton
                }
            }
            .padding(24)
        }
        .background(DS.pageBg)
        .sheet(isPresented: $showCancelSheet) {
            cancelSheet
        }
        .task { await loadAll() }
    }

    // MARK: - Order header card

    private var orderHeader: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(order.order_name)
                        .font(.system(size: 20, weight: .bold))
                        .foregroundStyle(DS.textPrimary)
                    HStack(spacing: 8) {
                        Text(order.sourceLabel)
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(order.sourceColor)
                            .padding(.horizontal, 8).padding(.vertical, 3)
                            .background(order.sourceColor.opacity(0.10))
                            .clipShape(Capsule())
                        Text(effectiveStatus.replacingOccurrences(of: "_", with: " ").capitalized)
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(isCancelled ? DS.danger : order.statusColor)
                            .padding(.horizontal, 8).padding(.vertical, 3)
                            .background((isCancelled ? DS.danger : order.statusColor).opacity(0.10))
                            .clipShape(Capsule())
                        if order.is_paid == true {
                            Text("Paid")
                                .font(.system(size: 11, weight: .semibold))
                                .foregroundStyle(DS.success)
                                .padding(.horizontal, 8).padding(.vertical, 3)
                                .background(DS.success.opacity(0.10))
                                .clipShape(Capsule())
                        }
                    }
                }
                Spacer()
            }

            Divider().background(DS.cardBorder)

            Grid(alignment: .leading, horizontalSpacing: 24, verticalSpacing: 10) {
                if let baker = order.baker_display_name {
                    metaRow("Baker", value: baker)
                }
                if let buyer = order.buyer_display_name ?? order.customer_name {
                    metaRow(order.isMarketplace ? "Buyer" : "Customer", value: buyer)
                }
                if let due = order.due_date {
                    metaRow("Due", value: formatDate(due))
                }
                metaRow("Placed", value: formatDate(order.created_at))
                if let ft = order.fulfillment_type, !ft.isEmpty {
                    metaRow("Fulfillment", value: ft.capitalized)
                }
                if let notes = order.notes, !notes.isEmpty {
                    metaRow("Notes", value: notes)
                }
            }
        }
        .cardStyle()
    }

    private func metaRow(_ label: String, value: String) -> some View {
        GridRow {
            Text(label)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(DS.textTertiary)
                .gridColumnAlignment(.trailing)
            Text(value)
                .font(.system(size: 13))
                .foregroundStyle(DS.textPrimary)
                .textSelection(.enabled)
                .gridColumnAlignment(.leading)
        }
    }

    // MARK: - Line items

    private var lineItemsCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionLabel(text: "Line Items")
            if isLoadingItems {
                ProgressView().padding(.vertical, 8)
            } else {
                VStack(spacing: 1) {
                    ForEach(items) { item in
                        HStack {
                            Text(item.displayName)
                                .font(.system(size: 13))
                                .foregroundStyle(DS.textPrimary)
                            Text("× \(item.qty) \(item.unitLabel)")
                                .font(.system(size: 12))
                                .foregroundStyle(DS.textSecondary)
                            Spacer()
                            Text(item.price > 0 ? "$\(item.lineTotal, specifier: "%.2f")" : "—")
                                .font(.system(size: 13, weight: .medium))
                                .foregroundStyle(DS.textPrimary)
                        }
                        .padding(.vertical, 6)
                        if item.id != items.last?.id { Divider().background(DS.cardBorder) }
                    }
                }
                if items.map({ $0.lineTotal }).reduce(0, +) > 0 {
                    Divider().background(DS.cardBorder)
                    HStack {
                        Spacer()
                        Text("Total")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(DS.textSecondary)
                        Text("$\(items.map({ $0.lineTotal }).reduce(0, +), specifier: "%.2f")")
                            .font(.system(size: 15, weight: .bold))
                            .foregroundStyle(DS.textPrimary)
                    }
                }
            }
        }
        .cardStyle()
    }

    // MARK: - Messages thread

    private var messagesCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionLabel(text: "Order Messages (\(messages.count))")
            if isLoadingMessages {
                ProgressView().padding(.vertical, 8)
            } else if messages.isEmpty {
                Text("No messages on this order.")
                    .font(.system(size: 13))
                    .foregroundStyle(DS.textTertiary)
                    .padding(.vertical, 4)
            } else {
                VStack(alignment: .leading, spacing: 10) {
                    ForEach(messages) { msg in
                        VStack(alignment: .leading, spacing: 3) {
                            HStack {
                                Text(msg.sender_profile_id.uuidString.prefix(8) + "…")
                                    .font(.system(size: 10, weight: .medium))
                                    .foregroundStyle(DS.textTertiary)
                                Spacer()
                                Text(formatDate(msg.created_at))
                                    .font(.system(size: 10))
                                    .foregroundStyle(DS.textTertiary)
                            }
                            Text(msg.message)
                                .font(.system(size: 13))
                                .foregroundStyle(DS.textPrimary)
                                .textSelection(.enabled)
                        }
                        .padding(10)
                        .background(DS.pageBg)
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                    }
                }
            }
        }
        .cardStyle()
    }

    // MARK: - Audit log

    private var auditCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionLabel(text: "Admin Audit Log")
            if isLoadingAudit {
                ProgressView().padding(.vertical, 8)
            } else if auditLog.isEmpty {
                Text("No admin actions on this order.")
                    .font(.system(size: 13))
                    .foregroundStyle(DS.textTertiary)
                    .padding(.vertical, 4)
            } else {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(auditLog) { entry in
                        HStack(alignment: .top, spacing: 10) {
                            Image(systemName: entry.actionIcon)
                                .font(.system(size: 14))
                                .foregroundStyle(entry.actionColor)
                                .frame(width: 20)
                            VStack(alignment: .leading, spacing: 2) {
                                HStack {
                                    Text(entry.actionLabel)
                                        .font(.system(size: 13, weight: .semibold))
                                        .foregroundStyle(DS.textPrimary)
                                    if entry.refund_requested {
                                        Text("Refund flagged")
                                            .font(.system(size: 10, weight: .medium))
                                            .foregroundStyle(DS.warning)
                                            .padding(.horizontal, 7).padding(.vertical, 2)
                                            .background(DS.warning.opacity(0.10))
                                            .clipShape(Capsule())
                                    }
                                    Spacer()
                                    Text(formatDate(entry.created_at))
                                        .font(.system(size: 10))
                                        .foregroundStyle(DS.textTertiary)
                                }
                                if !entry.reason.isEmpty {
                                    Text(entry.reason)
                                        .font(.system(size: 12))
                                        .foregroundStyle(DS.textSecondary)
                                        .textSelection(.enabled)
                                }
                            }
                        }
                        .padding(10)
                        .background(entry.actionColor.opacity(0.05))
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                    }
                }
            }
        }
        .cardStyle()
    }

    // MARK: - Cancel button

    private var cancelButton: some View {
        Button {
            cancelReason = ""
            refundRequested = order.isMarketplace
            cancelError = nil
            showCancelSheet = true
        } label: {
            HStack(spacing: 10) {
                Image(systemName: "xmark.circle.fill")
                    .font(.system(size: 16))
                Text("Cancel This Order")
                    .font(.system(size: 14, weight: .semibold))
            }
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 14)
            .background(DS.danger)
            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        }
        .buttonStyle(.plain)
    }

    // MARK: - Cancel sheet

    private var cancelSheet: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 12) {
                ZStack {
                    Circle().fill(DS.danger.opacity(0.12)).frame(width: 44, height: 44)
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 20))
                        .foregroundStyle(DS.danger)
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text("Cancel Order")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(DS.textPrimary)
                    Text("This cannot be undone. The order will be marked admin_cancelled.")
                        .font(.system(size: 13))
                        .foregroundStyle(DS.textSecondary)
                }
            }
            .padding(24)

            Divider().foregroundStyle(DS.cardBorder)
            VStack(alignment: .leading, spacing: 14) {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Reason (required)")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(DS.textSecondary)
                    TextEditor(text: $cancelReason)
                        .font(.system(size: 13))
                        .frame(height: 80)
                        .padding(8)
                        .background(DS.pageBg)
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                        .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(DS.cardBorder))
                }
                Toggle(isOn: $refundRequested) {
                    VStack(alignment: .leading, spacing: 1) {
                        Text("Flag for refund")
                            .font(.system(size: 13, weight: .medium))
                            .foregroundStyle(DS.textPrimary)
                        Text("Marks this in the audit log; does not process the refund automatically.")
                            .font(.system(size: 11))
                            .foregroundStyle(DS.textTertiary)
                    }
                }
                .toggleStyle(.switch)

                if let err = cancelError {
                    Text(err)
                        .font(.system(size: 12))
                        .foregroundStyle(DS.danger)
                }
            }
            .padding(.horizontal, 24)
            .padding(.vertical, 16)

            Divider().foregroundStyle(DS.cardBorder)
            HStack {
                Spacer()
                Button("Cancel") { showCancelSheet = false }
                    .buttonStyle(.plain)
                    .foregroundStyle(DS.textSecondary)
                    .padding(.horizontal, 20).padding(.vertical, 9)
                    .background(DS.cardBg)
                    .clipShape(RoundedRectangle(cornerRadius: 9))
                    .overlay(RoundedRectangle(cornerRadius: 9).strokeBorder(DS.cardBorder))
                    .disabled(isCancelling)

                Button {
                    Task { await performCancel() }
                } label: {
                    Group {
                        if isCancelling {
                            ProgressView().scaleEffect(0.7)
                        } else {
                            Text("Confirm Cancel")
                        }
                    }
                }
                .buttonStyle(.plain)
                .foregroundStyle(.white)
                .padding(.horizontal, 20).padding(.vertical, 9)
                .background(cancelReason.trimmingCharacters(in: .whitespaces).isEmpty || isCancelling
                    ? DS.danger.opacity(0.4) : DS.danger)
                .clipShape(RoundedRectangle(cornerRadius: 9))
                .disabled(cancelReason.trimmingCharacters(in: .whitespaces).isEmpty || isCancelling)
            }
            .padding(24)
        }
        .frame(width: 480)
        .background(DS.cardBg)
    }

    // MARK: - Data loading

    private func loadAll() async {
        async let itemFetch    = SupabaseAdminService.shared.fetchOrderItems(orderId: order.id)
        async let msgFetch     = SupabaseAdminService.shared.fetchOrderMessages(orderId: order.id)
        async let auditFetch   = SupabaseAdminService.shared.fetchOrderAuditLog(orderId: order.id)
        items    = (try? await itemFetch)    ?? []; isLoadingItems    = false
        messages = (try? await msgFetch)     ?? []; isLoadingMessages = false
        auditLog = (try? await auditFetch)   ?? []; isLoadingAudit    = false
    }

    private func performCancel() async {
        isCancelling = true
        cancelError  = nil
        do {
            try await SupabaseAdminService.shared.cancelOrder(
                orderId: order.id,
                reason: cancelReason.trimmingCharacters(in: .whitespaces),
                refundRequested: refundRequested
            )
            isCancelled = true
            auditLog = (try? await SupabaseAdminService.shared.fetchOrderAuditLog(orderId: order.id)) ?? auditLog
            showCancelSheet = false
            onCancelled?(order)
        } catch AdminError.orderNotCancellable {
            cancelError = "This order cannot be cancelled (already completed or cancelled)."
        } catch {
            cancelError = "Cancel failed: \(error.localizedDescription)"
        }
        isCancelling = false
    }

    // MARK: - Formatting

    private func formatDate(_ iso: String) -> String {
        let frac = ISO8601DateFormatter()
        frac.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let noFrac = ISO8601DateFormatter()
        noFrac.formatOptions = [.withInternetDateTime]
        let normalized = iso.replacingOccurrences(of: "+00:00", with: "Z")
        let date = frac.date(from: normalized) ?? noFrac.date(from: normalized)
        guard let d = date else { return iso }
        let f = DateFormatter()
        f.dateStyle = .medium; f.timeStyle = .short
        return f.string(from: d)
    }
}
