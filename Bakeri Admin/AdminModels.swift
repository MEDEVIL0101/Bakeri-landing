//
//  AdminModels.swift
//  Bakeri Admin
//

import Foundation
import SwiftUI

// MARK: - Sidebar navigation

enum SidebarItem: String, CaseIterable, Hashable {
    case dashboard
    case analytics
    case readyNow
    case preOrders
    case commissions
    case orders
    case users
    case userMap
    case support
}

// MARK: - Enums with display helpers

enum UserAccountStatus: String, Codable, CaseIterable {
    case online, active, inactive, suspended, banned, pending

    var label: String {
        switch self {
        case .online:    return "Online"
        case .active:    return "Active"
        case .inactive:  return "Inactive"
        case .suspended: return "Suspended"
        case .banned:    return "Banned"
        case .pending:   return "Pending"
        }
    }

    var color: Color {
        switch self {
        case .online:    return DS.success
        case .active:    return Color(hex: "#3B82F6")
        case .inactive:  return DS.textTertiary
        case .suspended: return DS.warning
        case .banned:    return DS.danger
        case .pending:   return DS.info
        }
    }

    // Lower = shown first when sorting by online status
    var sortPriority: Int {
        switch self {
        case .online:    return 0
        case .active:    return 1
        case .inactive:  return 2
        case .pending:   return 3
        case .suspended: return 4
        case .banned:    return 5
        }
    }
}

enum ListingKind: String, Codable, CaseIterable {
    case readyNow   = "ready_now"
    case preorder
    case custom

    var label: String {
        switch self {
        case .readyNow:  return "Ready Now"
        case .preorder:  return "Pre-Order"
        case .custom:    return "Custom"
        }
    }

    var color: Color {
        switch self {
        case .readyNow:  return DS.success
        case .preorder:  return DS.info
        case .custom:    return DS.gold
        }
    }
}

enum CommissionStage: String, Codable, CaseIterable {
    case inquiry, quoteSent = "quote_sent", accepted, inProduction = "in_production", ready, delivered, cancelled

    var label: String {
        switch self {
        case .inquiry:      return "Inquiry"
        case .quoteSent:    return "Quote Sent"
        case .accepted:     return "Accepted"
        case .inProduction: return "In Production"
        case .ready:        return "Ready"
        case .delivered:    return "Delivered"
        case .cancelled:    return "Cancelled"
        }
    }

    var color: Color {
        switch self {
        case .inquiry:      return DS.textSecondary
        case .quoteSent:    return DS.info
        case .accepted:     return DS.brand
        case .inProduction: return DS.warning
        case .ready:        return DS.success
        case .delivered:    return DS.success
        case .cancelled:    return DS.danger
        }
    }

    var stageIndex: Int {
        switch self {
        case .inquiry: return 0; case .quoteSent: return 1; case .accepted: return 2
        case .inProduction: return 3; case .ready: return 4; case .delivered: return 5; case .cancelled: return 6
        }
    }
}

enum TicketStatus: String, Codable, CaseIterable {
    case open, inProgress = "in_progress", escalated, resolved, archived

    var label: String {
        switch self {
        case .open:       return "Open"
        case .inProgress: return "In Progress"
        case .escalated:  return "Escalated"
        case .resolved:   return "Resolved"
        case .archived:   return "Archived"
        }
    }

    var color: Color {
        switch self {
        case .open:       return DS.danger
        case .inProgress: return DS.warning
        case .escalated:  return Color(red: 180/255, green: 80/255, blue: 220/255)
        case .resolved:   return DS.success
        case .archived:   return DS.textTertiary
        }
    }
}

enum TicketUrgency: String, Codable, CaseIterable {
    case low, medium, high, critical

    var label: String { rawValue.capitalized }

    var color: Color {
        switch self {
        case .low:      return DS.success
        case .medium:   return DS.warning
        case .high:     return DS.danger
        case .critical: return Color(red: 200/255, green: 40/255, blue: 80/255)
        }
    }

