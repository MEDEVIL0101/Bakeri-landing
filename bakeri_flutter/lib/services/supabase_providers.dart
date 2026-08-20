import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

/// The single shared Supabase client — mirrors `SupabaseManager.shared` in
/// the source iOS app. Initialized once in `main()` before `runApp`.
final supabaseClientProvider = Provider<SupabaseClient>((ref) {
  return Supabase.instance.client;
});

/// Lightweight connectivity proof for the "is this plugged in correctly"
/// check on the home screen — a harmless anon-scoped select. An empty
/// result is a perfectly valid success (RLS may hide all rows from an
/// unauthenticated caller); only a thrown exception means the wiring is
/// actually broken (bad URL, bad anon key, project paused, no network).
final supabaseHealthCheckProvider = FutureProvider<bool>((ref) async {
  final client = ref.watch(supabaseClientProvider);
  await client.from('baker_faqs').select('id').limit(1);
  return true;
});
