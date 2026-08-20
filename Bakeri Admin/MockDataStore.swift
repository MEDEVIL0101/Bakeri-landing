//
//  MockDataStore.swift
//  Bakeri Admin
//
//  Rich mock data for demo mode and SwiftUI previews.
//  Mirrors a realistic production state of the Bakeri marketplace.
//

import Foundation
import SwiftUI

enum MockData {

    // MARK: - Users

    static let users: [AdminUser] = {
        let bakers = bakerProfiles.enumerated().map { i, raw in makeUser(raw, index: i) }
        let buyers = buyerProfiles.enumerated().map { i, raw in makeUser(raw, index: i + bakerProfiles.count) }
        return bakers + buyers
    }()

    private static func makeUser(_ raw: RawUserSeed, index: Int) -> AdminUser {
        var u = AdminUser(
            id: UUID(uuidString: raw.id)!,
            email: raw.email,
            profile: BakeriProfile(
                id: UUID(uuidString: raw.id)!,
                user_name: raw.name,
                business_name: raw.bakeryName,
                bio: raw.bio,
                location: raw.location,
                specialty_tags: raw.tags,
                community_handle: raw.handle,
                follower_count: raw.followers,
                following_count: raw.following,
                updated_at: raw.createdAt
            ),
            createdAt: iso(raw.createdAt),
            lastSignInAt: iso(raw.lastSeen),
            isBanned: raw.banned
        )
        u.orderCount  = raw.orderCount
        u.totalSpent  = raw.totalSpent
        u.totalEarned = raw.totalEarned
        u.reviewScore = raw.reviewScore
        u.reviewCount = raw.reviewCount
        u.activityFeed = makeActivity(for: u, seed: index)
        return u
    }

    private struct RawUserSeed {
        let id, email, name, createdAt, lastSeen: String
        var bakeryName: String? = nil
        var bio: String? = nil
        var location: String = "Toronto, ON"
        var tags: [String]? = nil
        var handle: String? = nil
        var followers: Int? = nil
        var following: Int? = nil
        var banned: Bool = false
        var orderCount: Int = 0
        var totalSpent: Double = 0
        var totalEarned: Double = 0
        var reviewScore: Double = 0
        var reviewCount: Int = 0
    }

