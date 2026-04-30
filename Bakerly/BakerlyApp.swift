import SwiftUI
import SwiftData
import UserNotifications

// MARK: - App Entry Point

@main
struct BakerlyApp: App {

    @State private var repository: SwiftDataRepository?

    // MARK: - Model Container
    // Register ALL @Model types here. Add new models to this list as the app grows.
    static let modelContainer: ModelContainer = {
        let schema = Schema([
            Recipe.self,
            RecipeIngredient.self,
            Order.self,
            OrderItem.self,
            BakingTask.self,
            IngredientDensity.self
        ])
        let config = ModelConfiguration(schema: schema, isStoredInMemoryOnly: false)
        do {
            return try ModelContainer(for: schema, configurations: [config])
        } catch {
            fatalError("Could not create ModelContainer: \(error)")
        }
    }()

    var body: some Scene {
        WindowGroup {
            ContentBootstrapper()
                .modelContainer(BakerlyApp.modelContainer)
                .task {
                    // Request notification permissions on first launch
                    _ = await NotificationService.shared.requestPermission()
                }
        }
    }
}

// MARK: - ContentBootstrapper
// Seeds data and injects the repository before showing the main UI.

struct ContentBootstrapper: View {
    @Environment(\.modelContext) private var modelContext
    @State private var isReady = false
    @State private var repository: SwiftDataRepository?

    var body: some View {
        Group {
            if isReady, let repo = repository {
                MainTabView()
                    .environment(repo as AnyObject)
                    .environmentObject(UserSettings.shared)
            } else {
                SplashView()
            }
        }
        .task {
            let repo = SwiftDataRepository(modelContext: modelContext)
            try? repo.seedIngredientDensitiesIfNeeded()
            repository = repo
            isReady = true
        }
    }
}

// MARK: - UserSettings (Observable, persisted via UserDefaults)

@Observable
final class UserSettings {
    static let shared = UserSettings()

    var unitSystem: UnitSystem {
        didSet { UserDefaults.standard.set(unitSystem.rawValue, forKey: "unitSystem") }
    }
    var notificationsEnabled: Bool {
        didSet { UserDefaults.standard.set(notificationsEnabled, forKey: "notificationsEnabled") }
    }
    var showWeightInRecipes: Bool {
        didSet { UserDefaults.standard.set(showWeightInRecipes, forKey: "showWeightInRecipes") }
    }

    private init() {
        let stored = UserDefaults.standard.string(forKey: "unitSystem") ?? "US"
        self.unitSystem            = UnitSystem(rawValue: stored) ?? .us
        self.notificationsEnabled  = UserDefaults.standard.bool(forKey: "notificationsEnabled")
        self.showWeightInRecipes   = UserDefaults.standard.object(forKey: "showWeightInRecipes") as? Bool ?? true
    }
}

// MARK: - Splash / Launch Screen

struct SplashView: View {
    var body: some View {
        ZStack {
            Color.bakerlyBeige.ignoresSafeArea()
            VStack(spacing: 16) {
                Image(systemName: "birthday.cake.fill")
                    .font(.system(size: 64))
                    .foregroundStyle(Color.bakerlyTerracotta)
                Text("Bakerly")
                    .font(BakerlyFont.display(40))
                    .foregroundStyle(Color.bakerlyDeepBrown)
            }
        }
    }
}
