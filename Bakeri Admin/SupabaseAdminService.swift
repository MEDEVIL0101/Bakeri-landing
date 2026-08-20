//
//  SupabaseAdminService.swift
//  Bakeri Admin
//
//  All Supabase REST + Auth Admin API calls using the service_role key.
//  Uses raw URLSession + PostgREST — no SDKs required.
//

import Foundation

@MainActor
final class SupabaseAdminService: ObservableObject {

    static let shared = SupabaseAdminService()
    private init() {}

    private let baseURL = SupabaseConfig.projectURL
    private let authKey = SupabaseConfig.serviceRoleKey

    // MARK: - Request builders

    private func request(path: String, method: String = "GET",
                         query: [String: String] = [:], body: Data? = nil) -> URLRequest {
        var components = URLComponents(string: baseURL + path)!
        if !query.isEmpty {
            components.queryItems = query.map { URLQueryItem(name: $0.key, value: $0.value) }
        }
        var req = URLRequest(url: components.url!)
        req.httpMethod = method
        req.setValue("Bearer \(authKey)", forHTTPHeaderField: "Authorization")
        req.setValue(authKey, forHTTPHeaderField: "apikey")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        req.setValue("return=representation", forHTTPHeaderField: "Prefer")
        req.httpBody = body
        return req
    }

    private func authRequest(path: String, method: String = "GET", body: Data? = nil) -> URLRequest {
        var req = URLRequest(url: URL(string: baseURL + path)!)
        req.httpMethod = method
        req.setValue("Bearer \(authKey)", forHTTPHeaderField: "Authorization")
        req.setValue(authKey, forHTTPHeaderField: "apikey")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = body
        return req
    }

    // MARK: - Profiles

    func fetchProfiles() async throws -> [BakeriProfile] {
        let req = request(path: "/rest/v1/profiles", query: [
            "order": "updated_at.desc",
            "select": "id,user_name,email,business_name,bio,location,specialty_tags,community_handle,follower_count,following_count,baker_type,marketplace_onboarded,updated_at,profile_slug,stripe_connect_account_id,stripe_connect_onboarding_complete"
        ])
        let (data, _) = try await URLSession.shared.data(for: req)
        return try JSONDecoder().decode([BakeriProfile].self, from: data)
    }

    func fetchProfilesForUsers(_ userIds: [UUID]) async throws -> [UUID: BakeriProfile] {
        guard !userIds.isEmpty else { return [:] }
        let idList = userIds.map { $0.uuidString }.joined(separator: ",")
        let req = request(path: "/rest/v1/profiles", query: [
            "id": "in.(\(idList))",
            "select": "id,user_name,email,business_name,location,baker_type"
        ])
        let (data, _) = try await URLSession.shared.data(for: req)
        let profiles = (try? JSONDecoder().decode([BakeriProfile].self, from: data)) ?? []
        return Dictionary(uniqueKeysWithValues: profiles.map { ($0.id, $0) })
    }

    // MARK: - Vendor applications (city/state given on the public application form)

    // Keyed by lower-cased email — the only link back to a real account,
    // since applications are submitted before signup and carry no user_id.
    func fetchVendorApplicationLocations() async throws -> [String: VendorApplicationLocation] {
        let req = request(path: "/rest/v1/vendor_applications", query: [
            "select": "email,city,state_province"
        ])
        let (data, _) = try await URLSession.shared.data(for: req)
        let rows = (try? JSONDecoder().decode([VendorApplicationLocation].self, from: data)) ?? []
        var result: [String: VendorApplicationLocation] = [:]
        for row in rows {
            result[row.email.lowercased()] = row
        }
        return result
    }

    // MARK: - Registration events (IP + Cloudflare country at signup)

    func fetchRegistrationEvents() async throws -> [UUID: RegistrationEventInfo] {
        let req = request(path: "/rest/v1/registration_events", query: [
            "select": "user_id,ip_address,country_code"
        ])
        let (data, _) = try await URLSession.shared.data(for: req)
        let rows = (try? JSONDecoder().decode([RegistrationEventInfo].self, from: data)) ?? []
        return Dictionary(uniqueKeysWithValues: rows.map { ($0.user_id, $0) })
    }