    private static let bakerProfiles: [RawUserSeed] = [
        RawUserSeed(id: "11111111-0000-0000-0000-000000000001", email: "emma@maisonlaurent.ca",
                    name: "Emma Laurent", createdAt: "2025-03-15T09:00:00Z", lastSeen: "2026-06-12T08:00:00Z",
                    bakeryName: "Maison Laurent Pâtisserie", bio: "French-trained pastry chef. Croissants, macarons, and viennoiserie baked daily with imported butter.",
                    location: "Montréal, QC", tags: ["croissants","macarons","viennoiserie","tarts"],
                    handle: "@maisonlaurent", followers: 1240, following: 88,
                    orderCount: 186, totalEarned: 9430, reviewScore: 4.9, reviewCount: 142),
        RawUserSeed(id: "11111111-0000-0000-0000-000000000002", email: "sophie@goldenlotusbakery.ca",
                    name: "Sophie Chen", createdAt: "2025-04-02T11:00:00Z", lastSeen: "2026-06-12T07:30:00Z",
                    bakeryName: "Golden Lotus Bakery", bio: "Fusion of Chinese and French pastry. Egg tarts, pineapple cakes, and matcha everything.",
                    location: "Toronto, ON", tags: ["egg-tarts","pineapple-cakes","matcha","asian-fusion"],
                    handle: "@goldenlotus", followers: 890, following: 56,
                    orderCount: 143, totalEarned: 7120, reviewScore: 4.8, reviewCount: 110),
        RawUserSeed(id: "11111111-0000-0000-0000-000000000003", email: "maria@casasantos.ca",
                    name: "Maria Santos", createdAt: "2025-05-10T14:00:00Z", lastSeen: "2026-06-11T18:00:00Z",
                    bakeryName: "Casa Santos", bio: "Authentic Portuguese pastries. 40-year family recipe pastel de nata.",
                    location: "Vancouver, BC", tags: ["pastel-de-nata","portuguese","traditional"],
                    handle: "@casasantos", followers: 620, following: 34,
                    orderCount: 98, totalEarned: 4870, reviewScore: 4.7, reviewCount: 82),
        RawUserSeed(id: "11111111-0000-0000-0000-000000000004", email: "amara@accrasweets.ca",
                    name: "Amara Osei", createdAt: "2025-06-01T10:00:00Z", lastSeen: "2026-06-12T06:00:00Z",
                    bakeryName: "Accra Sweets", bio: "West African confections — chin chin, puff puff, bofrot, and seasonal specials.",
                    location: "Mississauga, ON", tags: ["chin-chin","puff-puff","west-african","gluten-free-options"],
                    handle: "@accrasweets", followers: 445, following: 29,
                    orderCount: 71, totalEarned: 3210, reviewScore: 4.6, reviewCount: 58),
        RawUserSeed(id: "11111111-0000-0000-0000-000000000005", email: "julia@parkscakes.ca",
                    name: "Julia Park", createdAt: "2025-02-20T09:00:00Z", lastSeen: "2026-06-11T21:00:00Z",
                    bakeryName: "Park's Custom Cakes", bio: "Award-winning wedding and celebration cakes. 10+ years. Each cake is a commission.",
                    location: "Calgary, AB", tags: ["wedding-cakes","custom","tiered-cakes","fondant"],
                    handle: "@parkscakes", followers: 1870, following: 112,
                    orderCount: 54, totalEarned: 18900, reviewScore: 5.0, reviewCount: 52),
        RawUserSeed(id: "11111111-0000-0000-0000-000000000006", email: "hannah@hansartisan.ca",
                    name: "Hannah Kim", createdAt: "2025-07-15T08:00:00Z", lastSeen: "2026-06-10T12:00:00Z",
                    bakeryName: "Han's Artisan Bread", bio: "Long-fermentation sourdough. Country loaves, boules, and seasonal batards.",
                    location: "Ottawa, ON", tags: ["sourdough","artisan-bread","fermentation","whole-grain"],
                    handle: "@hansartisan", followers: 530, following: 41,
                    orderCount: 92, totalEarned: 5520, reviewScore: 4.8, reviewCount: 76),
        RawUserSeed(id: "11111111-0000-0000-0000-000000000007", email: "yuki@sakurasweets.ca",
                    name: "Yuki Tanaka", createdAt: "2025-08-01T10:00:00Z", lastSeen: "2026-06-12T09:00:00Z",
                    bakeryName: "Sakura Sweets", bio: "Traditional Japanese wagashi and modern fusion mochi. Seasonal and ceremonial.",
                    location: "Toronto, ON", tags: ["wagashi","mochi","japanese","seasonal"],
                    handle: "@sakurasweets", followers: 1120, following: 67,
                    orderCount: 80, totalEarned: 6400, reviewScore: 4.9, reviewCount: 74),
        RawUserSeed(id: "11111111-0000-0000-0000-000000000008", email: "priya@patelsweetshouse.ca",
                    name: "Priya Patel", createdAt: "2025-09-05T09:00:00Z", lastSeen: "2026-06-11T15:00:00Z",
                    bakeryName: "Patel's Sweet House", bio: "Handmade Indian mithai — ladoo, barfi, halwa, and celebration boxes for every occasion.",
                    location: "Brampton, ON", tags: ["ladoo","barfi","indian-sweets","mithai","celebration"],
                    handle: "@patelsweetshouse", followers: 780, following: 45,
                    orderCount: 118, totalEarned: 8130, reviewScore: 4.9, reviewCount: 96),
    ]

