//
//  UserDossierView.swift
//  Bakeri Admin
//
//  Tabbed user dossier: Overview · Orders · Support.
//  Every stat is a portal — tap any number to drill into the underlying data.
//

import SwiftUI
import AppKit

struct UserDossierView: View {
    let user: AdminUser
    let onUpdated: (AdminUser) -> Void
    /// Called with the UUID of any counterpart whose profile should become the active dossier.
    var onNavigateToUser: ((UUID) -> Void)? = nil

    // Navigation
    @State private var activeTab: DossierTab = .overview

    // Orders
    @State private var orders: [AdminOrder] = []
    @State private var isLoadingOrders = false
    @State private var selectedOrder: AdminOrder?
    @State private var orderItems: [AdminOrderItem] = []
    @State private var isLoadingItems = false
    @State private var orderFilter: OrderFilter = .all

    // Support
    @State private var tickets: [FeedbackTicket] = []
    @State private var isLoadingTickets = false
    @State private var selectedTicket: FeedbackTicket?
    @State private var isUpdatingTicket = false

    // Listings drill-down
    @State private var userListings: [MarketplaceListing] = []
    @State private var isLoadingListings = false
    @State private var showListingsSheet = false

    // Admin actions
    @State private var banReason = ""
    @State private var showBanSheet = false
    @State private var showDeleteSheet = false
    @State private var deleteReason = ""
    @State private var actionFeedback: String?
    @State private var showSuccessToast = false

    // Overview listing counts (lightweight — separate from full listing objects)
    @State private var listingTotal = 0
    @State private var listingActive = 0
    @State private var listingMarketplace = 0

    // Financial metrics
    @State private var orderMetrics: UserOrderMetrics?

    // MARK: - Derived stats

    private var paidCount: Int        { orders.filter { $0.is_paid == true }.count }
    private var completedCount: Int   { orders.filter { $0.isCompleted }.count }
    private var marketplaceCount: Int { orders.filter { $0.isMarketplace }.count }
    private var openTicketCount: Int  { tickets.filter { $0.ticketStatus == .open }.count }
    private var accountAgeDays: Int   { max(0, Int(Date().timeIntervalSince(user.createdAt) / 86400)) }

    private var filteredOrders: [AdminOrder] {
        switch orderFilter {
        case .all:         return orders
        case .marketplace: return orders.filter { $0.isMarketplace }
        case .manual:      return orders.filter { !$0.isMarketplace }
        }
    }

    // MARK: - Enums

    enum DossierTab: String, CaseIterable {
        case overview = "Overview"; case orders = "Orders"; case support = "Support"
        var icon: String {
            switch self {
            case .overview: return "chart.bar.fill"
            case .orders:   return "bag.fill"
            case .support:  return "bubble.left.and.bubble.right.fill"
            }
        }
    }

    enum OrderFilter: String, CaseIterable {
        case all = "All"; case marketplace = "Marketplace"; case manual = "Manual"
    }

    // MARK: - Body

