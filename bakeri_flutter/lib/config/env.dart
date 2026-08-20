import 'package:flutter_dotenv/flutter_dotenv.dart';

/// Typed access to the values loaded from `.env` (gitignored — see
/// `.env.template`). Mirrors `BakeriSecrets` in the source iOS app's
/// `Config/Secrets.swift`, minus the Anthropic key — see README "Secrets".
class Env {
  Env._();

  static Future<void> load() => dotenv.load(fileName: '.env');

  static String get supabaseUrl => _require('SUPABASE_URL');
  static String get supabaseAnonKey => _require('SUPABASE_ANON_KEY');

  /// Optional — features that need these should degrade gracefully rather
  /// than crash at startup if a baker hasn't configured them yet.
  static String? get stripePublishableKey => _optional('STRIPE_PUBLISHABLE_KEY');
  static String? get oneSignalAppId => _optional('ONESIGNAL_APP_ID');
  static String? get squareAppId => _optional('SQUARE_APP_ID');

  static String _require(String key) {
    final value = dotenv.env[key];
    if (value == null || value.isEmpty) {
      throw StateError(
        'Missing required .env key "$key". Copy .env.template to .env and '
        'fill in real values (see README "Secrets").',
      );
    }
    return value;
  }

  static String? _optional(String key) {
    final value = dotenv.env[key];
    return (value == null || value.isEmpty) ? null : value;
  }
}