    private static let buyerProfiles: [RawUserSeed] = [
        RawUserSeed(id: "22222222-0000-0000-0000-000000000001", email: "james.wilson@gmail.com",
                    name: "James Wilson", createdAt: "2025-08-10T10:00:00Z", lastSeen: "2026-06-11T20:00:00Z",
                    location: "Toronto, ON", orderCount: 8, totalSpent: 384),
        RawUserSeed(id: "22222222-0000-0000-0000-000000000002", email: "sarah.mitchell@hotmail.com",
                    name: "Sarah Mitchell", createdAt: "2025-09-01T11:00:00Z", lastSeen: "2026-06-10T14:00:00Z",
                    location: "Montréal, QC", orderCount: 4, totalSpent: 820),
        RawUserSeed(id: "22222222-0000-0000-0000-000000000003", email: "daniel.park@gmail.com",
                    name: "Daniel Park", createdAt: "2025-07-22T09:00:00Z", lastSeen: "2026-06-12T07:00:00Z",
                    location: "Vancouver, BC", orderCount: 12, totalSpent: 560),
        RawUserSeed(id: "22222222-0000-0000-0000-000000000004", email: "aisha.okonkwo@gmail.com",
                    name: "Aisha Okonkwo", createdAt: "2025-10-05T12:00:00Z", lastSeen: "2026-06-11T18:00:00Z",
                    location: "Toronto, ON", orderCount: 3, totalSpent: 142),
        RawUserSeed(id: "22222222-0000-0000-0000-000000000005", email: "r.chen@outlook.com",
                    name: "Robert Chen", createdAt: "2025-11-12T08:00:00Z", lastSeen: "2026-06-09T11:00:00Z",
                    location: "Calgary, AB", orderCount: 6, totalSpent: 710),
        RawUserSeed(id: "22222222-0000-0000-0000-000000000006", email: "lucia.fernandez@gmail.com",
                    name: "Lucia Fernandez", createdAt: "2025-06-18T15:00:00Z", lastSeen: "2026-06-08T16:00:00Z",
                    location: "Montréal, QC", orderCount: 9, totalSpent: 430),
        RawUserSeed(id: "22222222-0000-0000-0000-000000000007", email: "m.thompson@rogers.com",
                    name: "Michael Thompson", createdAt: "2025-10-30T10:00:00Z", lastSeen: "2026-06-07T13:00:00Z",
                    location: "Ottawa, ON", orderCount: 5, totalSpent: 280),
        RawUserSeed(id: "22222222-0000-0000-0000-000000000008", email: "emily.j@gmail.com",
                    name: "Emily Johnson", createdAt: "2025-12-01T09:00:00Z", lastSeen: "2026-06-12T08:30:00Z",
                    location: "Toronto, ON", orderCount: 7, totalSpent: 330),
        RawUserSeed(id: "22222222-0000-0000-0000-000000000009", email: "david.kim@yahoo.ca",
                    name: "David Kim", createdAt: "2025-11-20T11:00:00Z", lastSeen: "2026-06-11T10:00:00Z",
                    location: "Vancouver, BC", orderCount: 11, totalSpent: 512),
        RawUserSeed(id: "22222222-0000-0000-0000-000000000010", email: "rachel.adams@gmail.com",
                    name: "Rachel Adams", createdAt: "2025-09-25T14:00:00Z", lastSeen: "2026-06-10T19:00:00Z",
                    location: "Toronto, ON", orderCount: 14, totalSpent: 670),
        RawUserSeed(id: "22222222-0000-0000-0000-000000000011", email: "thomas.moore@gmail.com",
                    name: "Thomas Moore", createdAt: "2025-12-10T10:00:00Z", lastSeen: "2026-06-11T20:00:00Z",
                    location: "Mississauga, ON", orderCount: 2, totalSpent: 210),
        RawUserSeed(id: "22222222-0000-0000-0000-000000000012", email: "isabella.garcia@hotmail.com",
                    name: "Isabella Garcia", createdAt: "2026-01-08T09:00:00Z", lastSeen: "2026-06-12T09:00:00Z",
                    location: "Toronto, ON", orderCount: 3, totalSpent: 480),
    ]

    private static func makeActivity(for user: AdminUser, seed: Int) -> [UserActivityEvent] {
        let now = Date()
        var events: [UserActivityEvent] = []
        var rng = SeededRNG(seed: seed)

        func daysAgo(_ d: Double) -> Date { now.addingTimeInterval(-d * 86400) }

        events.append(UserActivityEvent(id: UUID(), timestamp: daysAgo(rng.next(0.1, 2.0)), type: .login, detail: "Signed in from \(["iPhone 15 Pro", "iPhone 14", "iPad Pro"].randomElement()!)"))

        if user.isBaker {
            events.append(UserActivityEvent(id: UUID(), timestamp: daysAgo(rng.next(2, 5)), type: .listingPublished, detail: "Published listing in marketplace", amount: nil))
            events.append(UserActivityEvent(id: UUID(), timestamp: daysAgo(rng.next(5, 10)), type: .orderReceived, detail: "Marketplace order received", amount: Double.random(in: 25...85)))
            events.append(UserActivityEvent(id: UUID(), timestamp: daysAgo(rng.next(10, 20)), type: .reviewLeft, detail: "Left 5-star review for buyer", amount: nil))
            events.append(UserActivityEvent(id: UUID(), timestamp: daysAgo(rng.next(20, 40)), type: .profileUpdated, detail: "Updated bakery profile and photos"))
            events.append(UserActivityEvent(id: UUID(), timestamp: daysAgo(rng.next(40, 60)), type: .orderReceived, detail: "Marketplace order received", amount: Double.random(in: 30...120)))
        } else {
            events.append(UserActivityEvent(id: UUID(), timestamp: daysAgo(rng.next(1, 4)), type: .orderPlaced, detail: "Placed marketplace order", amount: Double.random(in: 15...80)))
            events.append(UserActivityEvent(id: UUID(), timestamp: daysAgo(rng.next(5, 15)), type: .reviewLeft, detail: "Left 5-star review for baker"))
            events.append(UserActivityEvent(id: UUID(), timestamp: daysAgo(rng.next(15, 30)), type: .orderPlaced, detail: "Placed marketplace order", amount: Double.random(in: 20...60)))
            events.append(UserActivityEvent(id: UUID(), timestamp: daysAgo(rng.next(30, 50)), type: .communityPost, detail: "Posted in community forum"))
        }

        return events.sorted { $0.timestamp > $1.timestamp }
    }