    var body: some View {
        ZStack(alignment: .bottom) {
            VStack(spacing: 0) {
                profileHeader
                Divider()
                tabBar
                Divider()
                Group {
                    switch activeTab {
                    case .overview: overviewTab
                    case .orders:   ordersTab
                    case .support:  supportTab
                    }
                }
                .frame(maxHeight: .infinity)
            }

            if showSuccessToast, let msg = actionFeedback {
                Text(msg)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 18).padding(.vertical, 10)
                    .background(DS.success.opacity(0.95))
                    .clipShape(Capsule())
                    .shadow(color: .black.opacity(0.15), radius: 8)
                    .padding(.bottom, 24)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                    .animation(.spring(response: 0.3), value: showSuccessToast)
            }
        }
        .task { await loadAll() }
        .onChange(of: user.id) { _, _ in
            activeTab = .overview
            Task { await loadAll() }
        }
        .sheet(isPresented: $showListingsSheet) {
            ListingsDrillSheet(
                bakerName: user.displayName,
                listings: userListings,
                isLoading: isLoadingListings
            )
        }
        .sheet(isPresented: $showBanSheet) {
            ConfirmDestructiveSheet(
                title: user.isBanned ? "Unban \(user.displayName)" : "Ban \(user.displayName)",
                message: user.isBanned ? "Restores the user's access immediately." : "User will be unable to sign in.",
                confirmLabel: user.isBanned ? "Unban" : "Ban",
                requiresReason: !user.isBanned, reason: $banReason
            ) { Task { await toggleBan() } }
        }
        .sheet(isPresented: $showDeleteSheet) {
            ConfirmDestructiveSheet(
                title: "Delete \(user.displayName)",
                message: "Permanently deletes the auth account and all data. Cannot be undone.",
                confirmLabel: "Delete Account",
                requiresReason: true, reason: $deleteReason
            ) { Task { await deleteUser() } }
        }
    }

    // MARK: - Profile header

    private var profileHeader: some View {
        HStack(alignment: .center, spacing: 16) {
            InitialsAvatar(name: user.displayName, size: 48, cornerRadius: 12, color: user.avatarColor)
            VStack(alignment: .leading, spacing: 5) {
                HStack(spacing: 8) {
                    Text(user.displayName).font(.system(size: 20, weight: .bold)).foregroundStyle(DS.textPrimary)
                    RoleBadge(isBaker: user.isBaker).fixedSize()
                    UserStatusBadge(status: user.accountStatus).fixedSize()
                }
                if let bakery = user.bakeryName {
                    HStack(spacing: 5) {
                        Image(systemName: "storefront").font(.system(size: 10)).foregroundStyle(DS.brand)
                        Text(bakery).font(.system(size: 12, weight: .medium)).foregroundStyle(DS.brand)
                    }
                }
                HStack(spacing: 14) {
                    metaDot("envelope", user.email)
                    metaDot("calendar", "Joined \(fmtDate(user.createdAt))")
                    if let loc = user.profile?.location, !loc.isEmpty { metaDot("mappin", loc) }
                }
            }
            Spacer()
            HStack(spacing: 8) {
                actionBtn(user.isBanned ? "Unban" : "Ban",
                          icon: user.isBanned ? "checkmark.circle.fill" : "hand.raised.fill",
                          color: user.isBanned ? DS.success : DS.danger) { showBanSheet = true }
                actionBtn("Delete", icon: "trash.fill", color: DS.danger) { showDeleteSheet = true }
            }
        }
        .padding(.horizontal, 24).padding(.vertical, 16)
        .background(DS.cardBg)
    }

    // MARK: - Tab bar

    private var tabBar: some View {
        HStack(spacing: 0) {
            ForEach(DossierTab.allCases, id: \.self) { tab in
                let isActive = activeTab == tab
                Button { activeTab = tab } label: {
                    HStack(spacing: 6) {
                        Image(systemName: tab.icon)
                            .font(.system(size: 11, weight: isActive ? .semibold : .regular))
                        Text(tab.rawValue)
                            .font(.system(size: 13, weight: isActive ? .semibold : .regular))
                        if tab == .support, !tickets.isEmpty {
                            badge(tickets.count, color: openTicketCount > 0 ? DS.danger : DS.textTertiary)
                        }
                        if tab == .orders, !orders.isEmpty {
                            badge(orders.count, color: DS.brand)
                        }
                    }
                    .foregroundStyle(isActive ? DS.brand : DS.textSecondary)
                    .padding(.horizontal, 18).padding(.vertical, 10)
                    .overlay(alignment: .bottom) {
                        if isActive { Rectangle().fill(DS.brand).frame(height: 2) }
                    }
                }
                .buttonStyle(.plain)
            }
            Spacer()
        }
        .background(DS.cardBg)
    }

    // MARK: - Overview tab

    private var overviewTab: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                statsRow
                if let metrics = orderMetrics, metrics.totalOrderValue > 0 { financialsSection(metrics) }
                if user.isBaker, !orders.isEmpty { performanceSection }
                if user.isBaker { listingStatsSection }
                profileDetailsSection
                if !tickets.isEmpty { recentSupportSection }
            }
            .padding(24)
        }
        .background(DS.pageBg)
    }

    // Each card is tappable: orders → Orders tab, support → Support tab.
    private var statsRow: some View {
        HStack(spacing: 12) {
            portalCard(
                icon: "bag.fill",
                label: user.isBaker ? "Orders Received" : "Orders Placed",
                value: "\(orders.count)",
                color: DS.brand,
                hint: "View orders →"
            ) { activeTab = .orders }

            portalCard(
                icon: "checkmark.circle.fill",
                label: "Paid",
                value: "\(paidCount)",
                color: DS.success,
                hint: orders.isEmpty ? nil : "of \(orders.count) orders"
            ) { activeTab = .orders }

            portalCard(
                icon: "bubble.left.fill",
                label: "Help Requests",
                value: "\(tickets.count)",
                color: openTicketCount > 0 ? DS.danger : DS.info,
                hint: tickets.isEmpty ? nil : "\(openTicketCount) open"
            ) { activeTab = .support }

            portalCard(
                icon: "calendar",
                label: "Member",
                value: "\(accountAgeDays)d",
                color: DS.textSecondary,
                hint: "Since \(fmtDate(user.createdAt))"
            ) { }
        }
    }

    private func portalCard(icon: String, label: String, value: String,
                            color: Color, hint: String?, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 5) {
                    Image(systemName: icon).font(.system(size: 11)).foregroundStyle(color)
                    Text(label)
                        .font(.system(size: 10, weight: .semibold)).tracking(0.3)
                        .foregroundStyle(DS.textTertiary)
                    Spacer()
                    Image(systemName: "arrow.up.right")
                        .font(.system(size: 9)).foregroundStyle(DS.textTertiary.opacity(0.5))
                }
                Text(value)
                    .font(.system(size: 26, weight: .bold, design: .rounded))
                    .foregroundStyle(DS.textPrimary)
                if let h = hint {
                    Text(h).font(.system(size: 10)).foregroundStyle(DS.textTertiary)
                }
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(DS.cardBg)
            .clipShape(RoundedRectangle(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(DS.cardBorder, lineWidth: 1))
        }
        .buttonStyle(.plain)
    }

    private func financialsSection(_ metrics: UserOrderMetrics) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionLabel(text: user.isBaker ? "Revenue" : "Spend")
            HStack(spacing: 12) {
                portalCard(
                    icon: "dollarsign.circle.fill",
                    label: user.isBaker ? "Total Order Value" : "Total Spent",
                    value: fmtCurrency(metrics.totalOrderValue),
                    color: DS.success,
                    hint: "All orders (excl. tax)"
                ) { activeTab = .orders }

                portalCard(
                    icon: "chart.pie.fill",
                    label: "Platform Revenue",
                    value: fmtCurrency(metrics.platformFeeRevenue),
                    color: DS.gold,
                    hint: "5% of paid marketplace orders"
                ) { }
            }
        }
    }

    private var performanceSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionLabel(text: "Performance")
            HStack(spacing: 12) {
                let completionPct = orders.isEmpty ? 0.0 : Double(completedCount) / Double(orders.count)
                metricBar("Completion Rate", value: completionPct, color: DS.success)
                let mktPct = orders.isEmpty ? 0.0 : Double(marketplaceCount) / Double(orders.count)
                metricBar("Marketplace Orders", value: mktPct, color: DS.brand)
                let paidPct = orders.isEmpty ? 0.0 : Double(paidCount) / Double(orders.count)
                metricBar("Paid Rate", value: paidPct, color: DS.info)
            }
        }
    }

    private func metricBar(_ label: String, value: Double, color: Color) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(label).font(.system(size: 11)).foregroundStyle(DS.textSecondary)
                Spacer()
                Text("\(Int(value * 100))%").font(.system(size: 13, weight: .bold)).foregroundStyle(color)
            }
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    RoundedRectangle(cornerRadius: 3).fill(DS.cardBorder).frame(height: 6)
                    RoundedRectangle(cornerRadius: 3).fill(color)
                        .frame(width: max(0, geo.size.width * value), height: 6)
                }
            }
            .frame(height: 6)
        }
        .padding(12)
        .background(DS.cardBg)
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(DS.cardBorder, lineWidth: 1))
        .frame(maxWidth: .infinity)
    }

    // Listing count cards all tap through to the full listings sheet.
    private var listingStatsSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionLabel(text: "Listings")
            HStack(spacing: 12) {
                listingPortalCard("Total", value: listingTotal, icon: "tag.fill", color: DS.textSecondary)
                listingPortalCard("Active", value: listingActive, icon: "checkmark.seal.fill", color: DS.success)
                listingPortalCard("In Marketplace", value: listingMarketplace, icon: "storefront.fill", color: DS.brand)
            }
            if let profile = user.profile {
                HStack(spacing: 10) {
                    if let bt = profile.baker_type {
                        overviewChip("Baker Type", bt.replacingOccurrences(of: "_", with: " ").capitalized, color: DS.brand)
                    }
                    let onboarded = profile.marketplace_onboarded ?? false
                    overviewChip("Marketplace", onboarded ? "Onboarded" : "Not onboarded",
                                 color: onboarded ? DS.success : DS.textTertiary)
                }
            }
        }
    }

    private func listingPortalCard(_ label: String, value: Int, icon: String, color: Color) -> some View {
        Button {
            Task { await openListingsSheet() }
        } label: {
            HStack(spacing: 10) {
                Image(systemName: icon).font(.system(size: 16)).foregroundStyle(color)
                VStack(alignment: .leading, spacing: 2) {
                    Text("\(value)")
                        .font(.system(size: 22, weight: .bold, design: .rounded))
                        .foregroundStyle(DS.textPrimary)
                    Text(label).font(.system(size: 10)).foregroundStyle(DS.textTertiary)
                }
                Spacer()
                Image(systemName: "arrow.up.right")
                    .font(.system(size: 10)).foregroundStyle(DS.textTertiary.opacity(0.5))
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(DS.cardBg)
            .clipShape(RoundedRectangle(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(DS.cardBorder, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .disabled(value == 0)
    }

    private func overviewChip(_ label: String, _ value: String, color: Color) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(label.uppercased()).font(.system(size: 9, weight: .bold)).tracking(0.4).foregroundStyle(DS.textTertiary)
            Text(value).font(.system(size: 12, weight: .medium)).foregroundStyle(color)
        }
        .padding(10)
        .background(DS.cardBg)
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(DS.cardBorder, lineWidth: 1))
    }

    private var profileDetailsSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionLabel(text: "Profile Details")
            let rows: [(String, String)] = [
                ("person.fill",        user.profile?.user_name.map { "@\($0)" } ?? ""),
                ("at",                 user.profile?.community_handle.map { "Community: @\($0)" } ?? ""),
                ("person.2.fill", {
                    let f = user.profile?.follower_count ?? 0; let fg = user.profile?.following_count ?? 0
                    return f + fg > 0 ? "\(f) followers · \(fg) following" : ""
                }()),
                ("mappin.and.ellipse", user.profile?.location ?? ""),
                ("envelope",           user.email),
            ].filter { !$0.1.isEmpty }

            if rows.isEmpty {
                Text("No additional profile info.")
                    .font(.system(size: 12)).foregroundStyle(DS.textTertiary)
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(rows.enumerated()), id: \.offset) { i, pair in
                        HStack(spacing: 10) {
                            Image(systemName: pair.0).font(.system(size: 11)).foregroundStyle(DS.textTertiary).frame(width: 16)
                            Text(pair.1).font(.system(size: 13)).foregroundStyle(DS.textPrimary)
                            Spacer()
                        }
                        .padding(.horizontal, 14).padding(.vertical, 10)
                        if i < rows.count - 1 { Divider().padding(.leading, 40) }
                    }
                }
                .background(DS.cardBg)
                .clipShape(RoundedRectangle(cornerRadius: 10))
                .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(DS.cardBorder, lineWidth: 1))
            }
        }
    }

    private var recentSupportSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                SectionLabel(text: "Recent Help Requests")
                Spacer()
                Button { activeTab = .support } label: {
                    Text("View all →").font(.system(size: 11, weight: .medium)).foregroundStyle(DS.brand)
                }
                .buttonStyle(.plain)
            }
            VStack(spacing: 0) {
                ForEach(tickets.prefix(3)) { ticket in
                    Button { activeTab = .support; selectedTicket = ticket } label: {
                        HStack(spacing: 10) {
                            Image(systemName: ticket.ticketCategory.icon)
                                .font(.system(size: 11)).foregroundStyle(ticket.urgency.color).frame(width: 16)
                            Text(ticket.message).font(.system(size: 12)).foregroundStyle(DS.textSecondary).lineLimit(1)
                            Spacer()
                            ticketStatusPill(ticket.ticketStatus)
                            Text(relDateStr(ticket.created_at)).font(.system(size: 10)).foregroundStyle(DS.textTertiary)
                        }
                        .padding(.horizontal, 14).padding(.vertical, 10)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    if ticket.id != tickets.prefix(3).last?.id { Divider().padding(.leading, 40) }
                }
            }
            .background(DS.cardBg)
            .clipShape(RoundedRectangle(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(DS.cardBorder, lineWidth: 1))
        }
    }

    // MARK: - Orders tab

    private var ordersTab: some View {
        HStack(spacing: 0) {
            ordersListPanel.frame(width: 290)
            Divider()
            orderDetailArea.frame(maxWidth: .infinity)
        }
    }

    private var ordersListPanel: some View {
        VStack(spacing: 0) {
            VStack(spacing: 8) {
                HStack {
                    VStack(alignment: .leading, spacing: 1) {
                        Text(user.isBaker ? "Baker Orders" : "Purchases")
                            .font(.system(size: 12, weight: .semibold)).foregroundStyle(DS.textSecondary)
                        Text("\(filteredOrders.count) \(filteredOrders.count == 1 ? "record" : "records")")
                            .font(.system(size: 10)).foregroundStyle(DS.textTertiary)
                    }
                    Spacer()
                    if isLoadingOrders { ProgressView().scaleEffect(0.65) }
                    Button { Task { await loadOrders() } } label: {
                        Image(systemName: "arrow.clockwise").font(.system(size: 11)).foregroundStyle(DS.textTertiary)
                    }
                    .buttonStyle(.plain)
                }
                if user.isBaker {
                    Picker("", selection: $orderFilter) {
                        ForEach(OrderFilter.allCases, id: \.self) { Text($0.rawValue).tag($0) }
                    }
                    .pickerStyle(.segmented).labelsHidden()
                }
            }
            .padding(12).background(DS.cardBg)
            Divider()

            if isLoadingOrders {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if orders.isEmpty {
                emptyState(icon: user.isBaker ? "bag" : "cart",
                           label: "No \(user.isBaker ? "orders" : "purchases") yet")
            } else if filteredOrders.isEmpty {
                emptyState(icon: "line.3.horizontal.decrease.circle",
                           label: "No \(orderFilter.rawValue.lowercased()) orders")
            } else {
                ScrollView {
                    LazyVStack(spacing: 0) {
                        ForEach(filteredOrders) { order in
                            orderListRow(order)
                            Divider().padding(.leading, 12)
                        }
                    }
                }
            }
        }
        .background(DS.pageBg)
    }

    private func orderListRow(_ order: AdminOrder) -> some View {
        let isSelected = selectedOrder?.id == order.id
        return Button { selectOrder(order) } label: {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Circle().fill(order.statusColor).frame(width: 6, height: 6)
                    Text(order.order_name)
                        .font(.system(size: 12.5, weight: .medium)).foregroundStyle(DS.textPrimary).lineLimit(1)
                    Spacer()
                    Text(order.isMarketplace ? "MKT" : "MAN")
                        .font(.system(size: 8, weight: .bold)).foregroundStyle(order.sourceColor)
                        .padding(.horizontal, 5).padding(.vertical, 2)
                        .background(order.sourceColor.opacity(0.12)).clipShape(Capsule())
                }
                HStack {
                    Text(relDateStr(order.created_at)).font(.system(size: 10)).foregroundStyle(DS.textTertiary)
                    Spacer()
                    Text(order.displayStatus).font(.system(size: 10, weight: .medium)).foregroundStyle(order.statusColor)
                }
                // Counterpart row — tappable if we have their profile UUID
                counterpartRow(for: order, compact: true)
            }
            .padding(.horizontal, 12).padding(.vertical, 9)
            .background(isSelected ? DS.brand.opacity(0.06) : Color.clear)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    /// Inline counterpart name with a navigate button when the profile UUID is known.
    @ViewBuilder
    private func counterpartRow(for order: AdminOrder, compact: Bool) -> some View {
        let name: String? = user.isBaker
            ? (order.buyer_display_name.flatMap { $0.isEmpty ? nil : $0 }
               ?? order.customer_name.flatMap { $0.isEmpty ? nil : $0 })
            : order.baker_display_name.flatMap { $0.isEmpty ? nil : $0 }
        let navigableId: UUID? = user.isBaker ? order.buyer_profile_id : order.user_id

        if let n = name {
            HStack(spacing: 4) {
                Text(n)
                    .font(.system(size: compact ? 10 : 13))
                    .foregroundStyle(compact ? DS.textTertiary : DS.textSecondary)
                    .lineLimit(1)
                if let id = navigableId, onNavigateToUser != nil {
                    Button {
                        onNavigateToUser?(id)
                    } label: {
                        HStack(spacing: 2) {
                            Text("View profile")
                                .font(.system(size: compact ? 9 : 11, weight: .medium))
                            Image(systemName: "arrow.up.right")
                                .font(.system(size: compact ? 8 : 10))
                        }
                        .foregroundStyle(DS.brand)
                        .padding(.horizontal, compact ? 5 : 8)
                        .padding(.vertical, compact ? 1 : 3)
                        .background(DS.brand.opacity(0.08))
                        .clipShape(Capsule())
                    }
                    .buttonStyle(.plain)
                    .id(id)
                }
            }
        }
    }

    @ViewBuilder
    private var orderDetailArea: some View {
        if let order = selectedOrder {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    orderDetailHeader(order)
                    Divider()
                    orderMetadataGrid(order)
                    Divider()
                    lineItemsSection
                    if !orderItems.isEmpty { Divider(); orderTotalsSection(order) }
                    if let notes = order.notes, !notes.isEmpty { notesCard(notes) }
                    orderIdFooter(order)
                }
                .padding(24)
            }
            .background(DS.pageBg)
        } else {
            emptyDetailState(icon: "receipt", label: "Select an order to view the transaction record")
        }
    }

    private func orderDetailHeader(_ order: AdminOrder) -> some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 8) {
                Text(order.order_name).font(.system(size: 22, weight: .bold)).foregroundStyle(DS.textPrimary)
                HStack(spacing: 8) {
                    HStack(spacing: 5) {
                        Circle().fill(order.statusColor).frame(width: 7, height: 7)
                        Text(order.displayStatus).font(.system(size: 12, weight: .semibold)).foregroundStyle(order.statusColor)
                    }
                    .padding(.horizontal, 10).padding(.vertical, 5)
                    .background(order.statusColor.opacity(0.10)).clipShape(Capsule())

                    Text(order.sourceLabel).font(.system(size: 11, weight: .semibold)).foregroundStyle(order.sourceColor)
                        .padding(.horizontal, 10).padding(.vertical, 5)
                        .background(order.sourceColor.opacity(0.10)).clipShape(Capsule())

                    if order.is_paid == true {
                        HStack(spacing: 4) {
                            Image(systemName: "checkmark.circle.fill").font(.system(size: 10))
                            Text("Paid").font(.system(size: 11, weight: .medium))
                        }
                        .foregroundStyle(DS.success)
                        .padding(.horizontal, 10).padding(.vertical, 5)
                        .background(DS.success.opacity(0.10)).clipShape(Capsule())
                    }
                }
            }
            Spacer()
        }
    }

    private func orderMetadataGrid(_ order: AdminOrder) -> some View {
        let counterpartLabel = user.isBaker ? "Customer" : "Baker"
        let counterpartValue: String = {
            user.isBaker
                ? (order.buyer_display_name.flatMap { $0.isEmpty ? nil : $0 }
                   ?? order.customer_name.flatMap { $0.isEmpty ? nil : $0 } ?? "—")
                : (order.baker_display_name.flatMap { $0.isEmpty ? nil : $0 } ?? "—")
        }()
        let navigableId: UUID? = user.isBaker ? order.buyer_profile_id : order.user_id

        let simpleFields: [(String, String, String)] = [
            ("calendar",          "Ordered",     relDateStr(order.created_at)),
            ("clock",             "Due",          order.due_date.map { parseAndFmt($0) } ?? "—"),
            ("arrow.left.arrow.right", "Source",  order.isMarketplace ? "Marketplace" : "Manual"),
            ("shippingbox",       "Fulfillment",  order.fulfillment_type ?? "—"),
            ("banknote",          "Payment",      order.is_paid == true ? "Paid" : "Unpaid"),
        ]

        return LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
            // Counterpart cell — navigable when UUID is available
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 4) {
                    Image(systemName: user.isBaker ? "person.fill" : "oven.fill")
                        .font(.system(size: 9)).foregroundStyle(DS.textTertiary)
                    Text(counterpartLabel.uppercased())
                        .font(.system(size: 8, weight: .bold)).tracking(0.5).foregroundStyle(DS.textTertiary)
                }
                if let id = navigableId, onNavigateToUser != nil {
                    Button { onNavigateToUser?(id) } label: {
                        HStack(spacing: 4) {
                            Text(counterpartValue)
                                .font(.system(size: 12, weight: .medium)).foregroundStyle(DS.brand)
                                .lineLimit(2)
                            Image(systemName: "arrow.up.right").font(.system(size: 9)).foregroundStyle(DS.brand)
                        }
                    }
                    .buttonStyle(.plain)
                } else {
                    Text(counterpartValue)
                        .font(.system(size: 12, weight: .medium)).foregroundStyle(DS.textPrimary).lineLimit(2)
                }
            }
            .padding(10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(DS.cardBg)
            .clipShape(RoundedRectangle(cornerRadius: 8))
            .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(DS.cardBorder, lineWidth: 1))

            ForEach(simpleFields, id: \.1) { icon, label, value in
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 4) {
                        Image(systemName: icon).font(.system(size: 9)).foregroundStyle(DS.textTertiary)
                        Text(label.uppercased())
                            .font(.system(size: 8, weight: .bold)).tracking(0.5).foregroundStyle(DS.textTertiary)
                    }
                    Text(value)
                        .font(.system(size: 12, weight: .medium)).foregroundStyle(DS.textPrimary).lineLimit(2)
                }
                .padding(10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(DS.cardBg)
                .clipShape(RoundedRectangle(cornerRadius: 8))
                .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(DS.cardBorder, lineWidth: 1))
            }
        }
    }

    private var lineItemsSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionLabel(text: "Line Items")
            if isLoadingItems {
                HStack(spacing: 8) {
                    ProgressView().scaleEffect(0.7)
                    Text("Loading items…").font(.system(size: 12)).foregroundStyle(DS.textSecondary)
                }
                .padding(.vertical, 8)
            } else if orderItems.isEmpty {
                Text("No line items recorded for this order.")
                    .font(.system(size: 12)).foregroundStyle(DS.textTertiary).padding(.vertical, 8)
            } else {
                VStack(spacing: 0) {
                    HStack(spacing: 0) {
                        colHd("Item", flex: true); colHd("Qty", width: 70)
                        colHd("Unit Price", width: 100); colHd("Total", width: 100)
                    }
                    .padding(.horizontal, 14).padding(.vertical, 7).background(DS.pageBg)
                    Divider()
                    ForEach(orderItems) { item in
                        HStack(spacing: 0) {
                            VStack(alignment: .leading, spacing: 1) {
                                Text(item.displayName)
                                    .font(.system(size: 13, weight: .medium)).foregroundStyle(DS.textPrimary)
                                if let n = item.notes, !n.isEmpty {
                                    Text(n).font(.system(size: 10)).foregroundStyle(DS.textTertiary).lineLimit(1)
                                }
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            Text("\(item.qty) \(item.unitLabel)")
                                .font(.system(size: 12)).foregroundStyle(DS.textSecondary)
                                .frame(width: 70, alignment: .leading)
                            Text(fmtCurrency(item.price))
                                .font(.system(size: 12, design: .monospaced)).foregroundStyle(DS.textSecondary)
                                .frame(width: 100, alignment: .trailing)
                            Text(fmtCurrency(item.lineTotal))
                                .font(.system(size: 12, weight: .semibold, design: .monospaced))
                                .foregroundStyle(DS.textPrimary).frame(width: 100, alignment: .trailing)
                        }
                        .padding(.horizontal, 14).padding(.vertical, 10)
                        Divider().padding(.leading, 14)
                    }
                }
                .background(DS.cardBg)
                .clipShape(RoundedRectangle(cornerRadius: 10))
                .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(DS.cardBorder, lineWidth: 1))
            }
        }
    }

    private func orderTotalsSection(_ order: AdminOrder) -> some View {
        let subtotal = orderItems.reduce(0) { $0 + $1.lineTotal }
        let fee = order.isMarketplace ? subtotal * 0.05 : 0.0
        return VStack(alignment: .trailing, spacing: 8) {
            totalRow("Subtotal", value: fmtCurrency(subtotal), bold: false)
            if order.isMarketplace {
                HStack {
                    HStack(spacing: 5) {
                        Text("Platform Fee (5%)").font(.system(size: 12)).foregroundStyle(DS.textSecondary)
                        Text("Bakeri").font(.system(size: 9, weight: .bold)).foregroundStyle(DS.gold)
                            .padding(.horizontal, 5).padding(.vertical, 2)
                            .background(DS.gold.opacity(0.12)).clipShape(Capsule())
                    }
                    Spacer()
                    Text(fmtCurrency(fee)).font(.system(size: 12, design: .monospaced)).foregroundStyle(DS.gold)
                }
            }
            Divider()
            totalRow("Order Total", value: fmtCurrency(subtotal), bold: true)
        }
        .padding(.horizontal, 4)
    }

    private func notesCard(_ notes: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionLabel(text: "Notes")
            Text(notes).font(.system(size: 13)).foregroundStyle(DS.textSecondary)
                .padding(14).frame(maxWidth: .infinity, alignment: .leading)
                .background(DS.cardBg).clipShape(RoundedRectangle(cornerRadius: 10))
                .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(DS.cardBorder, lineWidth: 1))
        }
    }

    private func orderIdFooter(_ order: AdminOrder) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text("ORDER ID").font(.system(size: 9, weight: .bold)).tracking(0.5).foregroundStyle(DS.textTertiary)
                Text(order.id.uuidString.lowercased())
                    .font(.system(size: 11, design: .monospaced)).foregroundStyle(DS.textSecondary)
            }
            Spacer()
            Button {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(order.id.uuidString.lowercased(), forType: .string)
            } label: {
                HStack(spacing: 4) {
                    Image(systemName: "doc.on.doc").font(.system(size: 10))
                    Text("Copy").font(.system(size: 11, weight: .medium))
                }
                .foregroundStyle(DS.brand).padding(.horizontal, 10).padding(.vertical, 5)
                .background(DS.brand.opacity(0.08)).clipShape(Capsule())
            }
            .buttonStyle(.plain)
        }
        .padding(12).background(DS.cardBg)
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(DS.cardBorder, lineWidth: 1))
    }

    // MARK: - Support tab

    private var supportTab: some View {
        HStack(spacing: 0) {
            ticketListPanel.frame(width: 280)
            Divider()
            ticketDetailArea.frame(maxWidth: .infinity)
        }
    }

    private var ticketListPanel: some View {
        VStack(spacing: 0) {
            HStack {
                VStack(alignment: .leading, spacing: 1) {
                    Text("Help Requests").font(.system(size: 12, weight: .semibold)).foregroundStyle(DS.textSecondary)
                    Text("\(tickets.count) total · \(openTicketCount) open")
                        .font(.system(size: 10)).foregroundStyle(DS.textTertiary)
                }
                Spacer()
                if isLoadingTickets { ProgressView().scaleEffect(0.65) }
                Button { Task { await loadTickets() } } label: {
                    Image(systemName: "arrow.clockwise").font(.system(size: 11)).foregroundStyle(DS.textTertiary)
                }
                .buttonStyle(.plain)
            }
            .padding(12).background(DS.cardBg)
            Divider()

            if isLoadingTickets {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if tickets.isEmpty {
                emptyState(icon: "bubble.left", label: "No help requests submitted")
            } else {
                ScrollView {
                    LazyVStack(spacing: 0) {
                        ForEach(tickets) { ticket in
                            ticketListRow(ticket)
                            Divider().padding(.leading, 12)
                        }
                    }
                }
            }
        }
        .background(DS.pageBg)
    }

    private func ticketListRow(_ ticket: FeedbackTicket) -> some View {
        let isSelected = selectedTicket?.id == ticket.id
        return Button { selectedTicket = ticket } label: {
            VStack(alignment: .leading, spacing: 5) {
                HStack(spacing: 6) {
                    Image(systemName: ticket.ticketCategory.icon)
                        .font(.system(size: 10)).foregroundStyle(ticket.urgency.color)
                    Text(ticket.ticketCategory.label)
                        .font(.system(size: 12, weight: .semibold)).foregroundStyle(DS.textPrimary)
                    Spacer()
                    ticketStatusPill(ticket.ticketStatus)
                }
                Text(ticket.message).font(.system(size: 11)).foregroundStyle(DS.textSecondary).lineLimit(2)
                Text(relDateStr(ticket.created_at)).font(.system(size: 10)).foregroundStyle(DS.textTertiary)
            }
            .padding(.horizontal, 12).padding(.vertical, 10)
            .background(isSelected ? DS.brand.opacity(0.06) : Color.clear)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder
    private var ticketDetailArea: some View {
        if let ticket = selectedTicket {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    ticketDetailHeader(ticket)
                    Divider()
                    VStack(alignment: .leading, spacing: 6) {
                        SectionLabel(text: "Message")
                        Text(ticket.message).font(.system(size: 14)).foregroundStyle(DS.textPrimary)
                            .padding(16).frame(maxWidth: .infinity, alignment: .leading)
                            .background(DS.cardBg).clipShape(RoundedRectangle(cornerRadius: 10))
                            .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(DS.cardBorder, lineWidth: 1))
                    }
                    ticketMetaGrid(ticket)
                    ticketStatusControls(ticket)
                }
                .padding(24)
            }
            .background(DS.pageBg)
        } else {
            emptyDetailState(icon: "bubble.left.and.bubble.right", label: "Select a request to view details")
        }
    }

    private func ticketDetailHeader(_ ticket: FeedbackTicket) -> some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 8) {
                    Text(ticket.ticketCategory.label).font(.system(size: 22, weight: .bold)).foregroundStyle(DS.textPrimary)
                    HStack(spacing: 5) {
                        Image(systemName: ticket.ticketCategory.icon).font(.system(size: 10))
                        Text(ticket.urgency.label).font(.system(size: 11, weight: .semibold))
                    }
                    .foregroundStyle(ticket.urgency.color)
                    .padding(.horizontal, 10).padding(.vertical, 5)
                    .background(ticket.urgency.color.opacity(0.1)).clipShape(Capsule())
                }
                HStack(spacing: 8) {
                    ticketStatusPill(ticket.ticketStatus)
                    if let a = ticket.assigned_to, !a.isEmpty {
                        Text("Assigned to \(a)").font(.system(size: 11)).foregroundStyle(DS.textSecondary)
                    }
                }
            }
            Spacer()
            Text(relDateStr(ticket.created_at)).font(.system(size: 12)).foregroundStyle(DS.textTertiary)
        }
    }

    private func ticketMetaGrid(_ ticket: FeedbackTicket) -> some View {
        let cells: [(String, String, String)] = [
            ("app.badge",                "App Version", ticket.app_version ?? "—"),
            ("iphone",                   "OS Version",  ticket.os_version ?? "—"),
            ("calendar",                 "Submitted",   relDateStr(ticket.created_at)),
            ("tag",                      "Category",    ticket.ticketCategory.label),
            ("exclamationmark.triangle", "Urgency",     ticket.urgency.label),
            ("clock.arrow.circlepath",   "Status",      ticket.ticketStatus.label),
        ]
        return LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
            ForEach(cells, id: \.1) { icon, label, value in
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 4) {
                        Image(systemName: icon).font(.system(size: 9)).foregroundStyle(DS.textTertiary)
                        Text(label.uppercased()).font(.system(size: 8, weight: .bold)).tracking(0.5).foregroundStyle(DS.textTertiary)
                    }
                    Text(value).font(.system(size: 12, weight: .medium)).foregroundStyle(DS.textPrimary).lineLimit(2)
                }
                .padding(10).frame(maxWidth: .infinity, alignment: .leading)
                .background(DS.cardBg).clipShape(RoundedRectangle(cornerRadius: 8))
                .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(DS.cardBorder, lineWidth: 1))
            }
        }
    }

    private func ticketStatusControls(_ ticket: FeedbackTicket) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionLabel(text: "Update Status")
            HStack(spacing: 8) {
                ForEach([TicketStatus.open, .inProgress, .escalated, .resolved, .archived], id: \.self) { status in
                    let isCurrent = ticket.ticketStatus == status
                    Button { Task { await updateTicket(ticket, status: status.rawValue) } } label: {
                        Text(status.label)
                            .font(.system(size: 11, weight: isCurrent ? .bold : .medium))
                            .foregroundStyle(isCurrent ? .white : status.color)
                            .padding(.horizontal, 10).padding(.vertical, 6)
                            .background(isCurrent ? status.color : status.color.opacity(0.1))
                            .clipShape(Capsule())
                    }
                    .buttonStyle(.plain)
                    .disabled(isUpdatingTicket || isCurrent)
                }
                if isUpdatingTicket { ProgressView().scaleEffect(0.7) }
            }
        }
    }

    // MARK: - Shared sub-views

    private func emptyState(icon: String, label: String) -> some View {
        VStack(spacing: 10) {
            Image(systemName: icon).font(.system(size: 28)).foregroundStyle(.tertiary)
            Text(label).font(.system(size: 13)).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func emptyDetailState(icon: String, label: String) -> some View {
        VStack(spacing: 12) {
            Image(systemName: icon).font(.system(size: 36)).foregroundStyle(.tertiary)
            Text(label).font(.system(size: 13)).foregroundStyle(.secondary).multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity).background(DS.pageBg)
    }

    private func ticketStatusPill(_ status: TicketStatus) -> some View {
        Text(status.label).font(.system(size: 9, weight: .bold)).foregroundStyle(status.color)
            .padding(.horizontal, 6).padding(.vertical, 2)
            .background(status.color.opacity(0.12)).clipShape(Capsule())
    }

    private func badge(_ count: Int, color: Color) -> some View {
        Text("\(count)").font(.system(size: 10, weight: .bold)).foregroundStyle(.white)
            .padding(.horizontal, 5).padding(.vertical, 1)
            .background(color).clipShape(Capsule())
    }

    private func totalRow(_ label: String, value: String, bold: Bool) -> some View {
        HStack {
            Text(label).font(.system(size: bold ? 14 : 12, weight: bold ? .semibold : .regular)).foregroundStyle(DS.textPrimary)
            Spacer()
            Text(value).font(.system(size: bold ? 16 : 12, weight: bold ? .bold : .regular, design: .rounded)).foregroundStyle(DS.textPrimary)
        }
    }

    private func colHd(_ label: String, width: CGFloat? = nil, flex: Bool = false) -> some View {
        Text(label).font(.system(size: 9, weight: .semibold)).tracking(0.4).foregroundStyle(DS.textTertiary)
            .frame(width: width, alignment: flex ? .leading : .trailing)
            .frame(maxWidth: flex ? .infinity : nil, alignment: .leading)
    }

    private func metaDot(_ icon: String, _ text: String) -> some View {
        HStack(spacing: 4) {
            Image(systemName: icon).font(.system(size: 9)).foregroundStyle(DS.textTertiary)
            Text(text).font(.system(size: 11)).foregroundStyle(DS.textSecondary)
        }
    }

    private func actionBtn(_ label: String, icon: String, color: Color, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 5) {
                Image(systemName: icon).font(.system(size: 11, weight: .medium))
                Text(label).font(.system(size: 12, weight: .medium))
            }
            .foregroundStyle(color).padding(.horizontal, 12).padding(.vertical, 7)
            .background(color.opacity(0.08)).clipShape(RoundedRectangle(cornerRadius: 7))
            .overlay(RoundedRectangle(cornerRadius: 7).strokeBorder(color.opacity(0.25), lineWidth: 1))
        }
        .buttonStyle(.plain)
    }

    // MARK: - Formatters

    private func fmtDate(_ d: Date) -> String {
        let f = DateFormatter(); f.dateFormat = "MMM d, yyyy"; return f.string(from: d)
    }

    private func fmtCurrency(_ v: Double) -> String {
        let f = NumberFormatter(); f.numberStyle = .currency; f.currencyCode = "CAD"; f.maximumFractionDigits = 2
        return f.string(from: NSNumber(value: v)) ?? "$0.00"
    }

    private func parseDate(_ s: String) -> Date? {
        let n = s.replacingOccurrences(of: "+00:00", with: "Z").replacingOccurrences(of: "-00:00", with: "Z")
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = f.date(from: n) { return d }
        f.formatOptions = [.withInternetDateTime]
        return f.date(from: n)
    }

    private func relDateStr(_ s: String) -> String {
        guard let d = parseDate(s) else { return s }
        let diff = Date().timeIntervalSince(d)
        if diff < 3600  { return "\(Int(diff / 60))m ago" }
        if diff < 86400 { return "\(Int(diff / 3600))h ago" }
        if diff < 604800 { return "\(Int(diff / 86400))d ago" }
        return fmtDate(d)
    }

    private func parseAndFmt(_ s: String) -> String { parseDate(s).map { fmtDate($0) } ?? s }

    // MARK: - Data loading

    private func loadAll() async {
        async let _o: () = loadOrders()
        async let _t: () = loadTickets()
        async let _l: () = loadListingCounts()
        async let _m: () = loadOrderMetrics()
        _ = await (_o, _t, _l, _m)
    }

    private func loadOrderMetrics() async {
        orderMetrics = try? await SupabaseAdminService.shared.fetchOrderMetricsForUser(
            userId: user.id, isBaker: user.isBaker
        )
    }

    private func loadOrders() async {
        isLoadingOrders = true; defer { isLoadingOrders = false }
        orders = user.isBaker
            ? ((try? await SupabaseAdminService.shared.fetchOrdersForBaker(userId: user.id)) ?? [])
            : ((try? await SupabaseAdminService.shared.fetchOrdersForBuyer(userId: user.id)) ?? [])
        selectedOrder = nil; orderItems = []
    }

    private func loadTickets() async {
        isLoadingTickets = true; defer { isLoadingTickets = false }
        tickets = (try? await SupabaseAdminService.shared.fetchFeedbackForUser(userId: user.id)) ?? []
        if let sel = selectedTicket { selectedTicket = tickets.first { $0.id == sel.id } }
        else { selectedTicket = nil }
    }

    private func loadListingCounts() async {
        guard user.isBaker else { return }
        if let s = try? await SupabaseAdminService.shared.fetchListingStatsForUser(userId: user.id) {
            listingTotal = s.total; listingActive = s.active; listingMarketplace = s.marketplace
        }
    }

    private func openListingsSheet() async {
        showListingsSheet = true
        guard userListings.isEmpty else { return }   // already loaded
        isLoadingListings = true; defer { isLoadingListings = false }
        userListings = (try? await SupabaseAdminService.shared.fetchListingsForUser(userId: user.id)) ?? []
    }

    private func selectOrder(_ order: AdminOrder) {
        selectedOrder = order; orderItems = []
        Task {
            isLoadingItems = true; defer { isLoadingItems = false }
            orderItems = (try? await SupabaseAdminService.shared.fetchOrderItems(orderId: order.id)) ?? []
        }
    }

    private func updateTicket(_ ticket: FeedbackTicket, status: String) async {
        isUpdatingTicket = true; defer { isUpdatingTicket = false }
        do {
            try await SupabaseAdminService.shared.updateTicketStatus(id: ticket.id, status: status)
            await loadTickets()
            actionFeedback = "Ticket marked \(status.replacingOccurrences(of: "_", with: " "))."; showToast()
        } catch {
            actionFeedback = "Failed: \(error.localizedDescription)"; showToast()
        }
    }

    private func toggleBan() async {
        do {
            if user.isBanned {
                try await SupabaseAdminService.shared.unbanUser(id: user.id)
                actionFeedback = "User unbanned."
            } else if user.isBaker {
                let reason = banReason.trimmingCharacters(in: .whitespaces).isEmpty
                    ? "Account suspended by admin"
                    : banReason.trimmingCharacters(in: .whitespaces)
                let cancelled = try await SupabaseAdminService.shared.suspendBaker(bakerId: user.id, reason: reason)
                actionFeedback = cancelled > 0
                    ? "Baker suspended. \(cancelled) order(s) auto-cancelled."
                    : "Baker suspended."
            } else {
                try await SupabaseAdminService.shared.banUser(id: user.id)
                actionFeedback = "User banned."
            }
            showToast()
        } catch { actionFeedback = "Failed: \(error.localizedDescription)"; showToast() }
    }

    private func deleteUser() async {
        do {
            try await SupabaseAdminService.shared.deleteUser(id: user.id)
            actionFeedback = "Account deleted."; showToast()
        } catch { actionFeedback = "Delete failed: \(error.localizedDescription)"; showToast() }
    }

    private func showToast() {
        withAnimation { showSuccessToast = true }
        DispatchQueue.main.asyncAfter(deadline: .now() + 3) { withAnimation { showSuccessToast = false } }
    }
}