    var sortPriority: Int {
        switch self { case .critical: return 0; case .high: return 1; case .medium: return 2; case .low: return 3 }
    }
}

enum TicketCategory: String, Codable, CaseIterable {
    case payment, fulfillment, technical, account, listing, refund, other

    var label: String {
        switch self {
        case .payment:     return "Payment"
        case .fulfillment: return "Fulfillment"
        case .technical:   return "Technical"
        case .account:     return "Account"
        case .listing:     return "Listing"
        case .refund:      return "Refund"
        case .other:       return "Other"
        }
    }

    var icon: String {
        switch self {
        case .payment:     return "creditcard.fill"
        case .fulfillment: return "shippingbox.fill"
        case .technical:   return "wrench.fill"
        case .account:     return "person.fill"
        case .listing:     return "tag.fill"
        case .refund:      return "arrow.uturn.left.circle.fill"
        case .other:       return "ellipsis.circle.fill"
        }
    }
}

// MARK: - Supabase raw decodable models

struct BakeriProfile: Codable, Identifiable {
    let id: UUID
    var user_name: String?
    var email: String?
    var business_name: String?
    var bio: String?
    var location: String?
    var specialty_tags: [String]?
    var community_handle: String?
    var follower_count: Int?
    var following_count: Int?
    var baker_type: String?
    var marketplace_onboarded: Bool?
    var updated_at: String?
    var profile_slug: String?
    var stripe_connect_account_id: String?
    var stripe_connect_onboarding_complete: Bool?

    var isBaker: Bool { !(business_name ?? "").isEmpty }
}

struct PresenceInfo {
    let lastSeenAt: Date
    let appVersion: String?
}

// Location as given on the public "For Bakers" application form
// (public.vendor_applications) — filled out before the applicant even has
// an account, so it's keyed by email rather than user_id. Used as a
// fallback wherever profiles.location was never filled in.
struct VendorApplicationLocation: Codable {
    let email: String
    let city: String
    let state_province: String

    var displayLocation: String? {
        let c = city.trimmingCharacters(in: .whitespaces)
        let s = state_province.trimmingCharacters(in: .whitespaces)
        if c.isEmpty && s.isEmpty { return nil }
        if c.isEmpty { return s }
        if s.isEmpty { return c }
        return "\(c), \(s)"
    }
}

// IP + Cloudflare-resolved country captured at signup (public.registration_events,
// service-role read only — built for bulk-registration/fraud detection). Used here
// as a last-resort map fallback when a user gave no location anywhere else.
struct RegistrationEventInfo: Codable {
    let user_id: UUID
    let ip_address: String?
    let country_code: String?

    var countryName: String? {
        guard let code = country_code, !code.isEmpty else { return nil }
        return Locale.current.localizedString(forRegionCode: code) ?? code
    }
}

struct AuthUserRecord: Codable {
    let id: UUID
    var email: String?
    var created_at: String
    var last_sign_in_at: String?
    var email_confirmed_at: String?
    var banned_until: String?
}

// MARK: - Combined admin user (join of auth + profile)

struct AdminUser: Identifiable {
    let id: UUID
    var email: String
    var profile: BakeriProfile?
    var createdAt: Date
    var lastSignInAt: Date?
    var lastSeenAt: Date?       // from user_presence heartbeat (30s cadence)
    var appVersion: String?     // last app version reported by that heartbeat
    var isBanned: Bool
    var bannedUntil: Date?
    // Simulated activity for dossier view (populated from mock or future RPC)
    var activityFeed: [UserActivityEvent] = []
    var orderCount: Int = 0
    var totalSpent: Double = 0
    var totalEarned: Double = 0
    var reviewScore: Double = 0
    var reviewCount: Int = 0

