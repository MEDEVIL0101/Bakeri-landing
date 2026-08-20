// Smoke test kept deliberately narrow: the real app boot sequence loads
// .env and initializes Supabase in main() before runApp(), which needs real
// secrets and network access — not appropriate for a unit test. This just
// verifies the theme builder (the one piece of app-wiring that has no
// external dependency) produces sane output for every brand theme.

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:bakeri_app/theme/app_theme.dart';

void main() {
  test('buildBakeriThemeData produces a themed ThemeData for every theme/brightness', () {
    for (final theme in BakeriTheme.values) {
      for (final brightness in Brightness.values) {
        final data = buildBakeriThemeData(theme, brightness);
        expect(data.brightness, brightness);
        expect(data.scaffoldBackgroundColor, theme.backgroundFor(brightness));
      }
    }
  });

  test('every theme exposes exactly 3 swatch colors', () {
    for (final theme in BakeriTheme.values) {
      expect(theme.swatches.length, 3);
    }
  });
}
