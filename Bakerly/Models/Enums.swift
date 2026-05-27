import Foundation

// MARK: - Volume Units

enum VolumeUnit: String, Codable, CaseIterable, Identifiable {
    case cup          = "cup"
    case tablespoon   = "tbsp"
    case teaspoon     = "tsp"
    case fluidOunce   = "fl oz"
    case pint         = "pt"
    case quart        = "qt"
    case milliliter   = "ml"
    case liter        = "L"

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .cup:        return "Cup"
        case .tablespoon: return "Tablespoon"
        case .teaspoon:   return "Teaspoon"
        case .fluidOunce: return "Fluid Ounce"
        case .pint:       return "Pint"
        case .quart:      return "Quart"
        case .milliliter: return "Milliliter"
        case .liter:      return "Liter"
        }
    }

    var abbreviation: String { rawValue }

    /// Conversion factor to milliliters
    var toMilliliters: Double {
        switch self {
        case .cup:        return 236.588
        case .tablespoon: return 14.7868
        case .teaspoon:   return 4.92892
        case .fluidOunce: return 29.5735
        case .pint:       return 473.176
        case .quart:      return 946.353
        case .milliliter: return 1.0
        case .liter:      return 1000.0
        }
    }

    var isMetric: Bool {
        self == .milliliter || self == .liter
    }

    static var usUnits: [VolumeUnit]     { [.cup, .tablespoon, .teaspoon, .fluidOunce, .pint, .quart] }
    static var metricUnits: [VolumeUnit] { [.milliliter, .liter] }
}

// MARK: - Weight Units

enum WeightUnit: String, Codable, CaseIterable, Identifiable {
    case gram      = "g"
    case kilogram  = "kg"
    case ounce     = "oz"
    case pound     = "lb"

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .gram:     return "Gram"
        case .kilogram: return "Kilogram"
        case .ounce:    return "Ounce"
        case .pound:    return "Pound"
        }
    }

    var abbreviation: String { rawValue }

    /// Conversion factor to grams
    var toGrams: Double {
        switch self {
        case .gram:     return 1.0
        case .kilogram: return 1000.0
        case .ounce:    return 28.3495
        case .pound:    return 453.592
        }
    }

    var isMetric: Bool {
        self == .gram || self == .kilogram
    }
}

// MARK: - Unit System

enum UnitSystem: String, Codable, CaseIterable, Identifiable {
    case us     = "US"
    case metric = "Metric"

    var id: String { rawValue }

    var preferredVolumeUnits: [VolumeUnit] {
        switch self {
        case .us:     return VolumeUnit.usUnits
        case .metric: return VolumeUnit.metricUnits
        }
    }

    var preferredWeightUnit: WeightUnit {
        switch self {
        case .us:     return .ounce
        case .metric: return .gram
        }
    }

    var defaultVolumeUnit: VolumeUnit {
        switch self {
        case .us:     return .cup
        case .metric: return .milliliter
        }
    }
}

// MARK: - Order Status

enum OrderStatus: String, Codable, CaseIterable, Identifiable {
    case new       = "New"
    case confirmed = "Confirmed"
    case baking    = "Baking"
    case ready     = "Ready"
    case delivered = "Delivered"
    case cancelled = "Cancelled"

    var id: String { rawValue }

    var sfSymbol: String {
        switch self {
        case .new:       return "sparkles"
        case .confirmed: return "checkmark.circle"
        case .baking:    return "oven.fill"
        case .ready:     return "bag.fill"
        case .delivered: return "checkmark.seal.fill"
        case .cancelled: return "xmark.circle.fill"
        }
    }

    /// Next logical status in the order workflow
    var next: OrderStatus? {
        switch self {
        case .new:       return .confirmed
        case .confirmed: return .baking
        case .baking:    return .ready
        case .ready:     return .delivered
        case .delivered, .cancelled: return nil
        }
    }

    var isActive: Bool {
        switch self {
        case .delivered, .cancelled: return false
        default: return true
        }
    }
}

// MARK: - Yield Unit

enum YieldUnit: String, Codable, CaseIterable, Identifiable {
    case servings  = "servings"
    case loaves    = "loaves"
    case cookies   = "cookies"
    case muffins   = "muffins"
    case cakes     = "cakes"
    case rolls     = "rolls"
    case bars      = "bars"
    case dozen     = "dozen"
    case pieces    = "pieces"
    case cupcakes  = "cupcakes"
    case grams     = "g"
    case kilograms = "kg"
    case ounces    = "oz"
    case pounds    = "lb"

    var id: String       { rawValue }
    var displayName: String { rawValue }
}