    var displayName: String { profile?.user_name ?? String(email.split(separator: "@").first ?? "Unknown") }
    var bakeryName: String?  { profile?.business_name }
    var isBaker: Bool        { !(profile?.business_name ?? "").isEmpty }
    var location: String     { profile?.location ?? "Unknown" }
    var stripeConnected: Bool { profile?.stripe_connect_onboarding_complete ?? false }
    var stripeStarted: Bool  { profile?.stripe_connect_account_id != nil }
    var webSlug: String?     { profile?.profile_slug.flatMap { $0.isEmpty ? nil : $0 } }
    var storefrontURL: URL?  { webSlug.flatMap { URL(string: "https://bakeriapp.com/\($0)") } }
    var accountStatus: UserAccountStatus {
        if isBanned { return .banned }
        // Heartbeat < 3 min = in the app right now (30s cadence × 6 = tolerance buffer)
        if let seen = lastSeenAt, Date().timeIntervalSince(seen) < 180 { return .online }
        // Fall back to last sign-in for Active/Inactive
        guard let last = lastSignInAt else { return .inactive }
        if Date().timeIntervalSince(last) < 2_592_000 { return .active }  // < 30 days
        return .inactive
    }

    var lastActiveAt: Date? { lastSeenAt ?? lastSignInAt }

    // MARK: Table sort surrogates
    // KeyPathComparator requires a non-Optional Comparable value, so these
    // stand in for the Optional fields shown in the Users table columns.
    var stripeSortRank: Int   { stripeConnected ? 2 : (stripeStarted ? 1 : 0) }
    var lastActiveSortDate: Date { lastActiveAt ?? .distantPast }
    var webSlugSortKey: String   { webSlug ?? "" }
    var statusSortRank: Int      { accountStatus.sortPriority }
    var roleSortKey: Int         { isBaker ? 0 : 1 }
    var appVersionSortKey: String { appVersion ?? "" }
    var avatarColor: Color {
        let colors: [Color] = [DS.brand, DS.info, DS.success, DS.gold, DS.warning, Color.purple]
        let index = abs(id.uuidString.hashValue) % colors.count
        return colors[index]
    }
}

struct UserActivityEvent: Identifiable {
    let id: UUID
    let timestamp: Date
    let type: ActivityEventType
    let detail: String
    var amount: Double?
}

enum ActivityEventType: String {
    case login, listingPublished, orderPlaced, orderReceived, reviewLeft, messageSent, profileUpdated, accountAction, communityPost

    var icon: String {
        switch self {
        case .login:            return "arrow.right.square.fill"
        case .listingPublished: return "tag.fill"
        case .orderPlaced:      return "cart.fill"
        case .orderReceived:    return "bag.fill"
        case .reviewLeft:       return "star.fill"
        case .messageSent:      return "message.fill"
        case .profileUpdated:   return "pencil.circle.fill"
        case .accountAction:    return "person.crop.circle.badge.exclamationmark.fill"
        case .communityPost:    return "text.bubble.fill"
        }
    }

    var color: Color {
        switch self {
        case .login:            return DS.info
        case .listingPublished: return DS.brand
        case .orderPlaced:      return DS.success
        case .orderReceived:    return DS.gold
        case .reviewLeft:       return DS.warning
        case .messageSent:      return DS.info
        case .profileUpdated:   return DS.textSecondary
        case .accountAction:    return DS.danger
        case .communityPost:    return Color.purple
        }
    }
}

// MARK: - Marketplace listing (from menu_items)

struct MarketplaceListing: Codable, Identifiable {
    let id: UUID
    var user_id: UUID
    var name: String
    var item_description: String
    var category: String
    var default_price: Double
    var is_active: Bool
    var listing_kind: String
    var available_qty_today: Int
    var marketplace_price_from: Double
    var lead_days: Int
    var is_listed_in_marketplace: Bool
    var created_at: String
    var updated_at: String
    // Joined at query time via Supabase embed
    var profiles: ProfileEmbed?

    struct ProfileEmbed: Codable {
        var user_name: String?
        var business_name: String?
        var location: String?
    }

