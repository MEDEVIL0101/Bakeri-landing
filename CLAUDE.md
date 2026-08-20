# Bakeri — CLAUDE.md

## Project Overview
Bakeri is an iOS SwiftUI + SwiftData app for home bakers running a small bakery business.
Owner: Diana. This is a separate project from Tradehire — do not mix contexts.

## Key Paths
- iOS source: `/Users/newuser/Desktop/dianas app/bakerly/Bakerly/Bakerly/Bakeri/`
- Xcode project: `/Users/newuser/Desktop/dianas app/bakerly/Bakerly/Bakerly/Bakerly.xcodeproj`
- Supabase migrations (SQL files): `/Users/newuser/Desktop/dianas app/bakerly/`
- Supabase project ref: `aqhebjxaynvtvurwedrl`

## Architecture
- `BakeriApp.swift` — app entry, SwiftData `ModelContainer` setup, auth deep-link handling
- `ContentBootstrapper` — seeds data, restores session, routes to Auth/Onboarding/MainTabView
- `UserSettings.shared` — `ObservableObject` for user name, bakery name, theme, units; passed as `@EnvironmentObject`
- `AuthService.shared` — Supabase auth state; `isSignedIn`, `session`, `needsPasswordReset`
- `SupabaseManager.shared` — single `SupabaseClient`; reads from `BakeriSecrets`
- `ProfileService.shared` — fetch/save remote profile (name, bakery, onboarding flag)
- `SyncService.shared` — full data sync (recipes, orders, tasks, menu items) from Supabase
- `StoreKitManager` — subscription status; social features always free, baker tools gated in-app via StoreKit
- `TimerStore.shared` — baking timers
- `RecipeAIService` — Claude API integration for AI recipe suggestions
- `NotificationService.shared` — local push notifications
- `SwiftDataRepository` — implements `BakeriRepository` protocol using local SwiftData

## SwiftData Models
`Recipe`, `RecipeIngredient`, `Order`, `OrderItem`, `BakingTask`, `IngredientDensity`, `MenuItem`, `IngredientCost`
All registered in `BakeriApp.modelContainer`. Adding a new model requires adding it to the `Schema([...])` array.

## Navigation
`MainTabView.swift` — ZStack switching between social tabs (Discover, Bakers, Activity) and tools tabs (Schedule, Orders, Recipes, Calculator).
- `AppNavigationStore.shared.toolsActive` drives the switch; premium gate fires `onChange` and shows PaywallView if not subscribed
- Social tabs own their avatar toolbar button — MainTabView does NOT add external toolbar items for them
- Baker tools accessible via the avatar icon → AccountSwitcherView → "Open Baker Tools"
Auth flow: `AuthView` → email/password or magic link → `bakeri://login-callback` deep link → `ContentBootstrapper`
Password reset: `bakeri://reset-password` deep link → `AuthService.shared.needsPasswordReset = true`
Onboarding: two-path — "Set up my bakery" (full name+bakery) or "Continue as guest" (display name only)

## Theme & Colors
All colors defined in `Theme/BakeriTheme.swift` as `Color` extensions — never use raw hex in views.
Primary colors (theme-aware, vary by `AppTheme`):
- `Color.bakeriTerracotta` — primary brand/CTA (terracotta)
- `Color.bakeriOrange` — accent
- `Color.bakeriGold` — notes/ratings
- `Color.bakeriBeige` — background
Static colors:
- `Color.bakeriDeepBrown` (#352021) — headings
- `Color.bakeriBlue` (#5F92E6) — confirmed status, paid
- `Color.bakeriRed` (#D06767) — cancelled, overdue, alerts
- `Color.bakeriGreen` (#4CAF82) — paid in full

Themes: `.classic`, `.patisserie`, `.luxe` (Dark Luxe), `.modern`
Background patterns: `.standard`, `.polkaDot`, `.stripes`, `.gingham`

Typography: `BakeriFont.display()`, `.heading()`, `.subheading()`, `.body()`, `.caption()`, `.mono()`
View modifiers: `.bakeriCard()`, `.bakeriPrimaryButton()`, `.bakeriSecondaryButton()`

## Secrets
`Config/Secrets.swift` — gitignored. Contains:
```swift
enum BakeriSecrets {
    static let supabaseURL     = "..."
    static let supabaseAnonKey = "..."
}
```
Never commit this file. A `.swift.template` equivalent should exist for new dev setup.

## Supabase CLI
- Project ref: `aqhebjxaynvtvurwedrl`
- Push migrations: `supabase db push --linked` (no Docker needed)
- Dry run first: `supabase db push --linked --dry-run`
- Must be linked: `supabase link --project-ref aqhebjxaynvtvurwedrl`

## Known State
- Duplicate `Views/Auth` and `Views/Auth 2` folders exist — likely a Xcode copy artifact; check before editing auth views
- Supabase migrations live as `.sql` files in the root bakerly folder (not in a `supabase/` subdirectory)

## Support Log
`SUPPORT_LOG.md` (repo root) — a running log of customer-reported system problems and their fixes, kept separate from git history so it's scannable without digging through commits or chat transcripts. When you root-cause and fix a customer-reported bug, add an entry (format documented at the top of the file). Check it when a bug report sounds like something that may have come up before.

## Critical Patterns
- **Do not add raw hex colors to views** — always use a named constant from `BakeriTheme.swift`
- **SwiftData schema changes** wipe the local store on next launch (see `BakeriApp.modelContainer` error handling) — be careful with model migrations
- **`@EnvironmentObject` pattern**: `UserSettings.shared` and `TimerStore.shared` must be injected at root and passed down
- **Sync on foreground**: `SyncService.syncAll()` is called on scene activation and every 5 minutes via a timer
- **Orphaned MenuItem repair**: `repairOrphanedMenuItemRecipes()` runs at launch — understand it before touching the `MenuItem`↔`Recipe` relationship
