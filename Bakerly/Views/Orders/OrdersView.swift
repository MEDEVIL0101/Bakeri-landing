import SwiftUI
import SwiftData

// MARK: - OrdersView

struct OrdersView: View {
    @Environment(\.modelContext) private var modelContext
    @Query(sort: \Order.dueDate) private var orders: [Order]
    @EnvironmentObject private var settings: UserSettings

    @State private var searchText          = ""
    @State private var selectedStatus: OrderStatus? = nil
    @State private var showingAddOrder     = false
    @State private var selectedOrder: Order? = nil
    @State private var orderToDelete: Order? = nil
    @State private var showingDeleteAlert  = false

    // MARK: - Filtering

    private var filteredOrders: [Order] {
        orders.filter { order in
            let matchesSearch = searchText.isEmpty
                || order.customerName.localizedCaseInsensitiveContains(searchText)
                || order.itemSummary.localizedCaseInsensitiveContains(searchText)
            let matchesStatus = selectedStatus == nil || order.status == selectedStatus
            return matchesSearch && matchesStatus
        }
    }

    private var groupedOrders: [(status: OrderStatus, orders: [Order])] {
        let statuses: [OrderStatus] = selectedStatus == nil
            ? OrderStatus.allCases
            : [selectedStatus!]
        return statuses.compactMap { status in
            let group = filteredOrders.filter { $0.status == status }
            return group.isEmpty ? nil : (status, group)
        }
    }

    // MARK: - Dashboard Stats

    private var thisMonthRevenue: Double {
        let start = Date().startOfMonth
        let end   = Date().endOfMonth
        return orders
            .filter { $0.dueDate >= start && $0.dueDate <= end && $0.status != .cancelled }
            .reduce(0) { $0 + $1.totalPrice }
    }

    private var ordersDueThisWeek: Int {
        let end = Calendar.current.date(byAdding: .day, value: 7, to: Date()) ?? Date()
        return orders.filter { $0.dueDate <= end && $0.status.isActive }.count
    }

    private var avgOrderValue: Double {
        guard !orders.isEmpty else { return 0 }
        let total = orders.filter { $0.status != .cancelled }.reduce(0) { $0 + $1.totalPrice }
        let count = orders.filter { $0.status != .cancelled }.count
        return count > 0 ? total / Double(count) : 0
    }

    // MARK: - Body

    var body: some View {
        NavigationStack {
            Group {
                if orders.isEmpty {
                    EmptyStateView.orders { showingAddOrder = true }
                } else {
                    ordersList
                }
            }
            .navigationTitle("Orders")
            .searchable(text: $searchText, prompt: "Search by name or item…")
            .toolbar { toolbar }
            .safeAreaInset(edge: .bottom) {
                addButton
            }
            .sheet(isPresented: $showingAddOrder) {
                AddEditOrderView()
            }
            .navigationDestination(item: $selectedOrder) { order in
                OrderDetailView(order: order)
            }
            .confirmationDialog("Delete Order", isPresented: $showingDeleteAlert, titleVisibility: .visible) {
                Button("Delete", role: .destructive) {
                    if let order = orderToDelete {
                        modelContext.delete(order)
                        try? modelContext.save()
                    }
                }
            } message: {
                Text("This cannot be undone.")
            }
        }
    }

    // MARK: - Orders List

