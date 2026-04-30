import Foundation

// MARK: - BakerlyRepository Protocol
//
// All data operations are routed through this protocol.
// Current backend: SwiftDataRepository (local device, SwiftData).
// Future backend:  SupabaseRepository — implement this protocol and
//                  swap it in BakerlyApp.swift without touching any View.

protocol BakerlyRepository: AnyObject {

    // MARK: Recipes
    func saveRecipe(_ recipe: Recipe) throws
    func deleteRecipe(_ recipe: Recipe) throws
    func duplicateRecipe(_ recipe: Recipe) throws -> Recipe

    // MARK: Ingredients
    func saveIngredient(_ ingredient: RecipeIngredient) throws
    func deleteIngredient(_ ingredient: RecipeIngredient) throws

    // MARK: Orders
    func saveOrder(_ order: Order) throws
    func deleteOrder(_ order: Order) throws

    // MARK: Order Items
    func saveOrderItem(_ item: OrderItem) throws
    func deleteOrderItem(_ item: OrderItem) throws

    // MARK: Baking Tasks
    func saveBakingTask(_ task: BakingTask) throws
    func deleteBakingTask(_ task: BakingTask) throws
    func fetchTasksDueToday() throws -> [BakingTask]
    func fetchUpcomingTasks(days: Int) throws -> [BakingTask]

    // MARK: Ingredient Densities
    func saveIngredientDensity(_ density: IngredientDensity) throws
    func deleteIngredientDensity(_ density: IngredientDensity) throws
    func seedIngredientDensitiesIfNeeded() throws

    // MARK: Data Management
    func exportAllData() throws -> Data
    func importAllData(_ data: Data) throws
}

// MARK: - Repository Errors

enum BakerlyRepositoryError: LocalizedError {
    case saveFailed(String)
    case deleteFailed(String)
    case fetchFailed(String)
    case importFailed(String)
    case exportFailed(String)
    case invalidData(String)

    var errorDescription: String? {
        switch self {
        case .saveFailed(let m):   return "Save failed: \(m)"
        case .deleteFailed(let m): return "Delete failed: \(m)"
        case .fetchFailed(let m):  return "Fetch failed: \(m)"
        case .importFailed(let m): return "Import failed: \(m)"
        case .exportFailed(let m): return "Export failed: \(m)"
        case .invalidData(let m):  return "Invalid data: \(m)"
        }
    }
}

// MARK: - Migration Note (for future Supabase swap)
//
// To migrate to Supabase:
// 1. Add the Supabase Swift SDK via Swift Package Manager.
// 2. Create `SupabaseRepository: BakerlyRepository` that calls Supabase APIs.
// 3. In BakerlyApp.swift, replace:
//      SwiftDataRepository(modelContext: context)
//    with:
//      SupabaseRepository(client: supabaseClient)
// 4. All Views remain unchanged — they only talk to BakerlyRepository.
