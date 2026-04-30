import SwiftUI

// MARK: - Double Extensions

extension Double {
    /// Formats as currency using the device locale
    var asCurrency: String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .currency
        formatter.maximumFractionDigits = 2
        formatter.minimumFractionDigits = 2
        return formatter.string(from: NSNumber(value: self)) ?? "$\(String(format: "%.2f", self))"
    }

    /// Formats as a clean decimal removing unnecessary trailing zeros
    var cleanString: String {
        truncatingRemainder(dividingBy: 1) == 0
            ? String(Int(self))
            : String(format: "%.2g", self)
    }

    /// Formats with up to 2 decimal places, stripping trailing zeros
    var shortString: String {
        if self == 0 { return "0" }
        if truncatingRemainder(dividingBy: 1) == 0 { return String(Int(self)) }
        let s = String(format: "%.2f", self)
        return s.hasSuffix("0") ? String(s.dropLast()) : s
    }

    /// Rounds to a given number of decimal places
    func rounded(to places: Int) -> Double {
        let multiplier = pow(10.0, Double(places))
        return (self * multiplier).rounded() / multiplier
    }

    var isWhole: Bool { truncatingRemainder(dividingBy: 1) == 0 }
}

// MARK: - Date Extensions

extension Date {
    var isToday: Bool     { Calendar.current.isDateInToday(self) }
    var isTomorrow: Bool  { Calendar.current.isDateInTomorrow(self) }
    var isYesterday: Bool { Calendar.current.isDateInYesterday(self) }
    var isPast: Bool      { self < Date() }

    var startOfDay: Date {
        Calendar.current.startOfDay(for: self)
    }

    var endOfDay: Date {
        Calendar.current.date(byAdding: .second, value: 86399, to: startOfDay) ?? self
    }

    /// "Today", "Tomorrow", or formatted date
    var relativeDisplay: String {
        if isToday    { return "Today" }
        if isTomorrow { return "Tomorrow" }
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .none
        return formatter.string(from: self)
    }

    /// Short relative: "Today 3:00 PM", "Mar 15 at 2:00 PM"
    var relativeWithTime: String {
        let tf = DateFormatter()
        tf.timeStyle = .short
        let timeStr = tf.string(from: self)
        if isToday    { return "Today at \(timeStr)" }
        if isTomorrow { return "Tomorrow at \(timeStr)" }
        let df = DateFormatter()
        df.dateFormat = "MMM d"
        return "\(df.string(from: self)) at \(timeStr)"
    }

    /// Days until this date (negative = past)
    var daysFromNow: Int {
        Calendar.current.dateComponents([.day], from: Date().startOfDay, to: startOfDay).day ?? 0
    }

    /// "Mon", "Tue", etc.
    var shortWeekday: String {
        let formatter = DateFormatter()
        formatter.dateFormat = "EEE"
        return formatter.string(from: self)
    }

    /// Day number as String: "14"
    var dayNumber: String {
        let formatter = DateFormatter()
        formatter.dateFormat = "d"
        return formatter.string(from: self)
    }

    /// Month name abbreviated: "Jan"
    var shortMonth: String {
        let formatter = DateFormatter()
        formatter.dateFormat = "MMM"
        return formatter.string(from: self)
    }

    /// Start of the current month
    var startOfMonth: Date {
        Calendar.current.dateInterval(of: .month, for: self)?.start ?? self
    }

    /// End of the current month
    var endOfMonth: Date {
        Calendar.current.dateInterval(of: .month, for: self)?.end ?? self
    }
}

// MARK: - String Extensions

extension String {
    var trimmed: String { trimmingCharacters(in: .whitespacesAndNewlines) }
    var isNotEmpty: Bool { !isEmpty }
    var isBlank: Bool { trimmed.isEmpty }
}

// MARK: - View Extensions

extension View {
    /// Conditionally applies a modifier
    @ViewBuilder
    func `if`<Content: View>(_ condition: Bool, transform: (Self) -> Content) -> some View {
        if condition { transform(self) } else { self }
    }

    /// Haptic feedback helper
    func triggerHaptic(_ style: UIImpactFeedbackGenerator.FeedbackStyle = .light) {
        UIImpactFeedbackGenerator(style: style).impactOccurred()
    }

    /// Dismiss keyboard
    func hideKeyboard() {
        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
    }
}

// MARK: - Color Extensions (semantic helpers)

extension Color {
    static func adaptiveBakerly(light: Color, dark: Color) -> Color {
        Color(UIColor { traits in
            traits.userInterfaceStyle == .dark
                ? UIColor(dark)
                : UIColor(light)
        })
    }
}

// MARK: - Array Extensions

extension Array where Element: Identifiable {
    func uniqued() -> [Element] {
        var seen = Set<AnyHashable>()
        return filter { element in
            guard let id = element.id as? AnyHashable else { return true }
            return seen.insert(id).inserted
        }
    }
}

// MARK: - Binding Helpers

extension Binding where Value == String {
    func max(_ limit: Int) -> Binding<String> {
        Binding(
            get: { self.wrappedValue },
            set: { newValue in
                self.wrappedValue = String(newValue.prefix(limit))
            }
        )
    }
}
