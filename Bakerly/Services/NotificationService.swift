import Foundation
import UserNotifications

// MARK: - NotificationService

final class NotificationService {

    static let shared = NotificationService()
    private init() {}

    private let center = UNUserNotificationCenter.current()

    // MARK: - Permission

    func requestPermission() async -> Bool {
        do {
            return try await center.requestAuthorization(options: [.alert, .badge, .sound])
        } catch {
            return false
        }
    }

    var isAuthorized: Bool {
        get async {
            let settings = await center.notificationSettings()
            return settings.authorizationStatus == .authorized
        }
    }

    // MARK: - Order Notifications

    /// Schedule 24h and 2h reminders for an order due date.
    func scheduleOrderReminders(for order: Order) async {
        guard await isAuthorized else { return }

        let baseId = "order-\(order.id.uuidString)"
        await cancelNotifications(withPrefix: baseId)

        let customerName = order.customerName.isEmpty ? "a customer" : order.customerName

        // 24-hour reminder
        let minus24 = order.dueDate.addingTimeInterval(-86400)
        if minus24 > Date() {
            await schedule(
                id: "\(baseId)-24h",
                title: "📦 Order Due Tomorrow",
                body: "Order for \(customerName) is due tomorrow. Make sure everything is on track!",
                at: minus24
            )
        }

        // 2-hour reminder
        let minus2 = order.dueDate.addingTimeInterval(-7200)
        if minus2 > Date() {
            await schedule(
                id: "\(baseId)-2h",
                title: "⏰ Order Due in 2 Hours",
                body: "Order for \(customerName) is due in about 2 hours.",
                at: minus2
            )
        }
    }

    /// Cancel all notifications for a specific order.
    func cancelOrderReminders(for order: Order) async {
        await cancelNotifications(withPrefix: "order-\(order.id.uuidString)")
    }

    // MARK: - Baking Task Notifications

    /// Schedule a reminder for a baking task.
    func scheduleBakingTaskReminder(for task: BakingTask) async {
        guard await isAuthorized else { return }

        let taskId = "task-\(task.id.uuidString)"
        await cancelNotifications(withPrefix: taskId)

        let reminderDate = task.dueDate.addingTimeInterval(-3600) // 1h before
        guard reminderDate > Date() else { return }

        await schedule(
            id: taskId,
            title: "🥐 Baking Task Coming Up",
            body: "\"\(task.title)\" is due in 1 hour.",
            at: reminderDate
        )
    }

    func cancelBakingTaskReminder(for task: BakingTask) async {
        await cancelNotifications(withPrefix: "task-\(task.id.uuidString)")
    }

    // MARK: - Internal Helpers

    private func schedule(id: String, title: String, body: String, at date: Date) async {
        let content = UNMutableNotificationContent()
        content.title = title
        content.body  = body
        content.sound = .default
        content.categoryIdentifier = "BAKERLY"

        let comps = Calendar.current.dateComponents(
            [.year, .month, .day, .hour, .minute],
            from: date
        )
        let trigger = UNCalendarNotificationTrigger(dateMatching: comps, repeats: false)
        let request = UNNotificationRequest(identifier: id, content: content, trigger: trigger)

        do {
            try await center.add(request)
        } catch {
            print("[NotificationService] Failed to schedule \(id): \(error)")
        }
    }

    private func cancelNotifications(withPrefix prefix: String) async {
        let pending   = await center.pendingNotificationRequests()
        let delivered = await center.deliveredNotifications()

        let pendingIds   = pending.map(\.identifier).filter   { $0.hasPrefix(prefix) }
        let deliveredIds = delivered.map(\.request.identifier).filter { $0.hasPrefix(prefix) }

        center.removePendingNotificationRequests(withIdentifiers: pendingIds)
        center.removeDeliveredNotifications(withIdentifiers: deliveredIds)
    }

    func cancelAll() {
        center.removeAllPendingNotificationRequests()
        center.removeAllDeliveredNotifications()
    }
}
