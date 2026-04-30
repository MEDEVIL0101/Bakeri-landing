import Foundation
import SwiftData

// MARK: - IngredientDensity

@Model
final class IngredientDensity {
    var id: UUID
    var name: String
    /// Grams per 1 US cup
    var gramsPerCup: Double
    /// User-created vs. built-in seed data
    var isCustom: Bool

    init(
        id: UUID = UUID(),
        name: String,
        gramsPerCup: Double,
        isCustom: Bool = false
    ) {
        self.id = id
        self.name = name
        self.gramsPerCup = gramsPerCup
        self.isCustom = isCustom
    }

    // MARK: - Derived conversions

    var gramsPerTablespoon: Double { gramsPerCup / 16.0 }
    var gramsPerTeaspoon: Double   { gramsPerCup / 48.0 }
    var gramsPerMilliliter: Double { gramsPerCup / 236.588 }

    // MARK: - Seed Data

    static let seedData: [(name: String, gramsPerCup: Double)] = [
        // Flours
        ("All-Purpose Flour",        120),
        ("Bread Flour",              120),
        ("Cake Flour",               100),
        ("Whole Wheat Flour",        130),
        ("Almond Flour",              96),
        ("Rye Flour",                102),
        ("Oat Flour",                104),
        ("Cornstarch",               120),
        ("Cornmeal",                 138),
        // Leaveners
        ("Baking Powder",            230),
        ("Baking Soda",              230),
        // Sugars & Sweeteners
        ("Granulated Sugar",         200),
        ("Brown Sugar (packed)",     220),
        ("Powdered Sugar",           120),
        ("Coconut Sugar",            192),
        ("Honey",                    340),
        ("Maple Syrup",              320),
        ("Molasses",                 340),
        ("Agave Nectar",             336),
        // Fats & Oils
        ("Butter (melted)",          227),
        ("Butter (solid, packed)",   227),
        ("Vegetable Oil",            218),
        ("Olive Oil",                216),
        ("Coconut Oil",              218),
        ("Shortening",               205),
        // Dairy & Eggs
        ("Milk (whole)",             245),
        ("Buttermilk",               245),
        ("Heavy Cream",              238),
        ("Sour Cream",               230),
        ("Cream Cheese",             232),
        ("Yogurt (plain)",           245),
        // Chocolate & Cocoa
        ("Cocoa Powder",              85),
        ("Chocolate Chips",          170),
        ("Cacao Nibs",               128),
        // Oats & Grains
        ("Rolled Oats",               90),
        ("Quick Oats",                80),
        // Nuts, Seeds & Dried Fruit
        ("Shredded Coconut",          80),
        ("Chopped Walnuts",          117),
        ("Chopped Pecans",           109),
        ("Sliced Almonds",            92),
        ("Raisins",                  165),
        ("Dried Cranberries",        140),
        // Spices & Pantry
        ("Salt",                     273),
        ("Cinnamon (ground)",        125),
        ("Vanilla Extract",          208),
        // Liquids
        ("Water",                    237),
        ("Apple Juice",              250),
    ]
}