    // MARK: - Marketplace Listings

    static let readyNowListings: [MarketplaceListing] = [
        makeListing(id: "AAAA0001", userId: "11111111-0000-0000-0000-000000000001",
                    name: "Butter Croissants (½ doz)", description: "Freshly baked this morning with imported French butter. Flaky, golden layers.",
                    category: "Viennoiserie", kind: "ready_now", price: 18.0, qty: 8,
                    baker: "Emma Laurent", bakery: "Maison Laurent Pâtisserie", location: "Montréal, QC"),
        makeListing(id: "AAAA0002", userId: "11111111-0000-0000-0000-000000000001",
                    name: "Macaron Box (12pc)", description: "Assorted flavours: pistachio, rose, salted caramel, passion fruit, vanilla, and chocolate.",
                    category: "Confectionery", kind: "ready_now", price: 36.0, qty: 5,
                    baker: "Emma Laurent", bakery: "Maison Laurent Pâtisserie", location: "Montréal, QC"),
        makeListing(id: "AAAA0003", userId: "11111111-0000-0000-0000-000000000002",
                    name: "Hong Kong Egg Tarts (6pc)", description: "Silky smooth custard in a buttery shortcrust shell. Made fresh daily.",
                    category: "Pastry", kind: "ready_now", price: 14.00, qty: 18,
                    baker: "Sophie Chen", bakery: "Golden Lotus Bakery", location: "Toronto, ON"),
        makeListing(id: "AAAA0004", userId: "11111111-0000-0000-0000-000000000002",
                    name: "Pineapple Cake (gift box, 4pc)", description: "Taiwanese-style pineapple cakes with real pineapple jam. Individually wrapped.",
                    category: "Confectionery", kind: "ready_now", price: 22.0, qty: 10,
                    baker: "Sophie Chen", bakery: "Golden Lotus Bakery", location: "Toronto, ON"),
        makeListing(id: "AAAA0005", userId: "11111111-0000-0000-0000-000000000003",
                    name: "Pastel de Nata (6pc)", description: "Authentic Lisbon-style custard tarts. Caramelised tops, cinnamon-dusted.",
                    category: "Pastry", kind: "ready_now", price: 15.0, qty: 22,
                    baker: "Maria Santos", bakery: "Casa Santos", location: "Vancouver, BC"),
        makeListing(id: "AAAA0006", userId: "11111111-0000-0000-0000-000000000006",
                    name: "Country Sourdough Loaf", description: "2-day cold-fermented, 78% hydration. Crackly crust, open crumb. 900g.",
                    category: "Bread", kind: "ready_now", price: 14.0, qty: 4,
                    baker: "Hannah Kim", bakery: "Han's Artisan Bread", location: "Ottawa, ON"),
        makeListing(id: "AAAA0007", userId: "11111111-0000-0000-0000-000000000006",
                    name: "Whole Wheat Boule", description: "40% whole wheat, mild tang. Great for sandwiches. 750g.",
                    category: "Bread", kind: "ready_now", price: 13.0, qty: 3,
                    baker: "Hannah Kim", bakery: "Han's Artisan Bread", location: "Ottawa, ON"),
        makeListing(id: "AAAA0008", userId: "11111111-0000-0000-0000-000000000007",
                    name: "Wagashi Assortment (6pc)", description: "Seasonal wagashi: nerikiri, namagashi, and yokan. Artisan crafted.",
                    category: "Japanese", kind: "ready_now", price: 28.0, qty: 6,
                    baker: "Yuki Tanaka", bakery: "Sakura Sweets", location: "Toronto, ON"),
        makeListing(id: "AAAA0009", userId: "11111111-0000-0000-0000-000000000008",
                    name: "Mixed Ladoo Box (500g)", description: "Besan, motichoor, and coconut ladoo. Made with pure ghee and saffron.",
                    category: "Indian Sweets", kind: "ready_now", price: 18.0, qty: 9,
                    baker: "Priya Patel", bakery: "Patel's Sweet House", location: "Brampton, ON"),
        makeListing(id: "AAAA0010", userId: "11111111-0000-0000-0000-000000000008",
                    name: "Barfi Gift Box (16pc)", description: "Kaju, pistachio, and rose barfi. Presented in a decorated mithai box.",
                    category: "Indian Sweets", kind: "ready_now", price: 26.0, qty: 5,
                    baker: "Priya Patel", bakery: "Patel's Sweet House", location: "Brampton, ON"),
        makeListing(id: "AAAA0011", userId: "11111111-0000-0000-0000-000000000004",
                    name: "Chin Chin (250g bag)", description: "Crispy fried dough snack. Lightly sweetened with hints of coconut.",
                    category: "West African", kind: "ready_now", price: 10.0, qty: 14,
                    baker: "Amara Osei", bakery: "Accra Sweets", location: "Mississauga, ON"),
        makeListing(id: "AAAA0012", userId: "11111111-0000-0000-0000-000000000004",
                    name: "Puff Puff (1 dozen)", description: "Deep-fried yeast doughnuts dusted with sugar. Order before 11am for afternoon pickup.",
                    category: "West African", kind: "ready_now", price: 12.0, qty: 7,
                    baker: "Amara Osei", bakery: "Accra Sweets", location: "Mississauga, ON"),
    ]

