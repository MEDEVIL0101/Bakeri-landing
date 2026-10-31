// Daily per-vendor limits on Claude-backed features (migration
// 20261031000003_ai_usage_limits). Rolling 24 hours; a failed Claude call
// gives its use back. Fails open if the quota table can't be reached, so a
// database hiccup never blocks a vendor — the auth check still applies.
import { createClient } from "jsr:@supabase/supabase-js@2";

export const AI_LIMITS = {
  ai: 10,          // claude-api-proxy (recipe scans)
  form_import: 5,  // import-external-form (Google Forms / JotForm)
} as const;

export type AiFeature = keyof typeof AI_LIMITS;

function admin() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
}

/** { ok: true, id } when a use was taken (id is null if the quota couldn't be checked), { ok: false } at the limit. */
export async function takeAiUse(userId: string, feature: AiFeature): Promise<{ ok: true; id: number | null } | { ok: false }> {
  try {
    const { data, error } = await admin().rpc("consume_ai_quota", { p_user_id: userId, p_feature: feature, p_limit: AI_LIMITS[feature] });
    if (error) {
      console.error("consume_ai_quota failed:", error.message);
      return { ok: true, id: null };
    }
    return data == null ? { ok: false } : { ok: true, id: Number(data) };
  } catch (e) {
    console.error("consume_ai_quota threw:", e instanceof Error ? e.message : e);
    return { ok: true, id: null };
  }
}

export async function giveBackAiUse(id: number | null): Promise<void> {
  if (id == null) return;
  try { await admin().rpc("refund_ai_quota", { p_id: id }); } catch { /* best effort */ }
}

export function limitMessage(feature: AiFeature): string {
  return feature === "form_import"
    ? `You've reached today's limit of ${AI_LIMITS.form_import} form imports. Try again tomorrow, or build the form by hand.`
    : `You've reached today's limit of ${AI_LIMITS.ai} AI recipe scans. Try again tomorrow.`;
}
