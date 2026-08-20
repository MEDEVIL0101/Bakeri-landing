//
//  OrdersView.swift
//  Bakeri Admin
//
//  Master list of all platform orders. Supports search, status filter, and source filter.
//

import SwiftUI

struct OrdersView: View {
    @Binding var selectedOrder: AdminOrder?

    @State private var orders: [AdminOrder] = []
    @State private var isLoading = false
    @State private var searchText = ""
    @State private var statusFilter: String? = nil
    @State private var sourceFilter: String? = nil

    private let statusOptions: [String?] = [nil, "pending", "confirmed", "accepted", "completed", "admin_cancelled", "cancelled"]
    private let sourceOptions: [String?] = [nil, "marketplace", "manual"]

    private var filtered: [AdminOrder] {
        orders.filter { order in
            let matchSearch = searchText.isEmpty
                || (order.order_name.localizedCaseInsensitiveContains(searchText))
                || (order.customer_name?.localizedCaseInsensitiveContains(searchText) == true)
                || (order.buyer_display_name?.localizedCaseInsensitiveContains(searchText) == true)
                || (order.baker_display_name?.localizedCaseInsensitiveContains(searchText) == true)
            let matchStatus = statusFilter == nil
                || (order.marketplace_status ?? order.status) == statusFilter
            let matchSource = sourceFilter == nil || order.order_source == sourceFilter
            return matchSearch && matchStatus && matchSource
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            headerBar
            Divider().background(DS.cardBorder)
            filterBar
            Divider().background(DS.cardBorder)
            if isLoading {
                Spacer()
                ProgressView("Loading orders…").foregroundStyle(DS.textSecondary)
                Spacer()
            } else if filtered.isEmpty {
                Spacer()
                EmptyDetailView(icon: "bag", message: "No orders match your filters")
                Spacer()
            } else {
                List(filtered, selection: $selectedOrder) { order in
                    OrderRowView(order: order, isSelected: selectedOrder?.id == order.id)
                        .tag(order)
                        .listRowInsets(EdgeInsets())
                        .listRowSeparator(.hidden)
                        .listRowBackground(Color.clear)
                }
                .listStyle(.plain)
                .scrollContentBackground(.hidden)
                .background(DS.pageBg)
            }
        }
        .background(DS.pageBg)
        .task { await load() }
        .refreshable { await load() }
    }

    // MARK: - Header

    private var headerBar: some View {
        HStack(spacing: 10) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 12))
                .foregroundStyle(DS.textTertiary)
            TextField("Search orders, bakers, buyers…", text: $searchText)
                .textFieldStyle(.plain)
                .font(.system(size: 13))
            if !searchText.isEmpty {
                Button { searchText = "" } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(DS.textTertiary)
                }
                .buttonStyle(.plain)
            }
            Spacer()
            Text("\(filtered.count) orders")
                .font(.system(size: 11))
                .foregroundStyle(DS.textTertiary)
            Button { Task { await load() } } label: {
                Image(systemName: "arrow.clockwise")
                    .font(.system(size: 12))
                    .foregroundStyle(DS.textSecondary)
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
    }

    // MARK: - Filter bar

    private var filterBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                filterChip("All Statuses", selected: statusFilter == nil) { statusFilter = nil }
                filterChip("Pending",       selected: statusFilter == "pending")           { statusFilter = "pending" }
                filterChip("Confirmed",     selected: statusFilter == "confirmed")         { statusFilter = "confirmed" }
                filterChip("Completed",     selected: statusFilter == "completed")         { statusFilter = "completed" }
                filterChip("Cancelled",     selected: statusFilter == "admin_cancelled" || statusFilter == "cancelled") {
                    statusFilter = "admin_cancelled"
                }
                Divider().frame(height: 16)
                filterChip("All Sources",   selected: sourceFilter == nil)                 { sourceFilter = nil }
                filterChip("Marketplace",   selected: sourceFilter == "marketplace")       { sourceFilter = "marketplace" }
                filterChip("Manual",        selected: sourceFilter == "manual")            { sourceFilter = "manual" }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
        }
        .background(DS.pageBg)
    }

    private func filterChip(_ label: String, selected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(label)
                .font(.system(size: 11, weight: selected ? .semibold : .regular))
                .foregroundStyle(selected ? DS.brand : DS.textSecondary)
                .padding(.horizontal, 10)
                .padding(.vertical, 5)
                .background(selected ? DS.brand.opacity(0.10) : DS.cardBg)
                .clipShape(Capsule())
                .overlay(Capsule().strokeBorder(selected ? DS.brand.opacity(0.30) : DS.cardBorder, lineWidth: 1))
        }
        .buttonStyle(.plain)
    }

    // MARK: - Data

    private func load() async {
        isLoading = true
        orders = (try? await SupabaseAdminService.shared.fetchAllOrders()) ?? []
        isLoading = false
    }
}

// MARK: - Order row

private struct OrderRowView: View {
    let order: AdminOrder
    let isSelected: Bool

    var body: some View {
        HStack(spacing: 12) {
            ZStack {
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(order.sourceColor.opacity(0.12))
                    .frame(width: 36, height: 36)
                Image(systemName: order.isMarketplace ? "bag.fill" : "square.and.pencil")
                    .font(.system(size: 14))
                    .foregroundStyle(order.sourceColor)
            }

            VStack(alignment: .leading, spacing: 3) {
                Text(order.order_name)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(DS.textPrimary)
                    .lineLimit(1)
                HStack(spacing: 4) {
                    if let baker = order.baker_display_name, !baker.isEmpty {
                        Text(baker).font(.system(size: 11)).foregroundStyle(DS.textSecondary)
                        Text("→").font(.system(size: 10)).foregroundStyle(DS.textTertiary)
                    }
                    Text(order.counterpart)
                        .font(.system(size: 11))
                        .foregroundStyle(DS.textSecondary)
                }
            }

            Spacer()

            VStack(alignment: .trailing, spacing: 4) {
                Text(order.displayStatus)
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(order.statusColor)
                    .padding(.horizontal, 7).padding(.vertical, 2)
                    .background(order.statusColor.opacity(0.10))
                    .clipShape(Capsule())

                if let paid = order.is_paid {
                    Text(paid ? "Paid" : "Unpaid")
                        .font(.system(size: 10))
                        .foregroundStyle(paid ? DS.success : DS.textTertiary)
                }
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(isSelected ? DS.brand.opacity(0.06) : DS.pageBg)
        .contentShape(Rectangle())
    }
}