    // MARK: - Auth users (admin endpoint)

    func fetchAuthUsers(page: Int = 1, perPage: Int = 200) async throws -> [AuthUserRecord] {
        let req = authRequest(path: "/auth/v1/admin/users?page=\(page)&per_page=\(perPage)")
        let (data, _) = try await URLSession.shared.data(for: req)
        // Supabase wraps in { users: [...] }
        struct Wrapper: Codable { let users: [AuthUserRecord] }
        if let wrapped = try? JSONDecoder().decode(Wrapper.self, from: data) { return wrapped.users }
        return (try? JSONDecoder().decode([AuthUserRecord].self, from: data)) ?? []
    }

    func banUser(id: UUID, banDuration: String = "876000h") async throws {
        let payload = ["ban_duration": banDuration]
        let body = try JSONSerialization.data(withJSONObject: payload)
        let req = authRequest(path: "/auth/v1/admin/users/\(id.uuidString)", method: "PUT", body: body)
        let (_, response) = try await URLSession.shared.data(for: req)
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode)
        else { throw AdminError.updateFailed }
    }

    func unbanUser(id: UUID) async throws {
        let payload = ["ban_duration": "none"]
        let body = try JSONSerialization.data(withJSONObject: payload)
        let req = authRequest(path: "/auth/v1/admin/users/\(id.uuidString)", method: "PUT", body: body)
        let (_, response) = try await URLSession.shared.data(for: req)
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode)
        else { throw AdminError.updateFailed }
    }

    func deleteUser(id: UUID) async throws {
        let req = authRequest(path: "/auth/v1/admin/users/\(id.uuidString)", method: "DELETE")
        let (_, response) = try await URLSession.shared.data(for: req)
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode)
        else { throw AdminError.updateFailed }
    }

    // MARK: - Marketplace listings (menu_items with marketplace columns)

    func fetchListings(kind: String? = nil) async throws -> [MarketplaceListing] {
        var query: [String: String] = [
            "is_listed_in_marketplace": "eq.true",
            "order": "updated_at.desc",
            "select": "id,user_id,name,item_description,category,default_price,is_active,listing_kind,available_qty_today,marketplace_price_from,lead_days,is_listed_in_marketplace,created_at,updated_at"
        ]
        if let k = kind { query["listing_kind"] = "eq.\(k)" }
        let req = request(path: "/rest/v1/menu_items", query: query)
        let (data, _) = try await URLSession.shared.data(for: req)
        var listings = (try? JSONDecoder().decode([MarketplaceListing].self, from: data)) ?? []

        // Join baker profiles (no FK in DB, so manual join)
        let userIds = Array(Set(listings.map { $0.user_id }))
        if let profileMap = try? await fetchProfilesForUsers(userIds) {
            listings = listings.map { listing in
                var l = listing
                if let p = profileMap[listing.user_id] {
                    l.profiles = MarketplaceListing.ProfileEmbed(
                        user_name: p.user_name,
                        business_name: p.business_name,
                        location: p.location
                    )
                }
                return l
            }
        }
        return listings
    }

    // Sum price_per_unit * quantity for paid marketplace orders (5% = Bakeri revenue)
    func fetchMarketplaceGTV() async throws -> Double {
        // Step 1: get all paid marketplace order IDs
        let ordersReq = request(path: "/rest/v1/orders", query: [
            "order_source": "eq.marketplace",
            "is_paid":      "eq.true",
            "select":       "id"
        ])
        let (ordersData, _) = try await URLSession.shared.data(for: ordersReq)
        struct IdOnly: Codable { let id: UUID }
        let orderIds = (try? JSONDecoder().decode([IdOnly].self, from: ordersData))?.map { $0.id } ?? []
        guard !orderIds.isEmpty else { return 0 }

        // Step 2: sum line items for those orders
        let idList = orderIds.map { $0.uuidString }.joined(separator: ",")
        let itemsReq = request(path: "/rest/v1/order_items", query: [
            "order_id":   "in.(\(idList))",
            "deleted_at": "is.null",
            "select":     "price_per_unit,quantity"
        ])
        let (itemsData, _) = try await URLSession.shared.data(for: itemsReq)
        struct Item: Codable { let price_per_unit: Double?; let quantity: Int? }
        let items = (try? JSONDecoder().decode([Item].self, from: itemsData)) ?? []
        return items.reduce(0) { $0 + ($1.price_per_unit ?? 0) * Double($1.quantity ?? 1) }
    }

    // MARK: - Daily analytics (real data)

    func fetchDailyMetrics(days: Int = 30) async throws -> [DailyMetric] {
        let calendar = Calendar.current
        let now      = Date()
        let dayFmt   = DateFormatter(); dayFmt.dateFormat = "yyyy-MM-dd"

        struct Bucket { var gtv = 0.0; var orders = 0; var newUsers = 0 }
        var buckets: [String: Bucket] = Dictionary(
            uniqueKeysWithValues: (0..<days).map { i in
                let d = calendar.date(byAdding: .day, value: -(days - 1 - i), to: now)!
                return (dayFmt.string(from: d), Bucket())
            }
        )

        // RPC computes the JOIN server-side — avoids all client-side query size limits
        let rpcBody = try? JSONSerialization.data(withJSONObject: ["p_days": days])
        let rpcReq  = request(path: "/rest/v1/rpc/admin_daily_order_metrics", method: "POST", body: rpcBody)

        struct RPCRow: Codable {
            let day: String          // Postgres DATE → "2026-06-15"
            let order_count: Int
            let daily_gtv: Double
        }

        async let rpcFetch  = URLSession.shared.data(for: rpcReq)
        async let authFetch = fetchAuthUsers(page: 1, perPage: 1000)

        let (rpcData, _) = try await rpcFetch
        let authUsers    = (try? await authFetch) ?? []
        let rpcRows      = (try? JSONDecoder().decode([RPCRow].self, from: rpcData)) ?? []

        for row in rpcRows {
            guard buckets[row.day] != nil else { continue }
            buckets[row.day]!.orders = row.order_count
            buckets[row.day]!.gtv   = row.daily_gtv
        }

        let isoFull  = ISO8601DateFormatter(); isoFull.formatOptions  = [.withInternetDateTime, .withFractionalSeconds]
        let isoBasic = ISO8601DateFormatter(); isoBasic.formatOptions = [.withInternetDateTime]
        for user in authUsers {
            guard let date = isoFull.date(from: user.created_at) ?? isoBasic.date(from: user.created_at) else { continue }
            let key = dayFmt.string(from: date)
            guard buckets[key] != nil else { continue }
            buckets[key]!.newUsers += 1
        }

        return (0..<days).map { i in
            let date = calendar.date(byAdding: .day, value: -(days - 1 - i), to: now)!
            let key  = dayFmt.string(from: date)
            let b    = buckets[key] ?? Bucket()
            return DailyMetric(date: date, gtv: b.gtv, revenue: b.gtv * 0.05,
                               orders: b.orders, newUsers: b.newUsers, newBakers: 0)
        }
    }

    // MARK: - Pre-order batches

    func fetchPreOrderBatches() async throws -> [PreOrderBatch] {
        let req = request(path: "/rest/v1/preorder_batches_with_stats", query: [
            "order":  "order_cutoff.asc",
            "select": "id,baker_user_id,title,category,pickup_date,order_cutoff,total_slots,price_per_slot,filled_slots"
        ])
        let (data, _) = try await URLSession.shared.data(for: req)
        struct RawBatch: Codable {
            let id: UUID; let baker_user_id: UUID; let title: String
            let category: String?; let pickup_date: String; let order_cutoff: String
            let total_slots: Int; let price_per_slot: Double; let filled_slots: Int
        }
        let batches = (try? JSONDecoder().decode([RawBatch].self, from: data)) ?? []
        guard !batches.isEmpty else { return [] }

        let userIds    = Array(Set(batches.map { $0.baker_user_id }))
        let profileMap = (try? await fetchProfilesForUsers(userIds)) ?? [:]
        let df         = DateFormatter(); df.dateFormat = "yyyy-MM-dd"; df.timeZone = TimeZone(identifier: "UTC")

        return batches.compactMap { b in
            guard let pickup = df.date(from: b.pickup_date),
                  let cutoff = df.date(from: b.order_cutoff) else { return nil }
            let profile = profileMap[b.baker_user_id]
            return PreOrderBatch(
                id:            b.id,
                listingId:     b.id,
                name:          b.title,
                bakerName:     profile?.user_name     ?? "Unknown",
                bakeryName:    profile?.business_name ?? "Unknown Bakery",
                totalBatchQty: b.total_slots,
                orderedQty:    b.filled_slots,
                deliveryDate:  pickup,
                cutoffDate:    cutoff,
                priceFrom:     b.price_per_slot,
                category:      b.category ?? "Bakery"
            )
        }
    }

    // MARK: - All-time platform GTV (potential revenue if all orders used payment flow)

    func fetchPlatformSummary() async throws -> [BakerOrderSummary] {
        // RPC does the JOIN in Postgres — avoids all client-side URL and decode size limits
        let rpcReq = request(path: "/rest/v1/rpc/admin_platform_summary", method: "POST")
        let (data, _) = try await URLSession.shared.data(for: rpcReq)

        struct RPCRow: Codable {
            let baker_user_id: UUID
            let order_count: Int
            let total_gtv: Double
            let paid_gtv: Double
        }

        let rows = (try? JSONDecoder().decode([RPCRow].self, from: data)) ?? []
        guard !rows.isEmpty else { return [] }

        let profileMap = (try? await fetchProfilesForUsers(rows.map { $0.baker_user_id })) ?? [:]
        return rows.map { row in
            let p = profileMap[row.baker_user_id]
            return BakerOrderSummary(
                id:         row.baker_user_id,
                name:       p?.business_name ?? p?.user_name ?? "Unknown",
                orderCount: row.order_count,
                totalGTV:   row.total_gtv,
                paidGTV:    row.paid_gtv
            )
        }
        .filter { $0.orderCount > 0 }
        .sorted { $0.totalGTV > $1.totalGTV }
    }

    func updateListingStatus(id: UUID, isActive: Bool) async throws {
        let body = try JSONSerialization.data(withJSONObject: ["is_active": isActive])
        let req = request(path: "/rest/v1/menu_items", method: "PATCH",
                          query: ["id": "eq.\(id.uuidString)"], body: body)
        let (_, response) = try await URLSession.shared.data(for: req)
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode)
        else { throw AdminError.updateFailed }
    }

    // MARK: - Marketplace orders

    func fetchMarketplaceOrders(status: String? = nil) async throws -> [MarketplaceOrder] {
        var query: [String: String] = [
            "order_source": "eq.marketplace",
            "order": "created_at.desc",
            "select": "id,user_id,order_name,customer_name,customer_email,due_date,status,is_paid,order_source,marketplace_status,buyer_profile_id,buyer_display_name,created_at"
        ]
        if let s = status { query["marketplace_status"] = "eq.\(s)" }
        let req = request(path: "/rest/v1/orders", query: query)
        let (data, _) = try await URLSession.shared.data(for: req)
        return (try? JSONDecoder().decode([MarketplaceOrder].self, from: data)) ?? []
    }

    // MARK: - Feedback / support tickets

    func fetchFeedback(status: String? = nil) async throws -> [FeedbackTicket] {
        var query: [String: String] = [
            "order": "created_at.desc",
            "select": "id,user_id,category,message,app_version,os_version,created_at,admin_status,assigned_to"
        ]
        if let s = status { query["admin_status"] = "eq.\(s)" }
        let req = request(path: "/rest/v1/feedback", query: query)
        let (data, _) = try await URLSession.shared.data(for: req)
        return (try? JSONDecoder().decode([FeedbackTicket].self, from: data)) ?? []
    }

    func updateTicketStatus(id: UUID, status: String, assignedTo: String? = nil) async throws {
        var payload: [String: Any] = ["admin_status": status]
        if let a = assignedTo { payload["assigned_to"] = a }
        let body = try JSONSerialization.data(withJSONObject: payload)
        let req = request(path: "/rest/v1/feedback", method: "PATCH",
                          query: ["id": "eq.\(id.uuidString)"], body: body)
        let (_, response) = try await URLSession.shared.data(for: req)
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode)
        else { throw AdminError.updateFailed }
    }

    // MARK: - Real-time presence

    func fetchPresence() async throws -> [UUID: PresenceInfo] {
        let req = request(path: "/rest/v1/user_presence", query: [
            "select": "user_id,last_seen_at,app_version"
        ])
        let (data, _) = try await URLSession.shared.data(for: req)
        struct Row: Codable { let user_id: UUID; let last_seen_at: String; let app_version: String? }
        let rows = (try? JSONDecoder().decode([Row].self, from: data)) ?? []
        var result: [UUID: PresenceInfo] = [:]
        for row in rows {
            if let d = parsePresenceDate(row.last_seen_at) {
                result[row.user_id] = PresenceInfo(lastSeenAt: d, appVersion: row.app_version)
            }
        }
        return result
    }

    // PostgREST returns TIMESTAMPTZ as "2026-06-12T17:55:14.323+00:00" (not Z).
    // ISO8601DateFormatter silently fails on +00:00 + fractional seconds together,
    // so normalise to Z first.
    private func parsePresenceDate(_ s: String) -> Date? {
        let z = s
            .replacingOccurrences(of: "+00:00", with: "Z")
            .replacingOccurrences(of: "-00:00", with: "Z")
        let withFrac = ISO8601DateFormatter()
        withFrac.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = withFrac.date(from: z) { return d }
        let noFrac = ISO8601DateFormatter()
        noFrac.formatOptions = [.withInternetDateTime]
        return noFrac.date(from: z)
    }

    // MARK: - Single-user lookup (for cross-navigation from order counterparts)

    func fetchUser(id: UUID) async throws -> AdminUser? {
        let authReq    = authRequest(path: "/auth/v1/admin/users/\(id.uuidString)")
        let profileReq = request(path: "/rest/v1/profiles", query: [
            "id": "eq.\(id.uuidString)",
            "select": "id,user_name,email,business_name,bio,location,specialty_tags,community_handle,follower_count,following_count,baker_type,marketplace_onboarded,updated_at"
        ])
        async let authFetch    = URLSession.shared.data(for: authReq)
        async let profileFetch = URLSession.shared.data(for: profileReq)
        let (authData, _)    = try await authFetch
        let (profileData, _) = try await profileFetch
        guard let auth = try? JSONDecoder().decode(AuthUserRecord.self, from: authData) else { return nil }
        let profile = (try? JSONDecoder().decode([BakeriProfile].self, from: profileData))?.first
        return AdminUser(
            id: auth.id,
            email: auth.email ?? "—",
            profile: profile,
            createdAt: parseAuthDate(auth.created_at) ?? .distantPast,
            lastSignInAt: auth.last_sign_in_at.flatMap { parseAuthDate($0) },
            isBanned: auth.banned_until != nil
        )
    }

    private func parseAuthDate(_ s: String) -> Date? {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = f.date(from: s) { return d }
        f.formatOptions = [.withInternetDateTime]
        if let d = f.date(from: s) { return d }
        if let dot = s.range(of: "."), let z = s.range(of: "Z", options: .backwards) {
            let frac = String(s[dot.upperBound..<z.lowerBound])
            if frac.count > 3 {
                let trimmed = String(s[..<dot.upperBound]) + String(frac.prefix(3)) + "Z"
                f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
                return f.date(from: trimmed)
            }
        }
        return nil
    }

    // MARK: - Per-user listing drill-down

    func fetchListingsForUser(userId: UUID) async throws -> [MarketplaceListing] {
        let req = request(path: "/rest/v1/menu_items", query: [
            "user_id": "eq.\(userId.uuidString)",
            "order":   "updated_at.desc",
            "select":  "id,user_id,name,item_description,category,default_price,is_active,listing_kind,available_qty_today,marketplace_price_from,lead_days,is_listed_in_marketplace,created_at,updated_at"
        ])
        let (data, _) = try await URLSession.shared.data(for: req)
        return (try? JSONDecoder().decode([MarketplaceListing].self, from: data)) ?? []
    }

    // MARK: - Per-user support history

    func fetchFeedbackForUser(userId: UUID) async throws -> [FeedbackTicket] {
        let req = request(path: "/rest/v1/feedback", query: [
            "user_id": "eq.\(userId.uuidString)",
            "order":   "created_at.desc",
            "select":  "id,user_id,category,message,app_version,os_version,created_at,admin_status,assigned_to"
        ])
        let (data, _) = try await URLSession.shared.data(for: req)
        return (try? JSONDecoder().decode([FeedbackTicket].self, from: data)) ?? []
    }

    func fetchListingStatsForUser(userId: UUID) async throws -> (total: Int, active: Int, marketplace: Int) {
        let req = request(path: "/rest/v1/menu_items", query: [
            "user_id": "eq.\(userId.uuidString)",
            "select":  "is_active,is_listed_in_marketplace"
        ])
        let (data, _) = try await URLSession.shared.data(for: req)
        struct Row: Codable { let is_active: Bool?; let is_listed_in_marketplace: Bool? }
        let rows = (try? JSONDecoder().decode([Row].self, from: data)) ?? []
        return (
            rows.count,
            rows.filter { $0.is_active == true }.count,
            rows.filter { $0.is_listed_in_marketplace == true }.count
        )
    }

    // MARK: - User order history

    func fetchOrdersForBaker(userId: UUID) async throws -> [AdminOrder] {
        let req = request(path: "/rest/v1/orders", query: [
            "user_id": "eq.\(userId.uuidString)",
            "deleted_at": "is.null",
            "order": "created_at.desc",
            "select": "id,user_id,order_name,customer_name,buyer_display_name,baker_display_name,buyer_profile_id,order_source,status,marketplace_status,is_paid,created_at,due_date,notes,fulfillment_type"
        ])
        let (data, _) = try await URLSession.shared.data(for: req)
        return (try? JSONDecoder().decode([AdminOrder].self, from: data)) ?? []
    }

    func fetchOrdersForBuyer(userId: UUID) async throws -> [AdminOrder] {
        let req = request(path: "/rest/v1/orders", query: [
            "buyer_profile_id": "eq.\(userId.uuidString)",
            "deleted_at": "is.null",
            "order": "created_at.desc",
            "select": "id,user_id,order_name,customer_name,buyer_display_name,baker_display_name,buyer_profile_id,order_source,status,marketplace_status,is_paid,created_at,due_date,notes,fulfillment_type"
        ])
        let (data, _) = try await URLSession.shared.data(for: req)
        return (try? JSONDecoder().decode([AdminOrder].self, from: data)) ?? []
    }

    func fetchOrderItems(orderId: UUID) async throws -> [AdminOrderItem] {
        let req = request(path: "/rest/v1/order_items", query: [
            "order_id": "eq.\(orderId.uuidString)",
            "deleted_at": "is.null",
            "select": "id,custom_name,quantity,unit,price_per_unit,notes"
        ])
        let (data, _) = try await URLSession.shared.data(for: req)
        return (try? JSONDecoder().decode([AdminOrderItem].self, from: data)) ?? []
    }

    // MARK: - All orders (platform-wide)

    func fetchAllOrders(statusFilter: String? = nil, limit: Int = 200) async throws -> [AdminOrder] {
        var query: [String: String] = [
            "deleted_at": "is.null",
            "order":      "created_at.desc",
            "limit":      "\(limit)",
            "select":     "id,user_id,order_name,customer_name,buyer_display_name,baker_display_name,buyer_profile_id,order_source,status,marketplace_status,is_paid,created_at,due_date,notes,fulfillment_type"
        ]
        if let s = statusFilter { query["marketplace_status"] = "eq.\(s)" }
        let req = request(path: "/rest/v1/orders", query: query)
        let (data, _) = try await URLSession.shared.data(for: req)
        var orders = (try? JSONDecoder().decode([AdminOrder].self, from: data)) ?? []
        // Manual orders don't store baker_display_name in the DB — resolve from profiles
        let bakerIds = Array(Set(orders.compactMap { ($0.baker_display_name ?? "").isEmpty ? $0.user_id : nil }))
        if !bakerIds.isEmpty, let profileMap = try? await fetchProfilesForUsers(bakerIds) {
            orders = orders.map { order in
                guard (order.baker_display_name ?? "").isEmpty else { return order }
                var o = order
                if let p = profileMap[order.user_id] {
                    o.baker_display_name = p.business_name ?? p.user_name
                }
                return o
            }
        }
        return orders
    }

    // MARK: - Order messages (read-only thread for admin view)

    func fetchOrderMessages(orderId: UUID) async throws -> [AdminOrderMessage] {
        let req = request(path: "/rest/v1/order_messages", query: [
            "order_id": "eq.\(orderId.uuidString)",
            "order":    "created_at.asc",
            "select":   "id,sender_profile_id,message,created_at"
        ])
        let (data, _) = try await URLSession.shared.data(for: req)
        return (try? JSONDecoder().decode([AdminOrderMessage].self, from: data)) ?? []
    }

    // MARK: - Order audit log

    func fetchOrderAuditLog(orderId: UUID) async throws -> [AdminOrderAction] {
        let req = request(path: "/rest/v1/admin_order_actions", query: [
            "order_id": "eq.\(orderId.uuidString)",
            "order":    "created_at.asc",
            "select":   "id,order_id,action_type,reason,refund_requested,created_at"
        ])
        let (data, _) = try await URLSession.shared.data(for: req)
        return (try? JSONDecoder().decode([AdminOrderAction].self, from: data)) ?? []
    }

    // MARK: - Cancel order

    func cancelOrder(orderId: UUID, reason: String, refundRequested: Bool) async throws {
        struct Params: Encodable {
            let p_order_id: String
            let p_reason: String
            let p_refund_requested: Bool
        }
        let body = try JSONEncoder().encode(Params(
            p_order_id: orderId.uuidString,
            p_reason: reason,
            p_refund_requested: refundRequested
        ))
        let req = request(path: "/rest/v1/rpc/admin_cancel_order", method: "POST", body: body)
        let (data, response) = try await URLSession.shared.data(for: req)
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            if let body = String(data: data, encoding: .utf8), body.contains("order_not_cancellable") {
                throw AdminError.orderNotCancellable
            }
            throw AdminError.updateFailed
        }
    }

    // MARK: - Suspend baker (auto-cancels pending orders, then bans in Auth)

    func suspendBaker(bakerId: UUID, reason: String) async throws -> Int {
        struct Params: Encodable { let p_baker_id: String; let p_reason: String }
        let body = try JSONEncoder().encode(Params(p_baker_id: bakerId.uuidString, p_reason: reason))
        let rpcReq = request(path: "/rest/v1/rpc/admin_suspend_baker", method: "POST", body: body)
        let (rpcData, rpcResponse) = try await URLSession.shared.data(for: rpcReq)
        guard let http = rpcResponse as? HTTPURLResponse, (200...299).contains(http.statusCode)
        else { throw AdminError.updateFailed }
        let cancelledCount = (try? JSONDecoder().decode(Int.self, from: rpcData)) ?? 0
        try await banUser(id: bakerId)
        return cancelledCount
    }

    // MARK: - Per-user order financial metrics

    func fetchOrderMetricsForUser(userId: UUID, isBaker: Bool) async throws -> UserOrderMetrics {
        let filterKey = isBaker ? "user_id" : "buyer_profile_id"
        let ordersReq = request(path: "/rest/v1/orders", query: [
            filterKey:    "eq.\(userId.uuidString)",
            "deleted_at": "is.null",
            "select":     "id,order_source,is_paid"
        ])
        let (ordersData, _) = try await URLSession.shared.data(for: ordersReq)
        struct OrderRow: Codable { let id: UUID; let order_source: String; let is_paid: Bool? }
        let orders = (try? JSONDecoder().decode([OrderRow].self, from: ordersData)) ?? []
        guard !orders.isEmpty else { return UserOrderMetrics() }

        let idList = orders.map { $0.id.uuidString }.joined(separator: ",")
        let itemsReq = request(path: "/rest/v1/order_items", query: [
            "order_id":   "in.(\(idList))",
            "deleted_at": "is.null",
            "select":     "order_id,price_per_unit,quantity"
        ])
        let (itemsData, _) = try await URLSession.shared.data(for: itemsReq)
        struct ItemRow: Codable { let order_id: UUID; let price_per_unit: Double?; let quantity: Int? }
        let items = (try? JSONDecoder().decode([ItemRow].self, from: itemsData)) ?? []

        let paidMktIds = Set(orders.filter { $0.order_source == "marketplace" && $0.is_paid == true }.map { $0.id })
        var totalValue = 0.0
        var feeBase    = 0.0
        for item in items {
            let line = (item.price_per_unit ?? 0) * Double(item.quantity ?? 1)
            totalValue += line
            if paidMktIds.contains(item.order_id) { feeBase += line }
        }
        return UserOrderMetrics(totalOrderValue: totalValue, platformFeeRevenue: feeBase * SupabaseConfig.takeRatePct)
    }

    // MARK: - Dashboard stats

    func fetchDashboardStats() async throws -> BakeriDashboardStats {
        async let profiles    = (try? fetchProfiles()) ?? []
        async let orders      = (try? fetchMarketplaceOrders()) ?? []
        async let tickets     = (try? fetchFeedback()) ?? []
        async let listings    = (try? fetchListings()) ?? []
        async let gtv         = (try? fetchMarketplaceGTV()) ?? 0

        let (p, o, t, l, g) = await (profiles, orders, tickets, listings, gtv)

        var s = BakeriDashboardStats()
        s.totalBakers = p.filter { !($0.business_name ?? "").isEmpty }.count
        s.totalBuyers = p.count - s.totalBakers
        s.totalUsers  = p.count

        s.readyNowListings  = l.filter { $0.listing_kind == "ready_now" }.count
        s.preOrderListings  = l.filter { $0.listing_kind == "preorder"  }.count
        s.customListings    = l.filter { $0.listing_kind == "custom"    }.count
        s.activeListings    = l.count

        let marketplaceOrders = o.filter { $0.order_source == "marketplace" }
        s.pendingOrders   = marketplaceOrders.filter { $0.marketplace_status == "pending" }.count
        s.openTickets      = t.filter { $0.admin_status == nil || $0.admin_status == "open" }.count
        s.resolvedTickets  = t.filter { $0.admin_status == "resolved" || $0.admin_status == "archived" }.count
        s.escalatedTickets = t.filter { $0.admin_status == "escalated" }.count
        var cats: [String: Int] = [:]
        for ticket in t { cats[ticket.category, default: 0] += 1 }
        s.ticketsByCategory = cats

        s.gtv30d     = g
        s.revenue30d = g * SupabaseConfig.takeRatePct
        s.aov        = marketplaceOrders.isEmpty ? 0 : g / Double(marketplaceOrders.count)

        return s
    }
}

// MARK: - Errors

enum AdminError: LocalizedError {
    case notFound, updateFailed, decodeFailed, orderNotCancellable

    var errorDescription: String? {
        switch self {
        case .notFound:            return "Record not found"
        case .updateFailed:        return "Update failed — check your service role key"
        case .decodeFailed:        return "Unexpected response format"
        case .orderNotCancellable: return "Order cannot be cancelled (already completed or cancelled)"
        }
    }
}
