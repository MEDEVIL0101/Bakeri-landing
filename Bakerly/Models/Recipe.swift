import Foundation
import SwiftData

// MARK: - Recipe

@Model
final class Recipe {
    var id: UUID
    var name: String
    var yieldQuantity: Double
    var yieldUnitRaw: String
    var prepTimeMinutes: Int
    var bakeTimeMinutes: Int
    var instructions: String
    var notes: String
    @Attribute(.externalStorage)
    var imageData: Data?
    var tags: [String]
    var isFavorite: Bool
    var createdAt: Date

    @Relationship(deleteRule: .cascade)
    var ingredients: [RecipeIngredient]

    init(
        id: UUID = UUID(),
        name: String,
        yieldQuantity: Double = 1,
        yieldUnit: YieldUnit = .servings,
        prepTimeMinutes: Int = 0,
        bakeTimeMinutes: Int = 0,
        instructions: String = "",
        notes: String = "",
        imageData: Data? = nil,
        tags: [String] = [],
        isFavorite: Bool = false,
        createdAt: Date = Date()
    ) {
        self.id = id
        self.name = name
        self.yieldQuantity = yieldQuantity
        self.yieldUnitRaw = yieldUnit.rawValue
        self.prepTimeMinutes = prepTimeMinutes
        self.bakeTimeMinutes = bakeTimeMinutes
        self.instructions = instructions
        self.notes = notes
        self.imageData = imageData
        self.tags = tags
        self.isFavorite = isFavorite
        self.createdAt = createdAt
        self.ingredients = []
    }

    // MARK: - Computed Properties

    var yieldUnit: YieldUnit {
        get { YieldUnit(rawValue: yieldUnitRaw) ?? .servings }
        set { yieldUnitRaw = newValue.rawValue }
    }

    var totalTimeMinutes: Int { prepTimeMinutes + bakeTimeMinutes }

    var formattedPrepTime: String  { formatMinutes(prepTimeMinutes) }
    var formattedBakeTime: String  { formatMinutes(bakeTimeMinutes) }
    var formattedTotalTime: String { formatMinutes(totalTimeMinutes) }

    var yieldDescription: String {
        let qty = yieldQuantity.truncatingRemainder(dividingBy: 1) == 0
            ? String(Int(yieldQuantity))
            : String(format: "%.1f", yieldQuantity)
        return "\(qty) \(yieldUnitRaw)"
    }

    var sortedIngredients: [RecipeIngredient] {
        ingredients.sorted { $0.sortOrder < $1.sortOrder }
    }

    // MARK: - Helpers

    private func formatMinutes(_ minutes: Int) -> String {
        guard minutes > 0 else { return "—" }
        if minutes < 60 { return "\(minutes) min" }
        let h = minutes / 60
        let m = minutes % 60
        return m == 0 ? "\(h) hr" : "\(h) hr \(m) min"
    }
}

// MARK: - RecipeIngredient

@Model
final class RecipeIngredient {
    var id: UUID
    var name: String
    var volumeAmount: Double
    var volumeUnitRaw: String
    /// Grams per 1 cup — serves as density factor for weight conversion
    var gramsPerCup: Double
    var notes: String
    var sortOrder: Int
    var recipe: Recipe?

    init(
        id: UUID = UUID(),
        name: String,
        volumeAmount: Double = 1,
        volumeUnit: VolumeUnit = .cup,
        gramsPerCup: Double = 120,
        notes: String = "",
        sortOrder: Int = 0
    ) {
        self.id = id
        self.name = name
        self.volumeAmount = volumeAmount
        self.volumeUnitRaw = volumeUnit.rawValue
        self.gramsPerCup = gramsPerCup
        self.notes = notes
        self.sortOrder = sortOrder
    }

    // MARK: - Computed Properties

    var volumeUnit: VolumeUnit {
        get { VolumeUnit(rawValue: volumeUnitRaw) ?? .cup }
        set { volumeUnitRaw = newValue.rawValue }
    }

    /// Weight in grams for the stored volume amount
    var weightInGrams: Double {
        let cups = (volumeAmount * volumeUnit.toMilliliters) / VolumeUnit.cup.toMilliliters
        return cups * gramsPerCup
    }

    func scaledVolumeAmount(by factor: Double) -> Double {
        volumeAmount * factor
    }

    func scaledWeightInGrams(by factor: Double) -> Double {
        weightInGrams * factor
    }

    /// Formatted volume string: "2¼ cups", "1 tbsp", etc.
    func formattedVolume(amount: Double? = nil) -> String {
        let amt = amount ?? volumeAmount
        let formatted = amt.truncatingRemainder(dividingBy: 1) == 0
            ? String(Int(amt))
            : String(format: "%.2g", amt)
        return "\(formatted) \(volumeUnit.abbreviation)"
    }
}
