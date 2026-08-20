// square-sync-catalog
// Pulls the baker's Square catalog and upserts items into Bakeri's menu_items table.
// Called from the iOS app on demand (baker taps "Sync from Square").
//
// POST (no body required)
// Auth: Bearer {baker's Supabase JWT}
//
// Required env vars:
//   SUPABASE_URL              — auto-injected
//   SUPABASE_SERVICE_ROLE_KEY — auto-injected
//   SUPABASE_ANON_KEY         — auto-injected

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL     = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON    = Deno.env.get("SUPABASE_ANON_KEY")!;
const SQUARE_API       = "https://connect.squareup.com";
const SQUARE_VERSION   = "2024-01-17";

// Square category IDs → Bakeri category names (best-effort mapping)
const CATEGORY_MAP: Record<string, string> = {
  // Populated from the baker's own Square categories at runtime — see below
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type" } });
  }

  // ── 1. Verify baker JWT ──────────────────────────────────────────────────────
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authErr } = await userClient.auth.getUser();
  if (authErr || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE);

  // ── 2. Fetch Square integration ───────────────────────────────────────────────
  const { data: pos } = await admin
    .from("pos_integrations")
    .select("access_token,location_id")
    .eq("user_id", user.id)
    .eq("pos_type", "square")
    .eq("is_active", true)
    .single<{ access_token: string; location_id: string }>();

  if (!pos) {
    return new Response(JSON.stringify({ error: "No active Square integration" }), { status: 404 });
  }

  const squareHeaders = {
    Authorization: `Bearer ${pos.access_token}`,
    "Square-Version": SQUARE_VERSION,
  };

  // ── 3. Fetch Square categories first (to map category IDs → names) ────────────
  const catRes = await fetch(`${SQUARE_API}/v2/catalog/list?types=CATEGORY`, { headers: squareHeaders });
  const catData = catRes.ok ? await catRes.json() : {};
  const categoryMap: Record<string, string> = {};
  for (const obj of catData.objects ?? []) {
    if (obj.type === "CATEGORY") {
      categoryMap[obj.id] = obj.category_data?.name ?? "Other";
    }
  }

  // ── 4. Fetch Square catalog items ─────────────────────────────────────────────
  let cursor: string | undefined;
  let synced = 0;
  let skipped = 0;

  do {
    const listURL = new URL(`${SQUARE_API}/v2/catalog/list`);
    listURL.searchParams.set("types", "ITEM");
    if (cursor) listURL.searchParams.set("cursor", cursor);

    const listRes = await fetch(listURL.toString(), { headers: squareHeaders });
    if (!listRes.ok) {
      const errText = await listRes.text();
      console.error("Square catalog list failed:", errText);
      return new Response(JSON.stringify({ error: "Square API error", detail: errText }), { status: 502 });
    }

    const listData = await listRes.json();
    cursor = listData.cursor;

    for (const obj of listData.objects ?? []) {
      if (obj.type !== "ITEM" || obj.is_deleted) { skipped++; continue; }

      const item      = obj.item_data ?? {};
      const variation = item.variations?.[0]?.item_variation_data ?? {};
      const priceAmt  = variation.price_money?.amount ?? 0;
      const price     = priceAmt / 100;

      // Map Square category → Bakeri category name
      const catId    = item.category_id ?? item.reporting_category?.id;
      const category = catId ? (categoryMap[catId] ?? "Other") : "Other";

      const { error: upsertErr } = await admin
        .from("menu_items")
        .upsert(
          {
            user_id:          user.id,
            name:             item.name ?? "Untitled",
            item_description: item.description ?? "",
            default_price:    price,
            category,
            pos_item_id:      obj.id,
            pos_type:         "square",
            is_active:        !(item.is_archived ?? false),
            updated_at:       new Date().toISOString(),
          },
          { onConflict: "user_id,pos_item_id" }
        );

      if (upsertErr) {
        console.error("Upsert error for item", obj.id, ":", upsertErr);
        skipped++;
      } else {
        synced++;
      }
    }
  } while (cursor);

  // ── 5. Log result ─────────────────────────────────────────────────────────────
  await admin.from("pos_sync_log").insert({
    user_id:  user.id,
    pos_type: "square",
    direction:"pull_catalog",
    bakeri_id:`${synced} items`,
    status:   "success",
  });

  return new Response(JSON.stringify({ synced, skipped }), {
    headers: { "Content-Type": "application/json" },
  });
});