    static let preOrderBatches: [PreOrderBatch] = [
        PreOrderBatch(id: UUID(), listingId: UUID(), name: "Sourdough Friday Batch (weekly)",
                      bakerName: "Hannah Kim", bakeryName: "Han's Artisan Bread",
                      totalBatchQty: 20, orderedQty: 14,
                      deliveryDate: makeDate(daysFromNow: 4), cutoffDate: makeDate(daysFromNow: 2),
                      priceFrom: 14.0, category: "Bread"),
        PreOrderBatch(id: UUID(), listingId: UUID(), name: "Summer Macaron Tower (6-tier)",
                      bakerName: "Emma Laurent", bakeryName: "Maison Laurent Pâtisserie",
                      totalBatchQty: 10, orderedQty: 6,
                      deliveryDate: makeDate(daysFromNow: 12), cutoffDate: makeDate(daysFromNow: 8),
                      priceFrom: 120.0, category: "Confectionery"),
        PreOrderBatch(id: UUID(), listingId: UUID(), name: "Lunar New Year Sweets Box",
                      bakerName: "Sophie Chen", bakeryName: "Golden Lotus Bakery",
                      totalBatchQty: 30, orderedQty: 22,
                      deliveryDate: makeDate(daysFromNow: 47), cutoffDate: makeDate(daysFromNow: 40),
                      priceFrom: 45.0, category: "Seasonal"),
        PreOrderBatch(id: UUID(), listingId: UUID(), name: "Summer Solstice Wagashi Box",
                      bakerName: "Yuki Tanaka", bakeryName: "Sakura Sweets",
                      totalBatchQty: 15, orderedQty: 9,
                      deliveryDate: makeDate(daysFromNow: 9), cutoffDate: makeDate(daysFromNow: 6),
                      priceFrom: 38.0, category: "Japanese"),
        PreOrderBatch(id: UUID(), listingId: UUID(), name: "July 1st Croissant Weekend Box",
                      bakerName: "Emma Laurent", bakeryName: "Maison Laurent Pâtisserie",
                      totalBatchQty: 50, orderedQty: 34,
                      deliveryDate: makeDate(daysFromNow: 19), cutoffDate: makeDate(daysFromNow: 14),
                      priceFrom: 22.0, category: "Viennoiserie"),
        PreOrderBatch(id: UUID(), listingId: UUID(), name: "Diwali Mithai Gift Box",
                      bakerName: "Priya Patel", bakeryName: "Patel's Sweet House",
                      totalBatchQty: 25, orderedQty: 18,
                      deliveryDate: makeDate(daysFromNow: 140), cutoffDate: makeDate(daysFromNow: 130),
                      priceFrom: 55.0, category: "Indian Sweets"),
        PreOrderBatch(id: UUID(), listingId: UUID(), name: "Portuguese Pastry Assortment Box",
                      bakerName: "Maria Santos", bakeryName: "Casa Santos",
                      totalBatchQty: 20, orderedQty: 12,
                      deliveryDate: makeDate(daysFromNow: 7), cutoffDate: makeDate(daysFromNow: 5),
                      priceFrom: 30.0, category: "Pastry"),
        PreOrderBatch(id: UUID(), listingId: UUID(), name: "Bofrot & Ghana Christmas Pack",
                      bakerName: "Amara Osei", bakeryName: "Accra Sweets",
                      totalBatchQty: 15, orderedQty: 11,
                      deliveryDate: makeDate(daysFromNow: 25), cutoffDate: makeDate(daysFromNow: 18),
                      priceFrom: 28.0, category: "West African"),
        PreOrderBatch(id: UUID(), listingId: UUID(), name: "Whole Grain Boule (fortnightly)",
                      bakerName: "Hannah Kim", bakeryName: "Han's Artisan Bread",
                      totalBatchQty: 12, orderedQty: 12,
                      deliveryDate: makeDate(daysFromNow: 10), cutoffDate: makeDate(daysFromNow: 7),
                      priceFrom: 15.0, category: "Bread"),
        PreOrderBatch(id: UUID(), listingId: UUID(), name: "Autumn Mochi Box (seasonal)",
                      bakerName: "Yuki Tanaka", bakeryName: "Sakura Sweets",
                      totalBatchQty: 20, orderedQty: 7,
                      deliveryDate: makeDate(daysFromNow: 35), cutoffDate: makeDate(daysFromNow: 28),
                      priceFrom: 32.0, category: "Japanese"),
    ]

