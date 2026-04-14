# Bakerly 🥐
A production-ready SwiftUI + SwiftData app for home bakers who run a small bakery business.

---

## Quick Start in Xcode

1. **Open Xcode** → File → New → Project
2. Choose **iOS → App**
3. Fill in:
   - Product Name: `Bakerly`
   - Team: your Apple developer team
   - Organization Identifier: `com.yourname`
   - Interface: **SwiftUI**
   - Language: **Swift**
   - Storage: **SwiftData** ✓ (check this)
4. Save the project **into this folder**: `/Users/newuser/Desktop/Dianas app/Bakerly/`
5. **Delete** the auto-generated `ContentView.swift` and `Item.swift` that Xcode creates.
6. In Finder, drag **all files and folders** from `Bakerly/Bakerly/` into your Xcode project navigator (the `Bakerly` group). When prompted: ✓ "Copy items if needed", ✓ "Create groups".
7. Drag `logo.png` and `icon.jpg` into `Assets.xcassets` in Xcode.
8. Set **minimum deployment target** to iOS 17.0 in project settings.
9. Press **⌘R** to run!

---

## Project Structure

```
Bakerly/
├── BakerlyApp.swift          # App entry point, ModelContainer setup
├── Models/
│   ├── Enums.swift            # VolumeUnit, WeightUnit, OrderStatus, etc.
│   ├── Recipe.swift           # Recipe + RecipeIngredient @Model
│   ├── Order.swift            # Order + OrderItem @Model
│   ├── BakingTask.swift       # BakingTask @Model
│   └── IngredientDensity.swift # Density DB + seed data
├── Repository/
│   ├── BakerlyRepository.swift  # Protocol (swap for Supabase later)
│   └── SwiftDataRepository.swift # Local SwiftData implementation
├── Services/
│   └── NotificationService.swift # Local notifications (UNUserNotificationCenter)
├── Theme/
│   └── BakerlyTheme.swift     # Color palette, typography, modifiers
├── Utils/
│   ├── UnitConverter.swift    # Volume ↔ weight conversion math
│   └── Extensions.swift       # Double, Date, String, View helpers
└── Views/
    ├── MainTabView.swift
    ├── Common/
    │   ├── SplashView.swift       # Animated launch screen
    │   └── EmptyStateView.swift   # Reusable empty states
    ├── Recipes/
    │   ├── RecipesView.swift      # Grid + list, search, tag filter
    │   ├── RecipeDetailView.swift # Full detail, scale button
    │   └── AddEditRecipeView.swift # Full form with photo picker
    ├── Calculator/
    │   ├── CalculatorView.swift        # Tab container (mode switcher)
    │   ├── QuickConverterView.swift    # Volume ↔ weight with density DB
    │   └── FullRecipeCalculatorView.swift # Scaling table with totals
    ├── Orders/
    │   ├── OrdersView.swift       # CRM list + dashboard stats
    │   ├── OrderDetailView.swift  # Status workflow, items, payment
    │   └── AddEditOrderView.swift # Full order form
    ├── Schedule/
    │   ├── ScheduleView.swift     # Date strip + today/upcoming
    │   └── AddBakingTaskView.swift # Task form with recipe/order links
    └── Settings/
        └── SettingsView.swift     # Units, notifications, export/import
```

---

## Key Features

| Tab | What it does |
|-----|-------------|
| 📅 **Schedule** | Horizontal date strip, today's orders + tasks, upcoming 7-day view |
| 📦 **Orders** | CRM-style order list, dashboard revenue stats, status workflow pills |
| 📖 **Recipes** | 2/3-column grid, photo, tags, swipe to favorite/delete, scale button |
| 🧪 **Calculator** | Quick Volume↔Weight converter + full recipe scaler with real-time table |

### Settings
- US / Metric unit system toggle (persisted in UserDefaults)
- Notification permission request + order/task reminders
- Custom ingredient density database
- Export all data as JSON backup
- Import from JSON backup
- Supabase migration pathway explained

---

## Architecture: Repository Pattern

All data writes go through `BakerlyRepository` protocol:

```swift
protocol BakerlyRepository: AnyObject {
    func saveRecipe(_ recipe: Recipe) throws
    func deleteRecipe(_ recipe: Recipe) throws
    // ... orders, tasks, densities, export/import
}
```

**Current backend**: `SwiftDataRepository` — wraps `ModelContext`, stores everything on-device.

**Future backend**: `SupabaseRepository` — implement the same protocol with Supabase Swift SDK calls.

### Swapping to Supabase

1. Add Supabase Swift SDK via **File → Add Package Dependencies**:
   - URL: `https://github.com/supabase/supabase-swift`
2. Create `SupabaseRepository.swift`:
   ```swift
   import Supabase

   final class SupabaseRepository: BakerlyRepository {
       private let client: SupabaseClient

       init(client: SupabaseClient) {
           self.client = client
       }

       func saveRecipe(_ recipe: Recipe) async throws {
           try await client.from("recipes").upsert(RecipeExport(from: recipe)).execute()
       }
       // implement all other methods...
   }
   ```
3. In `BakerlyApp.swift`, change one line:
   ```swift
   // Before:
   let repo = SwiftDataRepository(modelContext: modelContext)

   // After:
   let repo = SupabaseRepository(client: SupabaseClient(supabaseURL: url, supabaseKey: key))
   ```
4. All Views remain **completely unchanged** — they only talk to `BakerlyRepository`.

---

## Data Models

| Model | Key Fields |
|-------|-----------|
| `Recipe` | name, yield, times, instructions, notes, imageData, tags, isFavorite |
| `RecipeIngredient` | name, volumeAmount, volumeUnit, gramsPerCup (density), sortOrder |
| `Order` | customerName/phone/email, dueDate, status, items, isPaid |
| `OrderItem` | customName, recipe?, quantity, unit, pricePerUnit |
| `BakingTask` | title, dueDate, isCompleted, recipe?, order? |
| `IngredientDensity` | name, gramsPerCup, isCustom |

---

## Color Palette

Derived from the official `BakerlyColorPalette.png`:

| Token | Hex | Use |
|-------|-----|-----|
| `bakerlyBeige` | `#F0E2CD` | Background warm tint |
| `bakerlyTerracotta` | `#B8602D` | Primary brand color |
| `bakerlyOrange` | `#EF7E3D` | Accent, highlights |
| `bakerlyGold` | `#E5BB74` | Notes, ratings |
| `bakerlyBlue` | `#3D6DB7` | Confirmed status, paid |
| `bakerlyRed` | `#D06767` | Cancelled, overdue |
| `bakerlyDeepBrown` | `#352021` | Headings |

---

## Requirements

- Xcode 15+
- iOS 17.0+
- No third-party dependencies (pure SwiftUI + SwiftData)

---

*Built with Claude Code — Bakerly v1.0*