    var bakerName: String  { profiles?.user_name    ?? "Unknown" }
    var bakeryName: String { profiles?.business_name ?? "Unknown Bakery" }
    var bakerLocation: String { profiles?.location ?? "—" }
    var kind: ListingKind  { ListingKind(rawValue: listing_kind) ?? .readyNow }
    var displayPrice: Double { marketplace_price_from > 0 ? marketplace_price_from : default_price }
}

// MARK: - Commission order (custom commissions with stage)

struct CommissionOrder: Identifiable {
    let id: UUID
    var bakerName: String
    var bakeryName: String
    var buyerName: String
    var productDescription: String
    var stage: CommissionStage
    var priceQuoted: Double?
    var dueDate: Date?
    var createdAt: Date
    var notes: String
}

// MARK: - Preorder batch

struct PreOrderBatch: Identifiable {
    let id: UUID
    var listingId: UUID
    var name: String
    var bakerName: String
    var bakeryName: String
    var totalBatchQty: Int
    var orderedQty: Int
    var deliveryDate: Date
    var cutoffDate: Date
    var priceFrom: Double
    var category: String

    var fillPct: Double { Double(orderedQty) / Double(max(totalBatchQty, 1)) }
    var spotsRemaining: Int { max(0, totalBatchQty - orderedQty) }
}

// MARK: - Marketplace order (from orders table)

struct MarketplaceOrder: Codable, Identifiable {
    let id: UUID
    var user_id: UUID
    var order_name: String
    var customer_name: String
    var customer_email: String
    var due_date: String
    var status: String
    var is_paid: Bool
    var order_source: String
    var marketplace_status: String?
    var buyer_profile_id: UUID?
    var buyer_display_name: String
    var created_at: String
}

// MARK: - Feedback / support ticket

struct FeedbackTicket: Codable, Identifiable {
    let id: UUID
    var user_id: UUID?
    var category: String
    var message: String
    var app_version: String?
    var os_version: String?
    var created_at: String
    // Admin columns (from migration)
    var admin_status: String?
    var assigned_to: String?
    // Joined
    var user_email: String?
    var user_name: String?

    var ticketStatus: TicketStatus {
        TicketStatus(rawValue: admin_status ?? "open") ?? .open
    }

    var ticketCategory: TicketCategory {
        TicketCategory(rawValue: category) ?? .other
    }

    var urgency: TicketUrgency {
        switch ticketCategory {
        case .payment, .refund:  return .high
        case .fulfillment:       return .medium
        case .account:           return .medium
        case .technical:         return .high
        default:                 return .low
        }
    }

    var displayUserName: String { user_name ?? user_email ?? "Anonymous" }
}

// MARK: - Admin note (attached to tickets)

struct AdminNote: Identifiable, Codable {
    let id: UUID
    var ticketId: UUID
    var agentName: String
    var body: String
    var isInternal: Bool
    var createdAt: Date
}

// MARK: - Dashboard stats

struct BakeriDashboardStats {
    var totalUsers: Int    = 0
    var totalBakers: Int   = 0
    var totalBuyers: Int   = 0
    var activeListings: Int   = 0
    var readyNowListings: Int = 0
    var preOrderListings: Int = 0
    var customListings: Int   = 0
    var pendingOrders: Int    = 0
    var openTickets: Int      = 0
    var resolvedTickets: Int  = 0
    var escalatedTickets: Int = 0
    var ticketsByCategory: [String: Int] = [:]
    var gtv30d: Double  = 0
    var revenue30d: Double = 0
    var aov: Double     = 0
    var newUsersThisWeek: Int = 0
    var newUsersToday: Int    = 0
}

// MARK: - Admin order (baker received orders + buyer marketplace purchases)

struct AdminOrder: Codable, Identifiable, Hashable {
    let id: UUID
    let user_id: UUID
    let order_name: String
    let customer_name: String?
    let buyer_display_name: String?
    var baker_display_name: String?
    let buyer_profile_id: UUID?
    let order_source: String
    let status: String
    let marketplace_status: String?
    let is_paid: Bool?
    let created_at: String
    let due_date: String?
    let notes: String?
    let fulfillment_type: String?

