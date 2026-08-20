//
//  ContentView.swift
//  Bakeri Admin
//
//  2-column NavigationSplitView: sidebar + full-width detail.
//  Dashboard/Analytics/Marketplace use the full detail width.
//  Users and Support embed their own list↔dossier HStack internally.
//

import SwiftUI

struct ContentView: View {
    @State private var sidebarSelection: SidebarItem? = .dashboard
    @State private var selectedUser: AdminUser?
    @State private var selectedTicket: FeedbackTicket?
    @State private var selectedOrder: AdminOrder?
    @State private var columnVisibility: NavigationSplitViewVisibility = .all

    @State private var stats = MockData.stats
    @State private var isLoadingStats = false

    var body: some View {
        NavigationSplitView(columnVisibility: $columnVisibility) {
            SidebarView(selection: $sidebarSelection, stats: stats)
                .navigationSplitViewColumnWidth(min: 200, ideal: 220, max: 240)
                .toolbar(removing: .sidebarToggle)
        } detail: {
            switch sidebarSelection {
            case .dashboard, .none:
                DashboardView(
                    stats: stats,
                    isLoading: isLoadingStats,
                    onRefresh: { Task { await loadStats() } },
                    onGoToListings:   { sidebarSelection = .readyNow },
                    onGoToUsers:      { sidebarSelection = .users },
                    onGoToSupport:    { sidebarSelection = .support },
                    onGoToAnalytics:  { sidebarSelection = .analytics },
                    onGoToCommissions: { sidebarSelection = .commissions }
                )

            case .analytics:
                AnalyticsView(onNavigateToUser: { userId in
                    Task { await navigateToUser(userId) }
                })

            case .readyNow:
                ReadyNowView(onNavigateToUser: { userId in
                    Task { await navigateToUser(userId) }
                })

            case .preOrders:
                PreOrderView()

            case .commissions:
                CommissionsView()

            case .orders:
                ordersLayout

            case .users:
                usersLayout

            case .userMap:
                UserMapView(onNavigateToUser: { userId in
                    Task { await navigateToUser(userId) }
                })

            case .support:
                supportLayout
            }
        }
        .task {
            await loadStats()
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 30_000_000_000)
                guard !Task.isCancelled else { break }
                await loadStats()
            }
        }
    }

    // MARK: - Orders: list + detail, drag-resizable split

    private var ordersLayout: some View {
        HSplitView {
            OrdersView(selectedOrder: $selectedOrder)
                .frame(minWidth: 380, idealWidth: 520, maxWidth: 700)
            if let order = selectedOrder {
                OrderAdminDetailView(
                    order: order,
                    onCancelled: { updated in
                        selectedOrder = updated
                    }
                )
                .frame(minWidth: 420, maxWidth: .infinity, maxHeight: .infinity)
            } else {
                EmptyDetailView(
                    icon: "bag.fill",
                    message: "Select an order to view details"
                )
                .frame(minWidth: 420, maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: - Users: list + dossier, drag-resizable split

    private var usersLayout: some View {
        HSplitView {
            UsersView(selectedUser: $selectedUser)
                .frame(minWidth: 460, idealWidth: 620, maxWidth: 900)
            if let user = selectedUser {
                UserDossierView(
                    user: user,
                    onUpdated: { updated in
                        selectedUser = updated
                        Task { await loadStats() }
                    },
                    onNavigateToUser: { userId in
                        Task { await navigateToUser(userId) }
                    }
                )
                .frame(minWidth: 420, maxWidth: .infinity, maxHeight: .infinity)
            } else {
                EmptyDetailView(
                    icon: "person.2.fill",
                    message: "Select a user to view their profile"
                )
                .frame(minWidth: 420, maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: - Support: ticket list + detail, drag-resizable split

    private var supportLayout: some View {
        HSplitView {
            SupportView(selectedTicket: $selectedTicket, onStatsChanged: {
                Task { await loadStats() }
            })
            .frame(minWidth: 340, idealWidth: 460, maxWidth: 640)
            if let ticket = selectedTicket {
                TicketDetailView(ticket: ticket, onUpdated: { updated in
                    NotificationCenter.default.post(name: .ticketDidUpdate, object: updated)
                    selectedTicket = updated
                    Task { await loadStats() }
                })
                .frame(minWidth: 420, maxWidth: .infinity, maxHeight: .infinity)
            } else {
                EmptyDetailView(
                    icon: "bubble.left.and.bubble.right.fill",
                    message: "Select a ticket to view details"
                )
                .frame(minWidth: 420, maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: - Data loading

    private func loadStats() async {
        isLoadingStats = true
        stats = (try? await SupabaseAdminService.shared.fetchDashboardStats()) ?? MockData.stats
        isLoadingStats = false
    }

    /// Fetch a single user by UUID and navigate the dossier panel to show them.
    private func navigateToUser(_ userId: UUID) async {
        guard let user = try? await SupabaseAdminService.shared.fetchUser(id: userId) else { return }
        selectedUser = user
        sidebarSelection = .users   // ensure users layout is visible
    }
}

extension Notification.Name {
    static let ticketDidUpdate = Notification.Name("bakeri.ticketDidUpdate")
}
