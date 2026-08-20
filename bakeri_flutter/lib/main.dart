import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'config/env.dart';
import 'screens/bootstrap_home_screen.dart';
import 'theme/app_theme.dart';
import 'theme/theme_controller.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  await Env.load();
  await Supabase.initialize(
    url: Env.supabaseUrl,
    publishableKey: Env.supabaseAnonKey,
  );

  runApp(const ProviderScope(child: BakeriApp()));
}

class BakeriApp extends ConsumerWidget {
  const BakeriApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = ref.watch(selectedThemeProvider);

    return MaterialApp(
      title: 'Bakeri',
      debugShowCheckedModeBanner: false,
      theme: buildBakeriThemeData(theme, Brightness.light),
      darkTheme: buildBakeriThemeData(theme, Brightness.dark),
      home: const BootstrapHomeScreen(),
    );
  }
}