    var isMarketplace: Bool { order_source == "marketplace" }
    var sourceLabel: String { isMarketplace ? "Marketplace" : "Manual" }
    var sourceColor: Color { isMarketplace ? DS.brand : DS.gold }

    var displayStatus: String {
        if isMarketplace, let ms = marketplace_status, !ms.isEmpty {
            return ms.capitalized.replacingOccurrences(of: "_", with: " ")
        }
        return status.capitalized
    }

    var statusColor: Color {
        switch displayStatus.lowercased() {
        case "completed":           return DS.success
        case "confirmed":           return DS.info
        case "pending":             return DS.warning
        case "cancelled", "declined": return DS.danger
        case "paid", "packaged":    return DS.success
        default:                    return DS.textTertiary
        }
    }

    var isCompleted: Bool {
        let s = (marketplace_status ?? status).lowercased()
        return s == "completed"
    }

    var counterpart: String {
        if isMarketplace {
            let b = buyer_display_name ?? ""
            let k = baker_display_name ?? ""
            return b.isEmpty ? (k.isEmpty ? "—" : k) : b
        }
        return customer_name ?? "—"
    }
}

// MARK: - Order line item

struct AdminOrderItem: Codable, Identifiable {
    let id: UUID
    let custom_name: String?
    let quantity: Int?
    let unit: String?
    let price_per_unit: Double?
    let notes: String?

    var displayName: String { custom_name ?? "Unnamed Item" }
    var qty: Int           { quantity ?? 1 }
    var price: Double      { price_per_unit ?? 0 }
    var lineTotal: Double  { price * Double(qty) }
    var unitLabel: String  { unit.flatMap { $0.isEmpty ? nil : $0 } ?? "ea" }
}

// MARK: - Admin order action (audit log)

struct AdminOrderAction: Codable, Identifiable {
    let id:               UUID
    let order_id:         UUID
    let action_type:      String   // "cancelled" | "refund_requested" | "note"
    let reason:           String
    let refund_requested: Bool
    let created_at:       String

    var actionLabel: String {
        switch action_type {
        case "cancelled":         return "Cancelled by admin"
        case "refund_requested":  return "Refund requested"
        default:                  return "Note"
        }
    }
    var actionColor: Color {
        switch action_type {
        case "cancelled":        return DS.danger
        case "refund_requested": return DS.warning
        default:                 return DS.textTertiary
        }
    }
    var actionIcon: String {
        switch action_type {
        case "cancelled":        return "xmark.circle.fill"
        case "refund_requested": return "arrow.uturn.left.circle.fill"
        default:                 return "note.text"
        }
    }
}

// MARK: - Order message (read-only in admin)

struct AdminOrderMessage: Codable, Identifiable {
    let id:                UUID
    let sender_profile_id: UUID
    let message:           String
    let created_at:        String
}

// MARK: - Per-user order financial metrics

struct UserOrderMetrics {
    var totalOrderValue: Double = 0     // sum of all line item totals (excl. tax)
    var platformFeeRevenue: Double = 0  // 5% × paid marketplace subtotals
}

// MARK: - Per-baker all-time order volume (for platform potential revenue)

struct BakerOrderSummary: Identifiable {
    let id: UUID          // user_id
    var name: String      // business name or user_name
    var orderCount: Int
    var totalGTV: Double  // sum of all order items regardless of payment status/method
    var paidGTV: Double   // subset where is_paid = true (went through payment flow)

    var potentialRevenue: Double { totalGTV * 0.05 }
    var capturedRevenue:  Double { paidGTV  * 0.05 }
    var uncapturedGTV:    Double { totalGTV - paidGTV }
}

// MARK: - Daily metric for analytics charts

struct DailyMetric: Identifiable {
    let id: UUID = UUID()
    var date: Date
    var gtv: Double
    var revenue: Double
    var orders: Int
    var newUsers: Int
    var newBakers: Int
}
