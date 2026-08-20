//
//  SupportView.swift
//  Bakeri Admin
//
//  Module 4 — Support Ticket Queue.
//  Split-pane: left = sortable/filterable ticket list, right = TicketDetailView.
//

import SwiftUI

struct SupportView: View {
    @Binding var selectedTicket: FeedbackTicket?
    var onStatsChanged: (() -> Void)? = nil

    @State private var tickets: [FeedbackTicket] = MockData.tickets
    @State private var searchText = ""
    @State private var statusFilter: StatusFilter = .open
    @State private var sortField: SortField = .urgency
    @State private var isLoading = false

    private var filtered: [FeedbackTicket] {
        var r = tickets
        switch statusFilter {
        case .open:       r = r.filter { $0.ticketStatus == .open }
        case .inProgress: r = r.filter { $0.ticketStatus == .inProgress || $0.ticketStatus == .escalated }
        case .resolved:   r = r.filter { $0.ticketStatus == .resolved || $0.ticketStatus == .archived }
        case .all:        break
        }
        if !searchText.isEmpty {
            r = r.filter {
                $0.displayUserName.localizedCaseInsensitiveContains(searchText) ||
                $0.message.localizedCaseInsensitiveContains(searchText) ||
                $0.ticketCategory.label.localizedCaseInsensitiveContains(searchText)
            }
        }
        r.sort {
            switch sortField {
            case .urgency: return $0.urgency.sortPriority < $1.urgency.sortPriority
            case .newest:  return $0.created_at > $1.created_at
            case .oldest:  return $0.created_at < $1.created_at
            }
        }
        return r
    }

    var body: some View {
        ZStack {
            DS.pageBg.ignoresSafeArea()
            VStack(spacing: 0) {
                toolbarArea
                Divider()
                if isLoading {
                    ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if filtered.isEmpty {
                    emptyState
                } else {
                    ticketList
                }
            }
        }
        .task { await loadTickets() }
        .onReceive(NotificationCenter.default.publisher(for: .ticketDidUpdate)) { note in
            if let updated = note.object as? FeedbackTicket {
                if let i = tickets.firstIndex(where: { $0.id == updated.id }) {
                    tickets[i] = updated
                }
            }
        }
    }

    // MARK: - Toolbar

    private var toolbarArea: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Feedback Queue").font(.system(size: 18, weight: .bold)).foregroundStyle(DS.textPrimary)
                    Text("\(filtered.count) tickets · \(tickets.filter { $0.ticketStatus == .open }.count) open")
                        .font(.system(size: 11)).foregroundStyle(DS.textSecondary)
                }
                Spacer()
                Button { Task { await loadTickets() } } label: {
                    Image(systemName: "arrow.clockwise").font(.system(size: 13, weight: .medium)).foregroundStyle(DS.textSecondary)
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 20).padding(.top, 20).padding(.bottom, 12)

