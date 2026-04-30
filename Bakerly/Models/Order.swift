import Foundation
import SwiftData

// MARK: - Order

@Model
final class Order {
    var id: UUID
    var customerName: String
    var customerPhone: String
    var customerEmail: String
    var dueDate: Date
    var statusRaw: String
    var notes: String
    var isPaid: Bool
    var paymentNote: String
    var createdAt: Date

    @Relationship(deleteRule: .cascade)
    var orderItems: [OrderItem]

    @Relationship(deleteRule: .nullify)
    var bakingTasks: [BakingTask]

    init(
        id: UUID = UUID(),
        customerName: String,
        customerPhone: String = "",
        customerEmail: String = "",
        dueDate: Date = Calendar.current.date(byAdding: .day, value: 3, to: Date()) ?? Date(),
        status: OrderStatus = .new,
        notes: String = "",
        isPaid: Bool = false,
        paymentNote: String = "",
        createdAt: Date = Date()
    ) {
        self.id = id
        self.customerName = customerName
        self.customerPhone = customerPhone
        self.customerEmail = customerEmail
        self.dueDate = dueDate
        self.statusRaw = status.rawValue
        self.notes = notes
        self.isPaid = isPaid
        self.paymentNote = paymentNote
        self.createdAt = createdAt
        self.orderItems = []
        self.bakingTasks = []
    }

    // MARK: - Computed Properties

    var status: OrderStatus {
        get { OrderStatus(rawValue: statusRaw) ?? .new }
        set { statusRaw = newValue.rawValue }
    }

    var totalPrice: Double {
        orderItems.reduce(0) { $0 + ($1.pricePerUnit * $1.quantity) }
    }

    var formattedTotal: String {
        totalPrice.asCurrency
    }

    var isOverdue: Bool {
        dueDate < Date() && status.isActive
    }

    var isDueToday: Bool {
        Calendar.current.isDateInToday(dueDate)
    }

    var isDueSoon: Bool {
        let soon = Date().addingTimeInterval(86400 * 2)
        return dueDate <= soon && status.isActive
    }

    var itemSummary: String {
        guard !orderItems.isEmpty else { return "No items" }
        return orderItems.map { $0.displayName }.joined(separator: ", ")
    }

    var sortedItems: [OrderItem] {
        orderItems.sorted { $0.displayName < $1.displayName }
    }
}

// MARK: - OrderItem

@Model
final class OrderItem {
    var id: UUID
    var customName: String
    var quantity: Double
    var unitRaw: String
    var pricePerUnit: Double
    var notes: String
    var order: Order?
    var recipe: Recipe?

    init(
        id: UUID = UUID(),
        customName: String = "",
        quantity: Double = 1,
        unit: YieldUnit = .pieces,
        pricePerUnit: Double = 0,
        notes: String = ""
    ) {
        self.id = id
        self.customName = customName
        self.quantity = quantity
        self.unitRaw = unit.rawValue
        self.pricePerUnit = pricePerUnit
        self.notes = notes
    }

    // MARK: - Computed Properties

    var unit: YieldUnit {
        get { YieldUnit(rawValue: unitRaw) ?? .pieces }
        set { unitRaw = newValue.rawValue }
    }

    var lineTotal: Double { pricePerUnit * quantity }

    var displayName: String {
        if !customName.isEmpty { return customName }
        return recipe?.name ?? "Custom Item"
    }

    var formattedLineTotal: String { lineTotal.asCurrency }
}
