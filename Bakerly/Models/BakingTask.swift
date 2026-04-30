import Foundation
import SwiftData

// MARK: - BakingTask

@Model
final class BakingTask {
    var id: UUID
    var title: String
    var dueDate: Date
    var isCompleted: Bool
    var notes: String
    var createdAt: Date

    var order: Order?
    var recipe: Recipe?

    init(
        id: UUID = UUID(),
        title: String,
        dueDate: Date = Date(),
        isCompleted: Bool = false,
        notes: String = "",
        createdAt: Date = Date()
    ) {
        self.id = id
        self.title = title
        self.dueDate = dueDate
        self.isCompleted = isCompleted
        self.notes = notes
        self.createdAt = createdAt
    }

    // MARK: - Computed Properties

    var isDueToday: Bool {
        Calendar.current.isDateInToday(dueDate)
    }

    var isOverdue: Bool {
        dueDate < Date() && !isCompleted
    }

    var displayTitle: String {
        if let orderName = order?.customerName {
            return "\(title) — \(orderName)"
        }
        return title
    }

    var urgencyLevel: UrgencyLevel {
        if isCompleted { return .done }
        if isOverdue   { return .overdue }
        if isDueToday  { return .today }
        return .upcoming
    }

    enum UrgencyLevel {
        case done, overdue, today, upcoming
    }
}