    static let commissions: [CommissionOrder] = [
        CommissionOrder(id: UUID(), bakerName: "Julia Park", bakeryName: "Park's Custom Cakes",
                        buyerName: "Sarah Mitchell", productDescription: "3-tier wedding cake, blush & ivory fondant, floral sugar décor, June 2027",
                        stage: .quoteSent, priceQuoted: 580, dueDate: makeDate(daysFromNow: 365), createdAt: makeDate(daysFromNow: -10),
                        notes: "Tasting scheduled for Aug 15. Two flavour combos shortlisted."),
        CommissionOrder(id: UUID(), bakerName: "Emma Laurent", bakeryName: "Maison Laurent Pâtisserie",
                        buyerName: "Aisha Okonkwo", productDescription: "Baby shower macarons — 80pc, blush and sage palette, custom fondant toppers",
                        stage: .inProduction, priceQuoted: 160, dueDate: makeDate(daysFromNow: 5), createdAt: makeDate(daysFromNow: -18),
                        notes: "In production. Pickup Saturday 10am."),
        CommissionOrder(id: UUID(), bakerName: "Sophie Chen", bakeryName: "Golden Lotus Bakery",
                        buyerName: "Robert Chen", productDescription: "Corporate cookie boxes (x15), company logo iced, individually wrapped",
                        stage: .accepted, priceQuoted: 375, dueDate: makeDate(daysFromNow: 14), createdAt: makeDate(daysFromNow: -5),
                        notes: "Logo artwork received. Quote accepted. Production starts next week."),
        CommissionOrder(id: UUID(), bakerName: "Julia Park", bakeryName: "Park's Custom Cakes",
                        buyerName: "Emily Johnson", productDescription: "Graduation cake, 2-tier, university colours, mortar board topper",
                        stage: .delivered, priceQuoted: 220, dueDate: makeDate(daysFromNow: -14), createdAt: makeDate(daysFromNow: -40),
                        notes: "Delivered and photographed. 5-star review received."),
        CommissionOrder(id: UUID(), bakerName: "Julia Park", bakeryName: "Park's Custom Cakes",
                        buyerName: "David Kim", productDescription: "Engagement cake, 2-tier, marble fondant, sugar flower cluster",
                        stage: .inquiry, priceQuoted: nil, dueDate: makeDate(daysFromNow: 60), createdAt: makeDate(daysFromNow: -2),
                        notes: "Awaiting design brief and guest count."),
        CommissionOrder(id: UUID(), bakerName: "Priya Patel", bakeryName: "Patel's Sweet House",
                        buyerName: "Thomas Moore", productDescription: "Eid celebration mithai assortment box, 40pc, gift-wrapped, card included",
                        stage: .inProduction, priceQuoted: 95, dueDate: makeDate(daysFromNow: 8), createdAt: makeDate(daysFromNow: -12),
                        notes: "Flavour selection confirmed. Packaging ready."),
        CommissionOrder(id: UUID(), bakerName: "Hannah Kim", bakeryName: "Han's Artisan Bread",
                        buyerName: "Michael Thompson", productDescription: "Artisan sourdough starter kit: 2 loaves, starter jar, recipe booklet",
                        stage: .accepted, priceQuoted: 75, dueDate: makeDate(daysFromNow: 21), createdAt: makeDate(daysFromNow: -3),
                        notes: "Packaging and card design approved."),
        CommissionOrder(id: UUID(), bakerName: "Julia Park", bakeryName: "Park's Custom Cakes",
                        buyerName: "Isabella Garcia", productDescription: "Christening cake, classic white, cross motif, pale blue ribbon border",
                        stage: .quoteSent, priceQuoted: 185, dueDate: makeDate(daysFromNow: 45), createdAt: makeDate(daysFromNow: -7),
                        notes: "Quote sent $185. Awaiting acceptance."),
    ]

    // MARK: - Support Tickets

