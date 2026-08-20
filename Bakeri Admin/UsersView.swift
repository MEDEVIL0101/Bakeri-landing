//
//  UsersView.swift
//  Bakeri Admin
//
//  Module 3 — All Users list with search, filter by role/status, and sorting.
//

import SwiftUI

struct UsersView: View {
    @Binding var selectedUser: AdminUser?

    @State private var users: [AdminUser] = MockData.users
    @State private var searchText = ""
    @State private var roleFilter: RoleFilter = .all
    @State private var sortOrder: [KeyPathComparator<AdminUser>] = [
        KeyPathComparator(\.lastActiveSortDate, order: .reverse)
    ]
    @State private var isLoading = false

    private var filtered: [AdminUser] {
        var r = users
        switch roleFilter {
        case .bakers: r = r.filter { $0.isBaker }
        case .buyers:  r = r.filter { !$0.isBaker }
        case .all:     break
        }
        if !searchText.isEmpty {
            r = r.filter {
                $0.displayName.localizedCaseInsensitiveContains(searchText) ||
                $0.email.localizedCaseInsensitiveContains(searchText) ||
                ($0.bakeryName ?? "").localizedCaseInsensitiveContains(searchText)
            }
        }
        r.sort(using: sortOrder)
        return r
    }

    private var selectionBinding: Binding<UUID?> {
        Binding(
            get: { selectedUser?.id },
            set: { newID in selectedUser = filtered.first { $0.id == newID } }
        )
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
                    VStack(spacing: 12) {
                        Image(systemName: "person.slash").font(.system(size: 36)).foregroundStyle(.tertiary)
                        Text("No users found").font(.title3).foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    usersTable
                }
            }
        }
        .task { await loadUsers() }
        .task {
            // Refresh only presence data every 30 seconds — keeps Online badge live
            // without the expense of re-fetching all auth users
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 30_000_000_000)
                guard !Task.isCancelled, !users.isEmpty else { continue }
                let presenceMap = (try? await SupabaseAdminService.shared.fetchPresence()) ?? [:]
                users = users.map { user in
                    var u = user
                    u.lastSeenAt  = presenceMap[user.id]?.lastSeenAt
                    u.appVersion  = presenceMap[user.id]?.appVersion
                    return u
                }
            }
        }
    }

    // MARK: - Toolbar

    private var toolbarArea: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("All Users").font(.system(size: 18, weight: .bold)).foregroundStyle(DS.textPrimary)
                    Text("\(filtered.count) shown · \(users.filter { $0.isBaker }.count) bakers · \(users.filter { !$0.isBaker }.count) buyers")
                        .font(.system(size: 11)).foregroundStyle(DS.textSecondary)
                }
                Spacer()
                if isLoading { ProgressView().scaleEffect(0.7) }
                Button { Task { await loadUsers() } } label: {
                    Image(systemName: "arrow.clockwise").font(.system(size: 13, weight: .medium))
                        .foregroundStyle(DS.textSecondary)
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 20).padding(.top, 20).padding(.bottom, 12)

            HStack(spacing: 10) {
                // Search
                HStack(spacing: 6) {
                    Image(systemName: "magnifyingglass").font(.system(size: 12)).foregroundStyle(DS.textTertiary)
                    TextField("Search users…", text: $searchText).font(.system(size: 13)).textFieldStyle(.plain)
                }
                .padding(.horizontal, 10).padding(.vertical, 7)
                .background(DS.cardBg)
                .clipShape(RoundedRectangle(cornerRadius: 8))
                .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(DS.cardBorder))
                .frame(maxWidth: 200)

                // Role filter
                Picker("Role", selection: $roleFilter) {
                    Text("All").tag(RoleFilter.all)
                    Text("Bakers").tag(RoleFilter.bakers)
                    Text("Buyers").tag(RoleFilter.buyers)
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                .frame(width: 180)
            }
            .padding(.horizontal, 20).padding(.bottom, 12)
        }
        .background(DS.cardBg)
    }

    // MARK: - Column header

    // MARK: - User table (native macOS Table — draggable column dividers + sortable headers)

    private var usersTable: some View {
        Table(filtered, selection: selectionBinding, sortOrder: $sortOrder) {
            TableColumn("Email / Bakery / Name", sortUsing: KeyPathComparator(\.email)) { user in
                VStack(alignment: .leading, spacing: 3) {
                    Text(user.email)
                        .font(.system(size: 12.5, weight: .medium))
                        .foregroundStyle(DS.textPrimary)
                        .lineLimit(1)
                    HStack(spacing: 4) {
                        if let bakery = user.bakeryName, !bakery.isEmpty {
                            Text(bakery)
                                .font(.system(size: 11, weight: .semibold))
                                .foregroundStyle(DS.brand)
                                .lineLimit(1)
                            Text("·")
                                .font(.system(size: 10))
                                .foregroundStyle(DS.textTertiary)
                        }
                        Text(user.displayName)
                            .font(.system(size: 11))
                            .foregroundStyle(DS.textSecondary)
                            .lineLimit(1)
                    }
                }
                .padding(.vertical, 4)
            }
            .width(min: 220, ideal: 300)

            TableColumn("Role", sortUsing: KeyPathComparator(\.roleSortKey)) { user in
                RoleBadge(isBaker: user.isBaker).fixedSize()
            }
            .width(min: 70, ideal: 84, max: 110)

            TableColumn("Stripe", sortUsing: KeyPathComparator(\.stripeSortRank)) { user in
                if user.isBaker {
                    StripeStatusBadge(connected: user.stripeConnected, started: user.stripeStarted).fixedSize()
                } else {
                    Text("—").font(.system(size: 11)).foregroundStyle(DS.textTertiary)
                }
            }
            .width(min: 90, ideal: 120, max: 150)

            TableColumn("Web Slug", sortUsing: KeyPathComparator(\.webSlugSortKey)) { user in
                if let slug = user.webSlug {
                    if let url = user.storefrontURL {
                        Link(destination: url) {
                            Text(slug)
                                .font(.system(size: 11, design: .monospaced))
                                .foregroundStyle(DS.brand)
                                .lineLimit(1)
                                .truncationMode(.tail)
                        }
                    } else {
                        Text(slug).font(.system(size: 11, design: .monospaced))
                            .foregroundStyle(DS.textSecondary).lineLimit(1)
                    }
                } else {
                    Text("—").font(.system(size: 11)).foregroundStyle(DS.textTertiary)
                }
            }
            .width(min: 110, ideal: 170, max: 260)

            TableColumn("Joined", sortUsing: KeyPathComparator(\.createdAt)) { user in
                Text(fmtDate(user.createdAt))
                    .font(.system(size: 11))
                    .foregroundStyle(DS.textSecondary)
                    .lineLimit(1)
            }
            .width(min: 80, ideal: 96, max: 130)

            TableColumn("Last Active", sortUsing: KeyPathComparator(\.lastActiveSortDate)) { user in
                Text(relTime(user.lastActiveAt))
                    .font(.system(size: 11))
                    .foregroundStyle(DS.textTertiary)
                    .lineLimit(1)
            }
            .width(min: 80, ideal: 100, max: 140)

            TableColumn("Status", sortUsing: KeyPathComparator(\.statusSortRank)) { user in
                UserStatusBadge(status: user.accountStatus).fixedSize()
            }
            .width(min: 80, ideal: 100, max: 140)

            TableColumn("App Version", sortUsing: KeyPathComparator(\.appVersionSortKey)) { user in
                if let v = user.appVersion {
                    Text(v).font(.system(size: 11, design: .monospaced)).foregroundStyle(DS.textSecondary)
                } else {
                    Text("—").font(.system(size: 11)).foregroundStyle(DS.textTertiary)
                }
            }
            .width(min: 80, ideal: 96, max: 120)
        }
    }

    // MARK: - Helpers

    private func fmtDate(_ d: Date) -> String {
        let f = DateFormatter(); f.dateFormat = "MMM d, yyyy"; return f.string(from: d)
    }

    private func relTime(_ d: Date?) -> String {
        guard let d else { return "Never" }
        let diff = Date().timeIntervalSince(d)
        if diff < 3600    { return "\(Int(diff/60))m ago" }
        if diff < 86400   { return "\(Int(diff/3600))h ago" }
        return "\(Int(diff/86400))d ago"
    }

    // MARK: - Data

    private func loadUsers() async {
        isLoading = true
        defer { isLoading = false }
        // All three fetches run concurrently
        async let authFetch     = SupabaseAdminService.shared.fetchAuthUsers()
        async let profileFetch  = SupabaseAdminService.shared.fetchProfiles()
        async let presenceFetch = SupabaseAdminService.shared.fetchPresence()
        let authUsers   = (try? await authFetch)    ?? []
        let profiles    = (try? await profileFetch) ?? []
        let presenceMap = (try? await presenceFetch) ?? [:]
        if authUsers.isEmpty {
            users = MockData.users
            return
        }
        let profileMap = Dictionary(uniqueKeysWithValues: profiles.map { ($0.id, $0) })
        users = authUsers.map { auth in
            var user = AdminUser(
                id: auth.id,
                email: auth.email ?? "—",
                profile: profileMap[auth.id],
                createdAt: parseAuthDate(auth.created_at) ?? .distantPast,
                lastSignInAt: auth.last_sign_in_at.flatMap { parseAuthDate($0) },
                isBanned: auth.banned_until != nil
            )
            user.lastSeenAt = presenceMap[auth.id]?.lastSeenAt
            user.appVersion = presenceMap[auth.id]?.appVersion
            return user
        }
    }

    // Supabase Auth dates use microseconds (6 decimal places, e.g. 2026-06-12T10:30:00.123456Z).
    // Try fractional first, then bare, then strip sub-milliseconds as a fallback.
    private func parseAuthDate(_ s: String) -> Date? {
        let withFrac = ISO8601DateFormatter()
        withFrac.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = withFrac.date(from: s) { return d }

        let noFrac = ISO8601DateFormatter()
        noFrac.formatOptions = [.withInternetDateTime]
        if let d = noFrac.date(from: s) { return d }

        // Trim to 3 decimal places and retry (handles microseconds on older OS versions)
        if let dotRange = s.range(of: "."), let zRange = s.range(of: "Z", options: .backwards) {
            let frac = String(s[dotRange.upperBound..<zRange.lowerBound])
            if frac.count > 3 {
                let trimmed = String(s[..<dotRange.upperBound]) + String(frac.prefix(3)) + "Z"
                return withFrac.date(from: trimmed)
            }
        }
        return nil
    }

    enum RoleFilter { case all, bakers, buyers }
}
