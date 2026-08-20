import 'package:flutter/material.dart';

/// Ported 1:1 from the iOS app's `Models/AppTheme.swift`. Each named theme
/// carries a light/dark hex pair for four roles — do not add a theme or
/// change a hex value here without updating the storefront's `theme.js`
/// port too (see FLUTTER rebuild spec §3 / §8.2) — the two must stay
/// pixel-identical.
enum BakeriTheme {
  classic,
  macaron,
  birthday,
  tart,
  sprinkle;

  String get label => switch (this) {
        BakeriTheme.classic => 'Classic',
        BakeriTheme.macaron => 'Macaron',
        BakeriTheme.birthday => 'Birthday',
        BakeriTheme.tart => 'Tart',
        BakeriTheme.sprinkle => 'Sprinkle',
      };

  static BakeriTheme fromLabel(String raw) => BakeriTheme.values.firstWhere(
        (t) => t.label == raw,
        orElse: () => BakeriTheme.classic,
      );

  _HexPair get _primary => switch (this) {
        BakeriTheme.classic => const _HexPair('#1C1C1E', '#8E8E93'),
        BakeriTheme.macaron => const _HexPair('#D966B0', '#E87CC0'),
        BakeriTheme.birthday => const _HexPair('#5AAEE0', '#70C0F0'),
        BakeriTheme.tart => const _HexPair('#7E8435', '#9AAA3C'),
        BakeriTheme.sprinkle => const _HexPair('#F72967', '#F04478'),
      };

  _HexPair get _secondary => switch (this) {
        BakeriTheme.classic => const _HexPair('#A89B8C', '#968880'),
        BakeriTheme.macaron => const _HexPair('#F698DB', '#B05898'),
        BakeriTheme.birthday => const _HexPair('#FFD058', '#D4A030'),
        BakeriTheme.tart => const _HexPair('#FFD1D9', '#A84058'),
        BakeriTheme.sprinkle => const _HexPair('#46C6D7', '#2A98AA'),
      };

  _HexPair get _background => switch (this) {
        BakeriTheme.classic => const _HexPair('#FAF6EE', '#1A130F'),
        BakeriTheme.macaron => const _HexPair('#FDFAF0', '#1C1018'),
        BakeriTheme.birthday => const _HexPair('#FFF4F8', '#0E1620'),
        BakeriTheme.tart => const _HexPair('#F8F4EC', '#141608'),
        BakeriTheme.sprinkle => const _HexPair('#F7F2FC', '#160A1E'),
      };

  _HexPair get _gold => switch (this) {
        BakeriTheme.classic => const _HexPair('#C49A6C', '#A07840'),
        BakeriTheme.macaron => const _HexPair('#C8D87A', '#90A840'),
        BakeriTheme.birthday => const _HexPair('#FFD058', '#D4A030'),
        BakeriTheme.tart => const _HexPair('#FF5E32', '#CC4820'),
        BakeriTheme.sprinkle => const _HexPair('#BCACDD', '#8870C0'),
      };

  /// White for dark/vivid primaries, near-dark for light ones. Identical
  /// across light/dark mode for every theme except Classic, whose primary
  /// itself flips between near-black (light) and mid-gray (dark), so its
  /// button foreground must flip the other way to stay legible.
  Color buttonForegroundFor(Brightness brightness) {
    switch (this) {
      case BakeriTheme.classic:
        return brightness == Brightness.dark
            ? const Color(0xFF1C1C1E)
            : Colors.white;
      case BakeriTheme.sprinkle:
      case BakeriTheme.tart:
        return Colors.white;
      case BakeriTheme.macaron:
      case BakeriTheme.birthday:
        return const Color(0xFF2A2020);
    }
  }

  /// 3-swatch preview array shown in the theme picker.
  List<Color> get swatches => switch (this) {
        BakeriTheme.classic => [
            _hex('#1C1C1E'),
            _hex('#A89B8C'),
            _hex('#D9E3E2'),
          ],
        BakeriTheme.macaron => [
            _hex('#FFE485'),
            _hex('#F698DB'),
            _hex('#E1EEAF'),
          ],
        BakeriTheme.birthday => [
            _hex('#FFD3E4'),
            _hex('#92D1FF'),
            _hex('#FFD058'),
          ],
        BakeriTheme.tart => [
            _hex('#7E8435'),
            _hex('#FFD1D9'),
            _hex('#FF5E32'),
          ],
        BakeriTheme.sprinkle => [
            _hex('#F72967'),
            _hex('#46C6D7'),
            _hex('#BCACDD'),
          ],
      };

