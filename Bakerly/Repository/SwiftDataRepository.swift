import Foundation
import SwiftData

// MARK: - SwiftDataRepository
// Local-first implementation of BakerlyRepository backed by SwiftData.

final class SwiftDataRepository: BakerlyRepository {

    private let modelContext: ModelContext

    init(modelContext: ModelContext) {
        self.modelContext = modelContext
    }

    // MARK: - Recipes

    func saveRecipe(_ recipe: Recipe) throws {
        if recipe.modelContext == nil {
            modelContext.insert(recipe)
        }
        try modelContext.save()
    }

    func deleteRecipe(_ recipe: Recipe) throws {
        modelContext.delete(recipe)
        try modelContext.save()
    }

    func duplicateRecipe(_ recipe: Recipe) throws -> Recipe {
        let copy = Recipe(
            name: "\(recipe.name) (Copy)",
            yieldQuantity: recipe.yieldQuantity,
            yieldUnit: recipe.yieldUnit,
            prepTimeMinutes: recipe.prepTimeMinutes,
            bakeTimeMinutes: recipe.bakeTimeMinutes,
            instructions: recipe.instructions,
            notes: recipe.notes,
            imageData: recipe.imageData,
            tags: recipe.tags,
            isFavorite: false
        )
        for (idx, ingredient) in recipe.sortedIngredients.enumerated() {
            let copied = RecipeIngredient(
                name: ingredient.name,
                volumeAmount: ingredient.volumeAmount,
                volumeUnit: ingredient.volumeUnit,
                gramsPerCup: ingredient.gramsPerCup,
                notes: ingredient.notes,
                sortOrder: idx
            )
            copy.ingredients.append(copied)
        }
        modelContext.insert(copy)
        try modelContext.save()
        return copy
    }

    // MARK: - Ingredients

    func saveIngredient(_ ingredient: RecipeIngredient) throws {
        if ingredient.modelContext == nil {
            modelContext.insert(ingredient)
        }
        try modelContext.save()
    }

    func deleteIngredient(_ ingredient: RecipeIngredient) throws {
        modelContext.delete(ingredient)
        try modelContext.save()
    }

    // MARK: - Orders

    func saveOrder(_ order: Order) throws {
        if order.modelContext == nil {
            modelContext.insert(order)
        }
        try modelContext.save()
    }

    func deleteOrder(_ order: Order) throws {
        modelContext.delete(order)
        try modelContext.save()
    }

    // MARK: - Order Items

    func saveOrderItem(_ item: OrderItem) throws {
        if item.modelContext == nil {
            modelContext.insert(item)
        }
        try modelContext.save()
    }

    func deleteOrderItem(_ item: OrderItem) throws {
        modelContext.delete(item)
        try modelContext.save()
    }

    // MARK: - Baking Tasks

    func saveBakingTask(_ task: BakingTask) throws {
        if task.modelContext == nil {
            modelContext.insert(task)
        }
        try modelContext.save()
    }

    func deleteBakingTask(_ task: BakingTask) throws {
        modelContext.delete(task)
        try modelContext.save()
    }

    func fetchTasksDueToday() throws -> [BakingTask] {
        let calendar = Calendar.current
        let start = calendar.startOfDay(for: Date())
        let end   = calendar.date(byAdding: .day, value: 1, to: start)!
        let descriptor = FetchDescriptor<BakingTask>(
            predicate: #Predicate { $0.dueDate >= start && $0.dueDate < end && !$0.isCompleted },
            sortBy: [SortDescriptor(\.dueDate)]
        )
        return try modelContext.fetch(descriptor)
    }

    func fetchUpcomingTasks(days: Int) throws -> [BakingTask] {
        let calendar  = Calendar.current
        let startOfTomorrow = calendar.date(
            byAdding: .day, value: 1,
            to: calendar.startOfDay(for: Date())
        )!
        let endDate = calendar.date(
            byAdding: .day, value: days,
            to: calendar.startOfDay(for: Date())
        )!
        let descriptor = FetchDescriptor<BakingTask>(
            predicate: #Predicate { $0.dueDate >= startOfTomorrow && $0.dueDate < endDate && !$0.isCompleted },
            sortBy: [SortDescriptor(\.dueDate)]
        )
        return try modelContext.fetch(descriptor)
    }

    // MARK: - Ingredient Densities

    func saveIngredientDensity(_ density: IngredientDensity) throws {
        if density.modelContext == nil {
            modelContext.insert(density)
        }
        try modelContext.save()
    }

    func deleteIngredientDensity(_ density: IngredientDensity) throws {
        modelContext.delete(density)
        try modelContext.save()
    }

    func seedIngredientDensitiesIfNeeded() throws {
        var descriptor = FetchDescriptor<IngredientDensity>()
        descriptor.fetchLimit = 1
        let existing = try modelContext.fetch(descriptor)
        guard existing.isEmpty else { return }
        for seed in IngredientDensity.seedData {
            let density = IngredientDensity(name: seed.name, gramsPerCup: seed.gramsPerCup)
            modelContext.insert(density)
        }
        try modelContext.save()
    }

    // MARK: - Export / Import

