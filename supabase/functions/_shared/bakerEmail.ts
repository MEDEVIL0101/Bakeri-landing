// profiles.email is intentionally never populated by the app —
// 20260601000003_profiles_column_security.sql explicitly excludes it from
// the anon-readable profile projection with the comment "app reads it from
// auth.session, not profiles." Nothing in the iOS app or any edge function
// ever writes to it, so any code that trusts profiles.email as a baker's
// mail recipient silently sends nothing for the (typical) case where it's
// blank — confirmed live 2026-08-24: every one of the four
// sendBakerOrderEmail call sites (finalize-guest-digital-order,
// finalize-guest-physical-order, create-guest-marketplace-order,
// submit-custom-order-inquiry) depended on it and produced not even a
// failed notification_log row when it was empty, just silent nothing.
//
// The baker's real, always-populated address lives on their Supabase Auth
// user record instead — this resolves it from there via the Admin API
// (requires a service-role client, which every caller already has), falling
// back to profiles.email only if that lookup itself fails for some reason.

// deno-lint-ignore no-explicit-any
export async function resolveBakerEmail(db: any, bakerId: string, profileEmailFallback?: string | null): Promise<string | null> {
  try {
    const { data, error } = await db.auth.admin.getUserById(bakerId);
    if (!error && data?.user?.email) return data.user.email as string;
    if (error) console.error(`resolveBakerEmail: auth.admin.getUserById failed for ${bakerId}:`, error.message);
  } catch (err) {
    console.error(`resolveBakerEmail: auth.admin.getUserById threw for ${bakerId}:`, err instanceof Error ? err.message : err);
  }
  return profileEmailFallback || null;
}