  Color primaryFor(Brightness b) => _primary.forBrightness(b);
  Color secondaryFor(Brightness b) => _secondary.forBrightness(b);
  Color backgroundFor(Brightness b) => _background.forBrightness(b);
  Color goldFor(Brightness b) => _gold.forBrightness(b);
}

/// Ported from `Models/AppTheme.swift`'s `AppBackgroundPattern` /
/// `BackgroundPattern` — applied once behind all tab content, not per-screen.
enum BakeriBackgroundPattern { standard, stripes, polkaDot, gingham }

class _HexPair {
  final String light;
  final String dark;
  const _HexPair(this.light, this.dark);

  Color forBrightness(Brightness b) =>
      _hex(b == Brightness.dark ? dark : light);
}

Color _hex(String hex) {
  final clean = hex.replaceAll('#', '');
  return Color(int.parse('FF$clean', radix: 16));
}

/// Fixed (non-theme-adaptive) semantic colors — spec §3.3. These stay
/// constant regardless of the baker's chosen theme.
class BakeriFixedColors {
  BakeriFixedColors._();

  static const deepBrown = Color(0xFF352021);
  static const espresso = Color(0xFF14100A);

  // Order status colors
  static const statusConfirmed = Color(0xFF5F92E6);
  static const statusDecorated = Color(0xFFC87941);
  static const statusDelivered = Color(0xFF4CAF50);
  static const statusCompletedGray = Color(0xFF989591);
  static const statusCancelledRed = Color(0xFFD06767);

  // Storefront-profile-redesign tokens (in-app profile header + public storefront)
  static const profileInk = Color(0xFF241712);
  static const profileMuted = Color(0xFF948577);
  static const profileBio = Color(0xFF4A3E33);
  static const profileChipText = Color(0xFF7A6C5D);
  static const badgeReady = Color(0xFF3FA672);
  static const badgeCustom = Color(0xFFA66A5B);
  static const badgePreorder = Color(0xFFC79A3D);
}

/// Typography roles — spec §3.4. No custom font family; system font
/// throughout, weight/size driven by named roles.
class BakeriFont {
  BakeriFont._();

  static TextStyle display([double size = 32]) =>
      TextStyle(fontSize: size, fontWeight: FontWeight.bold);
  static TextStyle heading([double size = 20]) =>
      TextStyle(fontSize: size, fontWeight: FontWeight.bold);
  static TextStyle subheading([double size = 16]) =>
      TextStyle(fontSize: size, fontWeight: FontWeight.w500);
  static TextStyle body([double size = 15]) =>
      TextStyle(fontSize: size, fontWeight: FontWeight.normal);
  static TextStyle caption([double size = 12]) =>
      TextStyle(fontSize: size, fontWeight: FontWeight.normal);
  static TextStyle mono([double size = 14]) => TextStyle(
        fontSize: size,
        fontWeight: FontWeight.normal,
        fontFamily: 'monospace',
      );
}

/// Builds a Material [ThemeData] for the given brand theme + brightness.
/// This is the Flutter equivalent of `AppTheme.applyAppearance()`.
ThemeData buildBakeriThemeData(BakeriTheme theme, Brightness brightness) {
  final primary = theme.primaryFor(brightness);
  final background = theme.backgroundFor(brightness);
  final base = brightness == Brightness.dark
      ? ThemeData.dark(useMaterial3: true)
      : ThemeData.light(useMaterial3: true);

  return base.copyWith(
    brightness: brightness,
    scaffoldBackgroundColor: background,
    colorScheme: base.colorScheme.copyWith(
      primary: primary,
      secondary: theme.secondaryFor(brightness),
      surface: background,
    ),
    appBarTheme: AppBarTheme(
      backgroundColor: background,
      foregroundColor: primary,
      elevation: 0,
      surfaceTintColor: Colors.transparent,
    ),
    elevatedButtonTheme: ElevatedButtonThemeData(
      style: ElevatedButton.styleFrom(
        backgroundColor: primary,
        foregroundColor: theme.buttonForegroundFor(brightness),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(14),
        ),
        padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 14),
        textStyle: const TextStyle(
          fontSize: 16,
          fontWeight: FontWeight.w600,
        ),
      ),
    ),
    cardTheme: CardThemeData(
      color: brightness == Brightness.dark
          ? const Color(0xFF1E1E1E)
          : Colors.white,
      elevation: brightness == Brightness.dark ? 6 : 3,
      shadowColor: Colors.black.withValues(
        alpha: brightness == Brightness.dark ? 0.35 : 0.07,
      ),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
    ),
  );
}