// MARK: - Listings drill-down sheet

struct ListingsDrillSheet: View {
    let bakerName: String
    let listings: [MarketplaceListing]
    let isLoading: Bool

    @Environment(\.dismiss) private var dismiss
    @State private var selected: MarketplaceListing?

    var body: some View {
        VStack(spacing: 0) {
            // Header
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("\(bakerName)'s Listings")
                        .font(.system(size: 18, weight: .bold)).foregroundStyle(DS.textPrimary)
                    Text("\(listings.count) total listings")
                        .font(.system(size: 12)).foregroundStyle(DS.textSecondary)
                }
                Spacer()
                Button("Done") { dismiss() }
                    .font(.system(size: 13, weight: .medium)).foregroundStyle(DS.brand)
                    .buttonStyle(.plain)
            }
            .padding(20).background(DS.cardBg)
            Divider()

            HStack(spacing: 0) {
                listingsPanel.frame(width: 280)
                Divider()
                if let l = selected {
                    listingDetailPanel(l).frame(maxWidth: .infinity)
                } else {
                    VStack(spacing: 12) {
                        Image(systemName: "tag").font(.system(size: 32)).foregroundStyle(.tertiary)
                        Text("Select a listing to view details")
                            .font(.system(size: 13)).foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(DS.pageBg)
                }
            }
            .frame(maxHeight: .infinity)
        }
        .frame(minWidth: 700, minHeight: 480)
        .background(DS.pageBg)
    }

    private var listingsPanel: some View {
        VStack(spacing: 0) {
            if isLoading {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if listings.isEmpty {
                VStack(spacing: 10) {
                    Image(systemName: "tag.slash").font(.system(size: 28)).foregroundStyle(.tertiary)
                    Text("No listings found").font(.system(size: 13)).foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ScrollView {
                    LazyVStack(spacing: 0) {
                        ForEach(listings) { listing in
                            Button { selected = listing } label: {
                                listingRow(listing, isSelected: selected?.id == listing.id)
                            }
                            .buttonStyle(.plain)
                            Divider().padding(.leading, 12)
                        }
                    }
                }
            }
        }
        .background(DS.pageBg)
    }

    private func listingRow(_ l: MarketplaceListing, isSelected: Bool) -> some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text(l.name)
                        .font(.system(size: 12.5, weight: .medium)).foregroundStyle(DS.textPrimary).lineLimit(1)
                    Spacer()
                    kindBadge(l.kind)
                }
                HStack(spacing: 8) {
                    Text(fmtPrice(l.displayPrice)).font(.system(size: 11, weight: .semibold)).foregroundStyle(DS.success)
                    Text(l.category).font(.system(size: 10)).foregroundStyle(DS.textTertiary)
                    Spacer()
                    Circle().fill(l.is_active ? DS.success : DS.textTertiary).frame(width: 6, height: 6)
                    Text(l.is_active ? "Active" : "Inactive")
                        .font(.system(size: 10)).foregroundStyle(l.is_active ? DS.success : DS.textTertiary)
                }
            }
        }
        .padding(.horizontal, 12).padding(.vertical, 10)
        .background(isSelected ? DS.brand.opacity(0.06) : Color.clear)
        .contentShape(Rectangle())
    }

    private func listingDetailPanel(_ l: MarketplaceListing) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                // Title + badges
                VStack(alignment: .leading, spacing: 8) {
                    Text(l.name).font(.system(size: 22, weight: .bold)).foregroundStyle(DS.textPrimary)
                    HStack(spacing: 8) {
                        kindBadge(l.kind)
                        HStack(spacing: 4) {
                            Circle().fill(l.is_active ? DS.success : DS.textTertiary).frame(width: 7, height: 7)
                            Text(l.is_active ? "Active" : "Inactive")
                                .font(.system(size: 11, weight: .semibold))
                                .foregroundStyle(l.is_active ? DS.success : DS.textTertiary)
                        }
                        .padding(.horizontal, 10).padding(.vertical, 5)
                        .background((l.is_active ? DS.success : DS.textTertiary).opacity(0.1)).clipShape(Capsule())

                        if l.is_listed_in_marketplace {
                            HStack(spacing: 4) {
                                Image(systemName: "storefront.fill").font(.system(size: 10))
                                Text("Marketplace").font(.system(size: 11, weight: .semibold))
                            }
                            .foregroundStyle(DS.brand)
                            .padding(.horizontal, 10).padding(.vertical, 5)
                            .background(DS.brand.opacity(0.1)).clipShape(Capsule())
                        }
                    }
                }

                // Price + stats grid
                let cells: [(String, String, String)] = [
                    ("dollarsign.circle", "Base Price",    fmtPrice(l.default_price)),
                    ("tag",              "Market Price",  fmtPrice(l.displayPrice)),
                    ("shippingbox",      "Available Today", "\(l.available_qty_today)"),
                    ("clock",            "Lead Days",     "\(l.lead_days)d"),
                    ("square.grid.2x2", "Category",      l.category),
                    ("calendar",         "Last Updated",  relStr(l.updated_at)),
                ]

                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                    ForEach(cells, id: \.1) { icon, label, value in
                        VStack(alignment: .leading, spacing: 4) {
                            HStack(spacing: 4) {
                                Image(systemName: icon).font(.system(size: 9)).foregroundStyle(DS.textTertiary)
                                Text(label.uppercased())
                                    .font(.system(size: 8, weight: .bold)).tracking(0.5).foregroundStyle(DS.textTertiary)
                            }
                            Text(value).font(.system(size: 12, weight: .medium)).foregroundStyle(DS.textPrimary)
                        }
                        .padding(10).frame(maxWidth: .infinity, alignment: .leading)
                        .background(DS.cardBg).clipShape(RoundedRectangle(cornerRadius: 8))
                        .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(DS.cardBorder, lineWidth: 1))
                    }
                }

                // Description
                if !l.item_description.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("DESCRIPTION")
                            .font(.system(size: 9, weight: .bold)).tracking(0.5).foregroundStyle(DS.textTertiary)
                        Text(l.item_description).font(.system(size: 13)).foregroundStyle(DS.textSecondary)
                            .padding(14).frame(maxWidth: .infinity, alignment: .leading)
                            .background(DS.cardBg).clipShape(RoundedRectangle(cornerRadius: 10))
                            .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(DS.cardBorder, lineWidth: 1))
                    }
                }

                // Listing ID footer
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("LISTING ID").font(.system(size: 9, weight: .bold)).tracking(0.5).foregroundStyle(DS.textTertiary)
                        Text(l.id.uuidString.lowercased())
                            .font(.system(size: 11, design: .monospaced)).foregroundStyle(DS.textSecondary)
                    }
                    Spacer()
                    Button {
                        NSPasteboard.general.clearContents()
                        NSPasteboard.general.setString(l.id.uuidString.lowercased(), forType: .string)
                    } label: {
                        HStack(spacing: 4) {
                            Image(systemName: "doc.on.doc").font(.system(size: 10))
                            Text("Copy").font(.system(size: 11, weight: .medium))
                        }
                        .foregroundStyle(DS.brand).padding(.horizontal, 10).padding(.vertical, 5)
                        .background(DS.brand.opacity(0.08)).clipShape(Capsule())
                    }
                    .buttonStyle(.plain)
                }
                .padding(12).background(DS.cardBg)
                .clipShape(RoundedRectangle(cornerRadius: 10))
                .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(DS.cardBorder, lineWidth: 1))
            }
            .padding(24)
        }
        .background(DS.pageBg)
    }

    private func kindBadge(_ kind: ListingKind) -> some View {
        Text(kind.label)
            .font(.system(size: 10, weight: .bold)).foregroundStyle(kind.color)
            .padding(.horizontal, 8).padding(.vertical, 3)
            .background(kind.color.opacity(0.12)).clipShape(Capsule())
    }

    private func fmtPrice(_ v: Double) -> String {
        let f = NumberFormatter(); f.numberStyle = .currency; f.currencyCode = "CAD"
        return f.string(from: NSNumber(value: v)) ?? "$0"
    }

    private func relStr(_ s: String) -> String {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let d = f.date(from: s) ?? {
            f.formatOptions = [.withInternetDateTime]; return f.date(from: s)
        }() else { return s }
        let diff = Date().timeIntervalSince(d)
        if diff < 86400 { return "\(Int(diff / 3600))h ago" }
        return "\(Int(diff / 86400))d ago"
    }
}
