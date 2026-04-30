import Foundation

// MARK: - UnitConverter
// Centralized conversion logic for baking units (volume ↔ weight, cross-unit).

enum UnitConverter {

    // MARK: - Volume → Weight

    /// Convert a volume measurement to grams using the ingredient's density (gramsPerCup).
    static func toGrams(amount: Double, unit: VolumeUnit, gramsPerCup: Double) -> Double {
        let cups = toCups(amount: amount, from: unit)
        return cups * gramsPerCup
    }

    /// Convert grams to a volume using the ingredient's density.
    static func fromGrams(_ grams: Double, toUnit unit: VolumeUnit, gramsPerCup: Double) -> Double {
        guard gramsPerCup > 0 else { return 0 }
        let cups = grams / gramsPerCup
        return fromCups(cups: cups, to: unit)
    }

    // MARK: - Volume → Volume

    /// Convert any volume to cups (the internal reference unit).
    static func toCups(amount: Double, from unit: VolumeUnit) -> Double {
        let ml = amount * unit.toMilliliters
        return ml / VolumeUnit.cup.toMilliliters
    }

    /// Convert cups (internal) to any other volume unit.
    static func fromCups(cups: Double, to unit: VolumeUnit) -> Double {
        let ml = cups * VolumeUnit.cup.toMilliliters
        return ml / unit.toMilliliters
    }

    /// Convert between two volume units.
    static func convertVolume(amount: Double, from: VolumeUnit, to: VolumeUnit) -> Double {
        guard from != to else { return amount }
        let ml = amount * from.toMilliliters
        return ml / to.toMilliliters
    }

    // MARK: - Weight → Weight

    /// Convert between two weight units.
    static func convertWeight(amount: Double, from: WeightUnit, to: WeightUnit) -> Double {
        guard from != to else { return amount }
        let grams = amount * from.toGrams
        return grams / to.toGrams
    }

    // MARK: - Formatting

    /// Returns a clean, human-readable volume string.
    /// e.g. 0.5 cups → "½ cup", 1.25 tbsp → "1¼ tbsp"
    static func formatVolume(_ amount: Double, unit: VolumeUnit) -> String {
        let fraction = nearestFraction(amount)
        let unit = amount == 1 ? unit.abbreviation : unit.abbreviation
        return "\(fraction) \(unit)"
    }

    /// Returns a clean weight string with appropriate unit.
    static func formatWeight(_ grams: Double, preferredUnit: WeightUnit) -> String {
        let converted = grams / preferredUnit.toGrams
        if converted < 0.01 { return "< 0.01 \(preferredUnit.abbreviation)" }
        return "\(converted.shortString) \(preferredUnit.abbreviation)"
    }

    // MARK: - Fraction Helpers

    /// Rounds to nearest common baking fraction and returns a display string.
    static func nearestFraction(_ value: Double) -> String {
        let fractions: [(Double, String)] = [
            (0.125, "⅛"), (0.25, "¼"), (0.333, "⅓"),
            (0.375, "⅜"), (0.5, "½"), (0.625, "⅝"),
            (0.667, "⅔"), (0.75, "¾"), (0.875, "⅞")
        ]

        let whole = Int(value)
        let remainder = value - Double(whole)

        if remainder < 0.0625 {
            return whole == 0 ? "0" : "\(whole)"
        }

        if let (_, symbol) = fractions.min(by: { abs($0.0 - remainder) < abs($1.0 - remainder) }) {
            return whole == 0 ? symbol : "\(whole)\(symbol)"
        }

        return value.shortString
    }

    // MARK: - Scaling

    /// Calculate a scaling factor from original yield to desired yield.
    static func scalingFactor(originalYield: Double, desiredYield: Double) -> Double {
        guard originalYield > 0 else { return 1 }
        return desiredYield / originalYield
    }
}

// MARK: - Baking Measurement Helpers

extension UnitConverter {

    /// Returns the best volume unit to display for a given milliliter amount.
    static func bestVolumeUnit(forMilliliters ml: Double, system: UnitSystem) -> VolumeUnit {
        switch system {
        case .metric:
            return ml >= 100 ? .liter : .milliliter
        case .us:
            if ml < VolumeUnit.teaspoon.toMilliliters * 0.5 { return .teaspoon }
            if ml < VolumeUnit.tablespoon.toMilliliters      { return .teaspoon }
            if ml < VolumeUnit.cup.toMilliliters * 0.25      { return .tablespoon }
            if ml < VolumeUnit.cup.toMilliliters * 4          { return .cup }
            return .cup
        }
    }

    /// Returns the best weight unit to display for a given gram amount.
    static func bestWeightUnit(forGrams grams: Double, system: UnitSystem) -> WeightUnit {
        switch system {
        case .metric:  return grams >= 1000 ? .kilogram : .gram
        case .us:      return grams >= 453 ? .pound : .ounce
        }
    }
}