    static let tickets: [FeedbackTicket] = [
        makeTicket(id: "TICK0001", userId: "22222222-0000-0000-0000-000000000003",
                   email: "daniel.park@gmail.com", name: "Daniel Park",
                   category: "payment", message: "I was charged twice for my order of pastel de nata on June 10th. Order ID appears correct in my bank statement but I see two transactions of $15 CAD. Please refund the duplicate.",
                   status: "open", createdAt: "2026-06-10T14:23:00Z"),
        makeTicket(id: "TICK0002", userId: "22222222-0000-0000-0000-000000000001",
                   email: "james.wilson@gmail.com", name: "James Wilson",
                   category: "fulfillment", message: "The baker cancelled my pre-order batch 2 days before the scheduled pickup without any notice. I have guests coming and now I have nothing. This is very disappointing.",
                   status: "in_progress", createdAt: "2026-06-09T11:10:00Z"),
        makeTicket(id: "TICK0003", userId: "22222222-0000-0000-0000-000000000008",
                   email: "emily.j@gmail.com", name: "Emily Johnson",
                   category: "technical", message: "App crashes every time I try to view my order history. iPhone 15 Pro, iOS 17.5. Happens consistently after 3-4 taps.",
                   status: "escalated", createdAt: "2026-06-08T09:00:00Z"),
        makeTicket(id: "TICK0004", userId: "11111111-0000-0000-0000-000000000003",
                   email: "maria@casasantos.ca", name: "Maria Santos",
                   category: "listing", message: "My listing photos are not showing up for buyers even though they are uploaded and approved in my dashboard. This has been happening for 3 days.",
                   status: "open", createdAt: "2026-06-11T08:30:00Z"),
        makeTicket(id: "TICK0005", userId: "22222222-0000-0000-0000-000000000010",
                   email: "rachel.adams@gmail.com", name: "Rachel Adams",
                   category: "refund", message: "I received a commission cake that was completely different from what was agreed — wrong colours, wrong tier count. I would like a full refund of $220.",
                   status: "open", createdAt: "2026-06-12T07:45:00Z"),
        makeTicket(id: "TICK0006", userId: "11111111-0000-0000-0000-000000000006",
                   email: "hannah@hansartisan.ca", name: "Hannah Kim",
                   category: "account", message: "I cannot access my payout dashboard. It just shows a loading spinner. I have pending payouts that were supposed to clear 5 days ago.",
                   status: "in_progress", createdAt: "2026-06-07T13:00:00Z"),
        makeTicket(id: "TICK0007", userId: "22222222-0000-0000-0000-000000000005",
                   email: "r.chen@outlook.com", name: "Robert Chen",
                   category: "payment", message: "My credit card was declined at checkout but the order was still created as pending. I tried re-adding my card but it shows a conflict error.",
                   status: "resolved", createdAt: "2026-06-05T10:00:00Z"),
        makeTicket(id: "TICK0008", userId: "11111111-0000-0000-0000-000000000004",
                   email: "amara@accrasweets.ca", name: "Amara Osei",
                   category: "technical", message: "Push notifications for new orders stopped working last week. I almost missed 3 orders. Please check the notification settings on my account.",
                   status: "resolved", createdAt: "2026-06-03T09:20:00Z"),
        makeTicket(id: "TICK0009", userId: "22222222-0000-0000-0000-000000000006",
                   email: "lucia.fernandez@gmail.com", name: "Lucia Fernandez",
                   category: "fulfillment", message: "I placed a ready-now order and the baker is not responding to pickup confirmation messages. It has been 48 hours.",
                   status: "open", createdAt: "2026-06-12T06:00:00Z"),
        makeTicket(id: "TICK0010", userId: "11111111-0000-0000-0000-000000000007",
                   email: "yuki@sakurasweets.ca", name: "Yuki Tanaka",
                   category: "listing", message: "Can you please add 'dietary-restrictions' as a filterable tag category? Many of my customers have nut and gluten allergies. This is a priority feature.",
                   status: "archived", createdAt: "2026-05-28T14:00:00Z"),
        makeTicket(id: "TICK0011", userId: "22222222-0000-0000-0000-000000000012",
                   email: "isabella.garcia@hotmail.com", name: "Isabella Garcia",
                   category: "account", message: "I accidentally created two accounts with different emails. Can you merge them or delete the old one? Old email: iggarcia_old@hotmail.com",
                   status: "open", createdAt: "2026-06-11T16:00:00Z"),
        makeTicket(id: "TICK0012", userId: "11111111-0000-0000-0000-000000000002",
                   email: "sophie@goldenlotusbakery.ca", name: "Sophie Chen",
                   category: "payment", message: "My monthly payout is showing as $340 lower than my order total suggests. I cannot see any fee breakdown to reconcile this discrepancy.",
                   status: "in_progress", createdAt: "2026-06-10T11:30:00Z"),
    ]

    // MARK: - Daily metrics (30 days, realistic curve)

