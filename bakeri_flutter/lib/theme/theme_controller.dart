import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'app_theme.dart';

/// Placeholder for the real theme/pattern preference, which in the full app
/// lives on `profiles.selected_theme` / `profiles.background_pattern`
/// (see spec §3, §4 — ProfileService.savePreferences) and syncs across
/// devices. Local-only for this bootstrap screen.
final selectedThemeProvider = StateProvider<BakeriTheme>((ref) => BakeriTheme.classic);
final selectedPatternProvider =
    StateProvider<BakeriBackgroundPattern>((ref) => BakeriBackgroundPattern.standard);
