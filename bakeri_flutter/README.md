# Bakeri (Flutter)

Flutter rebuild of the Bakeri baker-tools app. See
`../CLAUDE.md`'s companion rebuild brief (delivered separately as
`bakeri_flutter_rebuild_spec.md`) for the full data model, business logic,
screen-by-screen spec, and web storefront contract. This project is the
**bootstrap scaffold** — real Supabase connection, ported brand theme,
project structure — everything after that follows the spec's §10 phasing.

## Quick start

```bash
flutter pub get
cp .env.template .env   # then fill in real values, see "Secrets" below
flutter run             # macOS/Chrome: works normally.
                        # iOS Simulator on THIS Mac: see "Known issue" below first.
```

The bootstrap home screen (`lib/screens/bootstrap_home_screen.dart`) proves
two things are wired correctly: a live Supabase connection, and the 5-theme
brand system ported from the iOS app. Verified live in the iOS Simulator —
green "Connected" check, and tapping a theme swatch live-recolors the
background/button/app-bar.

## Known issue: `flutter run`/`flutter build ios` fails to codesign on this Mac

On this machine, `flutter run -d <ios-simulator>` and `flutter build ios
--simulator` reliably fail with:

```
Target debug_unpack_ios failed: Exception: Failed to codesign
.../Flutter.framework/Flutter with identity -.
.../Flutter.framework/Flutter: resource fork, Finder information, or
similar detritus not allowed
```

Root cause: the Homebrew-cask-installed Flutter SDK's cached engine
binaries carry a `com.apple.provenance` extended attribute (macOS's
Gatekeeper supply-chain tracking for Homebrew-installed files), and macOS
re-attaches it to any copy of those same bytes — `xattr -d`, a byte-level
copy, even a zip/unzip round-trip all get it reattached. Apple's `codesign`
refuses to sign a file carrying that attribute ("detritus"). Flutter's own
Dart-based build step copies the framework into the project and codesigns
it immediately afterward — right into that failure. A **plain `xcodebuild`**
of the same generated Xcode project does not hit this (confirmed
reproducible both ways, clean-state, multiple times) — something about how
Xcode's own build system reaches the same Run Script phase avoids the race.

**Workaround (already verified working):**
```bash
./scripts/run_ios_sim.sh "iPhone 16 Pro"
```
This regenerates Flutter's Xcode config, builds via `xcodebuild` directly,
then installs+launches via `simctl`. You get a real running app; you lose
`flutter run`'s hot reload — re-run the script after each change instead.

**This is a local machine/environment quirk, not a code problem** — nothing
in this Dart/Xcode project is misconfigured. macOS/Android/web builds are
unaffected (no iOS codesigning involved). If it bothers you long-term, the
two real fixes are: (1) switch from `brew install --cask flutter` to a
git-cloned Flutter SDK (`git clone https://github.com/flutter/flutter.git
-b stable`) so the engine binaries never had Homebrew's quarantine/provenance
attached in the first place, or (2) wait for a Flutter/Xcode point release —
this smells like a race Apple/Flutter will eventually harden against.

## Project layout

```
lib/
  config/env.dart          — typed .env access (Supabase URL/anon key, Stripe pk, etc.)
  theme/app_theme.dart     — BakeriTheme enum (Classic/Macaron/Birthday/Tart/Sprinkle),
                             fixed semantic colors, typography, Material ThemeData builder
  theme/theme_controller.dart — riverpod state for the active theme/pattern (placeholder —
                             the real app persists this to profiles.selected_theme)
  services/supabase_providers.dart — shared SupabaseClient + a connectivity health check
  screens/bootstrap_home_screen.dart — proof-of-wiring screen; replace as real screens land
  main.dart                — loads .env, initializes Supabase, runs the app
```

## Secrets

This app reuses the **existing Supabase + Stripe backend** — same project,
same schema, same Edge Functions as the iOS app. Real values already exist
at `../Bakerly/Bakerly/Bakeri/Config/Secrets.swift`; `.env` here (gitignored)
is already populated with them for this machine. If you're setting this up
fresh elsewhere, copy from that file into your own `.env` (start from
`.env.template`).

| Key | Safe to embed in a client app? | Source |
|---|---|---|
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` | Yes — anon key is meant to be public, protected by RLS | `Config/Secrets.swift` |
| `STRIPE_PUBLISHABLE_KEY` | Yes — publishable keys are meant to be public | `Config/Secrets.swift` |
| `ONESIGNAL_APP_ID` / `SQUARE_APP_ID` | Yes | `Config/Secrets.swift` |
| `SUPABASE_SERVICE_ROLE_KEY` (root `.env`) | **Never.** Full RLS-bypass admin access. | Server-side / scripts only |
| Anthropic API key (`Config/AnthropicConfig.swift`) | **No — deliberately left out of `.env`.** See below. | — |

### The Anthropic key needs a real fix, not a port

The iOS app currently calls the Anthropic API **directly from the client**
with an embedded key (`RecipeAIService.swift`). That means anyone who
intercepts network traffic or extracts strings from the compiled app can
lift the key and run up your Anthropic bill — it already has this exposure
today, independent of this rebuild.

Don't repeat it in Flutter. Before wiring up AI recipe import:
1. Create a Supabase Edge Function (e.g. `recipe-ai-extract`) that holds the
   Anthropic key as a server-side secret (`supabase secrets set
   ANTHROPIC_API_KEY=...`) and proxies the image → JSON extraction call
   documented in the rebuild spec §6.7.
2. Have the Flutter app call that Edge Function (with the user's Supabase
   session bearer token) instead of `api.anthropic.com` directly.

This is a small function — most of the existing prompt/parsing logic in
`RecipeAIService.swift` ports directly into it. If you want the feature
working today and are willing to accept the risk short-term, you can add
`ANTHROPIC_API_KEY` to `.env` and call the API directly the way the iOS app
does — just know that's the same exposure, not a new one.

## What's next

Follow the rebuild spec's phasing (§10):
1. Local DB (Drift/Isar) + `SyncService`-equivalent pull/push against Supabase.
2. Theming is done here — extend `app_theme.dart` with the 4 background
   patterns (Standard/Stripes/PolkaDot/Gingham) as you build the tab shell.
3. Calculator + Recipes + Menu (no payment dependency — good first vertical slice).
4. Schedule + Orders + Financial reporting.
5. Settings, incl. Stripe Connect onboarding/payout UI (`flutter_stripe` +
   the same Edge Functions the iOS app already calls — `create-connect-account-link`,
   `get-baker-payout-summary`, `trigger-baker-payout`, etc.).
6. Web storefront (separate project/target — spec §8).

## Notes on package choices

- **State management**: Riverpod (`flutter_riverpod`) — one provider per
  concern, mirroring the iOS app's `Service.shared` singletons.
- **Backend**: `supabase_flutter` against the same project
  (`aqhebjxaynvtvurwedrl`) — no backend changes needed to start.
- Not yet added (add when the relevant phase starts, to keep `pub get`
  fast and avoid version-conflict churn early): `drift` (local DB),
  `flutter_stripe` (Connect onboarding/payment sheet), `flutter_local_notifications`
  (timers/order reminders), `in_app_purchase` (subscription paywall), `pdf`
  + `printing` (menu export), `mobile_scanner` (QR pickup confirmation),
  `image_picker`.