    func exportAllData() throws -> Data {
        let recipes   = try modelContext.fetch(FetchDescriptor<Recipe>())
        let orders    = try modelContext.fetch(FetchDescriptor<Order>())
        let tasks     = try modelContext.fetch(FetchDescriptor<BakingTask>())
        let densities = try modelContext.fetch(FetchDescriptor<IngredientDensity>())

        let payload = BakerlyExportData(
            recipes: recipes.map(RecipeExport.init),
            orders:  orders.map(OrderExport.init),
            tasks:   tasks.map(TaskExport.init),
            customDensities: densities.filter(\.isCustom).map(DensityExport.init),
            exportDate: Date()
        )
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        return try encoder.encode(payload)
    }

    func importAllData(_ data: Data) throws {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let payload = try decoder.decode(BakerlyExportData.self, from: data)

        for re in payload.recipes {
            let recipe = Recipe(
                id: re.id,
                name: re.name,
                yieldQuantity: re.yieldQuantity,
                yieldUnit: YieldUnit(rawValue: re.yieldUnit) ?? .servings,
                prepTimeMinutes: re.prepTimeMinutes,
                bakeTimeMinutes: re.bakeTimeMinutes,
                instructions: re.instructions,
                notes: re.notes,
                tags: re.tags,
                isFavorite: re.isFavorite,
                createdAt: re.createdAt
            )
            for (idx, ing) in re.ingredients.enumerated() {
                recipe.ingredients.append(RecipeIngredient(
                    name: ing.name,
                    volumeAmount: ing.volumeAmount,
                    volumeUnit: VolumeUnit(rawValue: ing.volumeUnit) ?? .cup,
                    gramsPerCup: ing.gramsPerCup,
                    notes: ing.notes,
                    sortOrder: idx
                ))
            }
            modelContext.insert(recipe)
        }

        for de in payload.customDensities {
            modelContext.insert(IngredientDensity(name: de.name, gramsPerCup: de.gramsPerCup, isCustom: true))
        }

        try modelContext.save()
    }
}

// MARK: - Codable Transfer Objects

struct BakerlyExportData: Codable {
    let version: String
    let recipes: [RecipeExport]
    let orders: [OrderExport]
    let tasks: [TaskExport]
    let customDensities: [DensityExport]
    let exportDate: Date

    init(recipes: [RecipeExport], orders: [OrderExport], tasks: [TaskExport],
         customDensities: [DensityExport], exportDate: Date) {
        self.version        = "1.0"
        self.recipes        = recipes
        self.orders         = orders
        self.tasks          = tasks
        self.customDensities = customDensities
        self.exportDate     = exportDate
    }
}

struct RecipeExport: Codable {
    let id: UUID; let name: String; let yieldQuantity: Double; let yieldUnit: String
    let prepTimeMinutes: Int; let bakeTimeMinutes: Int
    let instructions: String; let notes: String
    let tags: [String]; let isFavorite: Bool; let createdAt: Date
    let ingredients: [IngredientExport]
    init(from r: Recipe) {
        id = r.id; name = r.name; yieldQuantity = r.yieldQuantity; yieldUnit = r.yieldUnitRaw
        prepTimeMinutes = r.prepTimeMinutes; bakeTimeMinutes = r.bakeTimeMinutes
        instructions = r.instructions; notes = r.notes
        tags = r.tags; isFavorite = r.isFavorite; createdAt = r.createdAt
        ingredients = r.ingredients.map(IngredientExport.init)
    }
}

struct IngredientExport: Codable {
    let name: String; let volumeAmount: Double; let volumeUnit: String
    let gramsPerCup: Double; let notes: String
    init(from i: RecipeIngredient) {
        name = i.name; volumeAmount = i.volumeAmount; volumeUnit = i.volumeUnitRaw
        gramsPerCup = i.gramsPerCup; notes = i.notes
    }
}

struct OrderExport: Codable {
    let id: UUID; let customerName: String; let customerPhone: String; let customerEmail: String
    let dueDate: Date; let status: String; let notes: String; let isPaid: Bool; let createdAt: Date
    let items: [OrderItemExport]
    init(from o: Order) {
        id = o.id; customerName = o.customerName; customerPhone = o.customerPhone
        customerEmail = o.customerEmail; dueDate = o.dueDate; status = o.statusRaw
        notes = o.notes; isPaid = o.isPaid; createdAt = o.createdAt
        items = o.orderItems.map(OrderItemExport.init)
    }
}

struct OrderItemExport: Codable {
    let customName: String; let quantity: Double; let unit: String
    let pricePerUnit: Double; let notes: String
    init(from i: OrderItem) {
        customName = i.customName; quantity = i.quantity; unit = i.unitRaw
        pricePerUnit = i.pricePerUnit; notes = i.notes
    }
}

struct TaskExport: Codable {
    let id: UUID; let title: String; let dueDate: Date
    let isCompleted: Bool; let notes: String; let createdAt: Date
    init(from t: BakingTask) {
        id = t.id; title = t.title; dueDate = t.dueDate
        isCompleted = t.isCompleted; notes = t.notes; createdAt = t.createdAt
    }
}

struct DensityExport: Codable {
    let name: String; let gramsPerCup: Double
    init(from d: IngredientDensity) { name = d.name; gramsPerCup = d.gramsPerCup }
}
