import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../services/supabase_providers.dart';
import '../theme/app_theme.dart';
import '../theme/theme_controller.dart';

/// Proof-of-wiring screen: confirms the Supabase client connects with the
/// ported secrets, and lets you flip through the 5 brand themes live. This
/// is scaffolding, not a real app screen — swap it out once §7 of the
/// rebuild spec's screens (Auth, Calculator, Schedule, Orders, Recipes,
/// Settings) start landing.
class BootstrapHomeScreen extends ConsumerWidget {
  const BootstrapHomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final health = ref.watch(supabaseHealthCheckProvider);
    final theme = ref.watch(selectedThemeProvider);
    final brightness = Theme.of(context).brightness;

    return Scaffold(
      appBar: AppBar(title: const Text('Bakeri')),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          Text('Bakeri', style: BakeriFont.display()),
          const SizedBox(height: 4),
          Text(
            'The sweetest way to sell local.',
            style: BakeriFont.body().copyWith(color: Colors.grey.shade600),
          ),
          const SizedBox(height: 24),

          _SectionCard(
            title: 'Supabase connection',
            child: health.when(
              data: (_) => const _StatusRow(
                ok: true,
                label: 'Connected — anon key + URL are wired up correctly.',
              ),
              loading: () => const _StatusRow(
                ok: null,
                label: 'Checking connection…',
              ),
              error: (err, _) => _StatusRow(
                ok: false,
                label: 'Could not reach Supabase: $err',
              ),
            ),
          ),
          const SizedBox(height: 16),

          _SectionCard(
            title: 'Brand theme (${theme.label})',
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Wrap(
                  spacing: 10,
                  runSpacing: 10,
                  children: BakeriTheme.values.map((t) {
                    final selected = t == theme;
                    return GestureDetector(
                      onTap: () =>
                          ref.read(selectedThemeProvider.notifier).state = t,
                      child: Column(
                        children: [
                          Container(
                            width: 56,
                            height: 56,
                            decoration: BoxDecoration(
                              shape: BoxShape.circle,
                              border: Border.all(
                                color: selected
                                    ? t.primaryFor(brightness)
                                    : Colors.transparent,
                                width: 3,
                              ),
                            ),
                            padding: const EdgeInsets.all(4),
                            child: ClipOval(
                              child: Row(
                                children: t.swatches
                                    .map((c) => Expanded(
                                          child: Container(color: c),
                                        ))
                                    .toList(),
                              ),
                            ),
                          ),
                          const SizedBox(height: 4),
                          Text(t.label, style: BakeriFont.caption()),
                        ],
                      ),
                    );
                  }).toList(),
                ),
                const SizedBox(height: 16),
                ElevatedButton(
                  onPressed: () {},
                  child: Text('Primary button (${theme.label})'),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _SectionCard extends StatelessWidget {
  final String title;
  final Widget child;
  const _SectionCard({required this.title, required this.child});

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(title, style: BakeriFont.subheading()),
            const SizedBox(height: 12),
            child,
          ],
        ),
      ),
    );
  }
}

class _StatusRow extends StatelessWidget {
  final bool? ok; // null = pending
  final String label;
  const _StatusRow({required this.ok, required this.label});

  @override
  Widget build(BuildContext context) {
    final color = ok == null
        ? Colors.orange
        : (ok! ? Colors.green : Colors.red);
    final icon = ok == null
        ? Icons.hourglass_top
        : (ok! ? Icons.check_circle : Icons.error);
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(icon, color: color, size: 20),
        const SizedBox(width: 8),
        Expanded(child: Text(label)),
      ],
    );
  }
}