    static let dailyMetrics: [DailyMetric] = {
        var result: [DailyMetric] = []
        let now = Date()
        // Simulate realistic weekly rhythm: peaks Fri-Sat, troughs Mon-Tue
        let dayMultipliers = [0.6, 0.65, 0.75, 0.9, 1.3, 1.5, 1.1] // M-Su
        var growthFactor = 0.88
        for i in stride(from: 29, through: 0, by: -1) {
            let date = now.addingTimeInterval(-Double(i) * 86400)
            let cal = Calendar.current
            let weekday = cal.component(.weekday, from: date)  // 1=Sun, 7=Sat
            let mult = dayMultipliers[(weekday + 5) % 7]
            growthFactor += 0.004
            let baseGTV = 480.0 * growthFactor * mult * Double.random(in: 0.88...1.12)
            let orders  = max(3, Int(baseGTV / 38.0))
            result.append(DailyMetric(
                date: date,
                gtv: baseGTV,
                revenue: baseGTV * 0.05,
                orders: orders,
                newUsers: Int.random(in: 1...6),
                newBakers: Int.random(in: 0...2)
            ))
        }
        return result
    }()

    // MARK: - Dashboard stats (computed from mock data)

    static var stats: BakeriDashboardStats {
        var s = BakeriDashboardStats()
        s.totalBakers = bakerProfiles.count
        s.totalBuyers = buyerProfiles.count
        s.totalUsers  = s.totalBakers + s.totalBuyers
        s.activeListings    = readyNowListings.count
        s.readyNowListings  = readyNowListings.count
        s.preOrderListings  = preOrderBatches.count
        s.customListings    = commissions.count
        s.openTickets       = tickets.filter { $0.admin_status == nil || $0.admin_status == "open" }.count
        s.resolvedTickets   = tickets.filter { $0.admin_status == "resolved" || $0.admin_status == "archived" }.count
        s.pendingOrders     = commissions.filter { $0.stage == .inquiry || $0.stage == .quoteSent }.count
        let last30 = dailyMetrics
        s.gtv30d     = last30.map(\.gtv).reduce(0, +)
        s.revenue30d = last30.map(\.revenue).reduce(0, +)
        let totalOrders = last30.map(\.orders).reduce(0, +)
        s.aov = totalOrders > 0 ? s.gtv30d / Double(totalOrders) : 0
        let week = Array(last30.suffix(7))
        s.newUsersThisWeek = week.map(\.newUsers).reduce(0, +)
        s.newUsersToday    = last30.last?.newUsers ?? 0
        return s
    }

    // MARK: - Helpers

    private static func makeListing(id: String, userId: String, name: String, description: String,
                                    category: String, kind: String, price: Double, qty: Int,
                                    baker: String, bakery: String, location: String) -> MarketplaceListing {
        MarketplaceListing(
            id: UUID(uuidString: "AAAAAAAA-0000-0000-0000-\(id.padding(toLength: 12, withPad: "0", startingAt: 0))")!,
            user_id: UUID(uuidString: userId)!,
            name: name, item_description: description, category: category,
            default_price: price, is_active: true,
            listing_kind: kind, available_qty_today: qty,
            marketplace_price_from: price, lead_days: 0,
            is_listed_in_marketplace: true,
            created_at: "2026-01-01T00:00:00Z", updated_at: "2026-06-01T00:00:00Z",
            profiles: .init(user_name: baker, business_name: bakery, location: location)
        )
    }

    private static func makeTicket(id: String, userId: String, email: String, name: String,
                                   category: String, message: String, status: String, createdAt: String) -> FeedbackTicket {
        let hexNode = id.filter { "0123456789ABCDEFabcdef".contains($0) }
            .padding(toLength: 12, withPad: "0", startingAt: 0)
        let uuid = UUID(uuidString: "FFFFFFFF-0000-0000-0000-\(hexNode)") ?? UUID()
        return FeedbackTicket(id: uuid,
                       user_id: UUID(uuidString: userId),
                       category: category, message: message,
                       app_version: "3.4.1", os_version: "iOS 17.5",
                       created_at: createdAt, admin_status: status,
                       user_email: email, user_name: name)
    }

    private static func makeDate(daysFromNow: Int) -> Date {
        Date().addingTimeInterval(Double(daysFromNow) * 86400)
    }

    private static func iso(_ string: String) -> Date {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f.date(from: string) ?? ISO8601DateFormatter().date(from: string) ?? .distantPast
    }
}

// MARK: - Tiny seeded RNG for deterministic mock data

private struct SeededRNG {
    var state: UInt64
    init(seed: Int) { state = UInt64(bitPattern: Int64(seed &* 6364136223846793005 &+ 1442695040888963407)) }
    mutating func nextUInt64() -> UInt64 {
        state = state &* 6364136223846793005 &+ 1442695040888963407
        return state
    }
    mutating func next(_ lo: Double, _ hi: Double) -> Double {
        let r = Double(nextUInt64()) / Double(UInt64.max)
        return lo + r * (hi - lo)
    }
}