            // Search
            HStack(spacing: 6) {
                Image(systemName: "magnifyingglass").font(.system(size: 12)).foregroundStyle(DS.textTertiary)
                TextField("Search tickets…", text: $searchText).font(.system(size: 13)).textFieldStyle(.plain)
            }
            .padding(.horizontal, 10).padding(.vertical, 7)
            .background(DS.cardBg)
            .clipShape(RoundedRectangle(cornerRadius: 8))
            .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(DS.cardBorder))
            .padding(.horizontal, 20).padding(.bottom, 8)

            // Status filter tabs
            HStack(spacing: 0) {
                filterTab("Open", .open, count: tickets.filter { $0.ticketStatus == .open }.count)
                filterTab("In Progress", .inProgress, count: tickets.filter { $0.ticketStatus == .inProgress || $0.ticketStatus == .escalated }.count)
                filterTab("Resolved", .resolved, count: tickets.filter { $0.ticketStatus == .resolved }.count)
                filterTab("All", .all, count: tickets.count)

                Spacer()

                // Sort picker
                Picker("Sort", selection: $sortField) {
                    Text("Urgency").tag(SortField.urgency)
                    Text("Newest").tag(SortField.newest)
                    Text("Oldest").tag(SortField.oldest)
                }
                .pickerStyle(.menu)
                .labelsHidden()
                .font(.system(size: 12))
                .frame(width: 110)
            }
            .padding(.horizontal, 16).padding(.bottom, 10)
        }
        .background(DS.cardBg)
    }

    private func filterTab(_ label: String, _ filter: StatusFilter, count: Int) -> some View {
        let isActive = statusFilter == filter
        return Button { statusFilter = filter } label: {
            HStack(spacing: 5) {
                Text(label).font(.system(size: 12, weight: isActive ? .semibold : .regular)).lineLimit(1).fixedSize()
                if count > 0 {
                    Text("\(count)").font(.system(size: 10, weight: .bold))
                        .foregroundStyle(isActive ? .white : DS.textTertiary)
                        .padding(.horizontal, 6).padding(.vertical, 1)
                        .background(isActive ? DS.brand : DS.pageBg)
                        .clipShape(Capsule())
                }
            }
            .foregroundStyle(isActive ? DS.brand : DS.textSecondary)
            .padding(.horizontal, 12).padding(.vertical, 6)
            .background(isActive ? DS.brand.opacity(0.08) : Color.clear)
            .clipShape(RoundedRectangle(cornerRadius: 7))
        }
        .buttonStyle(.plain)
    }

    // MARK: - Ticket list

    private var ticketList: some View {
        ScrollView {
            LazyVStack(spacing: 0) {
                ForEach(filtered) { ticket in
                    ticketRow(ticket)
                    Divider().padding(.leading, 56)
                }
            }
        }
    }

    private func ticketRow(_ ticket: FeedbackTicket) -> some View {
        let isSelected = selectedTicket?.id == ticket.id
        return Button { selectedTicket = ticket } label: {
            HStack(alignment: .top, spacing: 12) {
                // Category icon
                ZStack {
                    RoundedRectangle(cornerRadius: 8)
                        .fill(ticket.ticketCategory.color.opacity(0.10))
                        .frame(width: 34, height: 34)
                    Image(systemName: ticket.ticketCategory.icon)
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(ticket.ticketCategory.color)
                }

                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 6) {
                        Text(ticket.displayUserName)
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(DS.textPrimary)
                        UrgencyBadge(urgency: ticket.urgency)
                        Spacer()
                        Text(relTime(ticket.created_at))
                            .font(.system(size: 10))
                            .foregroundStyle(DS.textTertiary)
                    }

                    Text(ticket.ticketCategory.label)
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(ticket.ticketCategory.color)

                    Text(ticket.message)
                        .font(.system(size: 12))
                        .foregroundStyle(DS.textSecondary)
                        .lineLimit(2)

                    if let assignedTo = ticket.assigned_to {
                        HStack(spacing: 4) {
                            Image(systemName: "person.circle.fill").font(.system(size: 10)).foregroundStyle(DS.textTertiary)
                            Text("Assigned to \(assignedTo)").font(.system(size: 10)).foregroundStyle(DS.textTertiary)
                        }
                    }
                }
            }
            .padding(.horizontal, 16).padding(.vertical, 12)
            .background(isSelected ? DS.brand.opacity(0.05) : Color.clear)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private var emptyState: some View {
        VStack(spacing: 12) {
            Image(systemName: "checkmark.bubble.fill").font(.system(size: 40)).foregroundStyle(.tertiary)
            Text("No tickets in this filter").font(.title3).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: - Data

    private func loadTickets() async {
        isLoading = true
        tickets = (try? await SupabaseAdminService.shared.fetchFeedback()) ?? MockData.tickets
        if tickets.isEmpty { tickets = MockData.tickets }
        isLoading = false
    }

    private func relTime(_ iso: String) -> String {
        let df = ISO8601DateFormatter()
        df.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let d = df.date(from: iso) ?? ISO8601DateFormatter().date(from: iso) ?? Date()
        let diff = Date().timeIntervalSince(d)
        if diff < 3600  { return "\(Int(diff/60))m ago" }
        if diff < 86400 { return "\(Int(diff/3600))h ago" }
        return "\(Int(diff/86400))d ago"
    }

    // MARK: - Types

    enum StatusFilter { case open, inProgress, resolved, all }
    enum SortField     { case urgency, newest, oldest }
}

// Category color extension for icons
private extension TicketCategory {
    var color: Color {
        switch self {
        case .payment:     return DS.success
        case .fulfillment: return DS.gold
        case .technical:   return DS.info
        case .account:     return DS.brand
        case .listing:     return Color.purple
        case .refund:      return DS.danger
        case .other:       return DS.textSecondary
        }
    }
}