    private var ordersList: some View {
        List {
            // Dashboard card
            Section {
                dashboardCard
                    .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
            }

            // Status filter chips
            Section {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        statusChip(nil, label: "All")
                        ForEach(OrderStatus.allCases) { status in
                            statusChip(status, label: status.rawValue)
                        }
                    }
                    .padding(.vertical, 4)
                }
                .listRowInsets(EdgeInsets(top: 4, leading: 16, bottom: 4, trailing: 16))
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)
            }

            // Grouped by status
            ForEach(groupedOrders, id: \.status) { group in
                Section {
                    ForEach(group.orders) { order in
                        OrderRowView(order: order)
                            .contentShape(Rectangle())
                            .onTapGesture { selectedOrder = order }
                            .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                                Button(role: .destructive) {
                                    orderToDelete = order
                                    showingDeleteAlert = true
                                } label: {
                                    Label("Delete", systemImage: "trash")
                                }
                                if let next = order.status.next {
                                    Button {
                                        order.status = next
                                        try? modelContext.save()
                                        UIImpactFeedbackGenerator(style: .light).impactOccurred()
                                    } label: {
                                        Label(next.rawValue, systemImage: next.sfSymbol)
                                    }
                                    .tint(next.statusColor)
                                }
                            }
                            .swipeActions(edge: .leading) {
                                Button {
                                    order.isPaid.toggle()
                                    try? modelContext.save()
                                } label: {
                                    Label(order.isPaid ? "Unpaid" : "Mark Paid",
                                          systemImage: order.isPaid ? "dollarsign.circle" : "dollarsign.circle.fill")
                                }
                                .tint(.bakerlyBlue)
                            }
                    }
                } header: {
                    HStack {
                        Image(systemName: group.status.sfSymbol)
                            .foregroundStyle(group.status.statusColor)
                        Text(group.status.rawValue)
                            .font(BakerlyFont.subheading(14))
                        Text("(\(group.orders.count))")
                            .font(BakerlyFont.caption())
                            .foregroundStyle(Color.secondary)
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .refreshable { }
    }

    // MARK: - Dashboard Card

    private var dashboardCard: some View {
        HStack(spacing: 0) {
            dashboardStat(
                label: "Month Revenue",
                value: thisMonthRevenue.asCurrency,
                icon: "banknote.fill",
                color: .bakerlyGold
            )
            Divider().frame(height: 40)
            dashboardStat(
                label: "Due This Week",
                value: "\(ordersDueThisWeek)",
                icon: "calendar.badge.clock",
                color: .bakerlyOrange
            )
            Divider().frame(height: 40)
            dashboardStat(
                label: "Avg Order",
                value: avgOrderValue.asCurrency,
                icon: "chart.bar.fill",
                color: .bakerlyBlue
            )
        }
        .padding(.vertical, 16)
        .bakerlyCard()
    }

    private func dashboardStat(label: String, value: String, icon: String, color: Color) -> some View {
        VStack(spacing: 4) {
            Image(systemName: icon).font(.system(size: 16)).foregroundStyle(color)
            Text(value).font(BakerlyFont.subheading(15))
            Text(label).font(BakerlyFont.caption(11)).foregroundStyle(Color.secondary)
        }
        .frame(maxWidth: .infinity)
    }

    // MARK: - Status Chip

    private func statusChip(_ status: OrderStatus?, label: String) -> some View {
        let isSelected = selectedStatus == status
        return Button {
            withAnimation(.spring(response: 0.3)) {
                selectedStatus = isSelected ? nil : status
            }
        } label: {
            Text(label)
                .font(.system(size: 13, weight: .semibold, design: .rounded))
                .foregroundStyle(isSelected ? .white : (status?.statusColor ?? Color.bakerlyTerracotta))
                .padding(.horizontal, 14)
                .padding(.vertical, 7)
                .background(isSelected
                    ? (status?.statusColor ?? Color.bakerlyTerracotta)
                    : (status?.statusBgColor ?? Color.bakerlyTerracotta.opacity(0.1)))
                .clipShape(Capsule())
        }
    }

    // MARK: - FAB

    private var addButton: some View {
        HStack {
            Spacer()
            Button {
                UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                showingAddOrder = true
            } label: {
                Label("New Order", systemImage: "plus")
                    .font(.system(size: 16, weight: .semibold, design: .rounded))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 20)
                    .padding(.vertical, 14)
                    .background(Color.bakerlyTerracotta)
                    .clipShape(Capsule())
                    .shadow(color: Color.bakerlyTerracotta.opacity(0.4), radius: 12, x: 0, y: 6)
            }
            .padding(.trailing, 20)
            .padding(.bottom, 12)
            .accessibilityLabel("New Order")
        }
    }

    // MARK: - Toolbar

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        ToolbarItem(placement: .topBarTrailing) {
            NavigationLink(destination: SettingsView()) {
                Image(systemName: "gearshape")
                    .accessibilityLabel("Settings")
            }
        }
    }
}

// MARK: - OrderRowView

struct OrderRowView: View {
    let order: Order

    var body: some View {
        HStack(spacing: 12) {
            // Status indicator dot
            Circle()
                .fill(order.status.statusColor)
                .frame(width: 10, height: 10)

            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(order.customerName)
                        .font(BakerlyFont.subheading())
                    Spacer()
                    Text(order.formattedTotal)
                        .font(BakerlyFont.subheading(15))
                        .foregroundStyle(Color.primary)
                }

                Text(order.itemSummary)
                    .font(BakerlyFont.caption())
                    .foregroundStyle(Color.secondary)
                    .lineLimit(1)

                HStack(spacing: 8) {
                    Label(order.dueDate.relativeDisplay, systemImage: "calendar")
                        .font(BakerlyFont.caption(12))
                        .foregroundStyle(order.isOverdue ? Color.bakerlyRed : Color.secondary)

                    if order.isPaid {
                        Label("Paid", systemImage: "checkmark.circle.fill")
                            .font(BakerlyFont.caption(12))
                            .foregroundStyle(Color.bakerlyBlue)
                    }

                    Spacer()
                    StatusPill(status: order.status)
                }
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }
}
