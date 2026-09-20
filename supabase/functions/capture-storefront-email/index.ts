import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Public, unauthenticated endpoint — a visitor on a baker's storefront
// (popup / inline card / persistent header button, see StorefrontBlockType
// .emailCapture) joins that baker's mailing list. Writes land in
// baker_contacts, source-tagged by which surface captured them.
//
// Routed through this function rather than a direct RLS anon-INSERT policy
// — same established convention as submit-vendor-application (see
// 20260706000011_vendor_applications_via_function.sql, which REVOKED a
// direct-insert policy specifically because real validation and rate
// limiting can't be expressed in a CHECK constraint alone). No captcha here
// (unlike submit-custom-order-inquiry / submit-vendor-application) — a
// mailing-list join is a much lower-value abuse target than a vendor
// application or a custom-order lead, so plain email-format validation +
// a generous per-IP rate limit is the proportionate bar; revisit if real
// abuse shows up.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_SOURCES = new Set(["popup", "inline", "header", "lead_magnet"]);
const MAX_NAME_LENGTH = 200;
const RATE_LIMIT_PER_HOUR = 8;
// Matches finalize-guest-digital-order's own value — a guest has no
// session to re-fetch this later, and this is the buyer's only lasting
// record of a free deliverable she claimed.
const SIGNED_URL_EXPIRY_SECONDS = 60 * 60 * 24 * 365;

function buildDownloadFilename(itemName: string, filePath: string): string {
  const ext = (filePath.split(".").pop() || "").toLowerCase();
  const safeName = (itemName || "download").replace(/[\/\\?%*:|"<>]/g, "-").trim() || "download";
  return ext && ext !== filePath ? `${safeName}.${ext}` : safeName;
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function getClientIp(req: Request): string | null {
  const h = req.headers;
  return (
    h.get("cf-connecting-ip") ||
    h.get("x-real-ip") ||
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    null
  );
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid request." }, 400);
  }

  const bakerID = String(body.user_id ?? "").trim();
  const email = String(body.email ?? "").trim().toLowerCase();
  const name = String(body.name ?? "").trim().slice(0, MAX_NAME_LENGTH) || null;
  const source = String(body.source ?? "").trim();

  if (!UUID_RE.test(bakerID)) return json({ error: "Invalid request." }, 400);
  if (!EMAIL_RE.test(email)) return json({ error: "Please enter a valid email address." }, 400);
  if (!VALID_SOURCES.has(source)) return json({ error: "Invalid request." }, 400);

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Confirm the baker actually exists — a bad/stale user_id from a cached
  // storefront page should fail quietly rather than create an orphaned
  // contact row with no owner to ever see it.
  const { data: baker } = await db.from("profiles").select("id").eq("id", bakerID).maybeSingle();
  if (!baker) return json({ error: "Baker not found." }, 404);

  const ip = getClientIp(req);
  if (ip) {
    const { count } = await db
      .from("email_capture_attempts")
      .select("id", { count: "exact", head: true })
      .eq("ip_address", ip)
      .gte("created_at", new Date(Date.now() - 60 * 60 * 1000).toISOString());
    if ((count ?? 0) >= RATE_LIMIT_PER_HOUR) {
      return json({ error: "Too many signups from this connection recently. Please try again later." }, 429);
    }
    await db.from("email_capture_attempts").insert({ ip_address: ip });
  }

  // Upsert: a repeat signup (including one from a previously-unsubscribed
  // contact) clears unsubscribed_at rather than erroring on the unique
  // (user_id, email) constraint.
  const { error } = await db
    .from("baker_contacts")
    .upsert(
      {
        user_id: bakerID,
        email,
        name,
        source,
        unsubscribed_at: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,email" }
    );

  if (error) {
    console.error("baker_contacts upsert failed:", error.message);
    return json({ error: "Something went wrong. Please try again." }, 500);
  }

  // Lead-magnet delivery — a free digital file in exchange for the email
  // just captured above. Deliberately NOT routed through
  // finalize-guest-digital-order (that function is structurally payment-
  // first: requires and verifies a real Stripe PaymentIntent, computes
  // settlement/fees, has refund logic — bypassing that safely would mean
  // stripping ~40% of it behind a condition). This inserts a minimal free
  // order directly and reuses send-guest-digital-delivery-email unchanged
  // — that function only needs an orders row with customer_email set, it
  // doesn't care how the order got there. Best-effort throughout: a failure
  // here never fails the signup itself, which already succeeded above.
  let downloadUrl: string | null = null;
  const deliverableListingId = String(body.deliverable_listing_id ?? "").trim();

  if (UUID_RE.test(deliverableListingId)) {
    const { data: listing } = await db
      .from("menu_items")
      .select("id, name, digital_file_path")
      .eq("id", deliverableListingId)
      .eq("user_id", bakerID)
      .eq("is_lead_magnet", true)
      .maybeSingle();

    if (listing?.digital_file_path) {
      const { data: signedUrlData } = await db.storage
        .from("digital-products")
        .createSignedUrl(listing.digital_file_path, SIGNED_URL_EXPIRY_SECONDS);

      if (signedUrlData?.signedUrl) {
        const filename = buildDownloadFilename(listing.name, listing.digital_file_path);
        const candidateUrl = `${signedUrlData.signedUrl}&download=${encodeURIComponent(filename)}`;

        const { data: bakerProfile } = await db
          .from("profiles").select("business_name, user_name").eq("id", bakerID).maybeSingle();
        const bakerDisplayName = bakerProfile?.business_name?.trim() || bakerProfile?.user_name?.trim() || "Baker";

        const orderId = crypto.randomUUID();
        const now = new Date().toISOString();

        const { error: orderErr } = await db.from("orders").insert({
          id: orderId,
          user_id: bakerID,
          order_name: listing.name,
          baker_display_name: bakerDisplayName,
          customer_name: name ?? "",
          customer_phone: "",
          customer_email: email,
          due_date: now,
          status: "Confirmed",
          notes: "",
          is_paid: true,
          payment_note: "Free download (lead magnet) — no charge.",
          platform_fee_cents: 0,
          deposit_amount: 0,
          deposit_note: "",
          fulfillment_type: "Digital",
          delivery_details: "",
          is_delivery: false,
          delivery_address: null,
          created_at: now,
          updated_at: now,
          color_name: "green",
          order_source: "marketplace",
          marketplace_status: "completed",
          completed_at: now,
          buyer_profile_id: null,
          buyer_display_name: name ?? "",
          scheduled_pickup_date: null,
          payment_intent_id: null,
          payment_status: "free",
          // Only 'platform_custody' | 'direct' are valid (orders_payment_model_check)
          // — no Stripe Connect account is involved in a free claim at all,
          // same "no connected account" case finalize-guest-digital-order's
          // own ternary falls back to.
          payment_model: "platform_custody",
          reference_photo_count: 0,
          lead_channel: "website",
          ip_address: ip,
        });

        if (!orderErr) {
          await db.from("order_items").insert({
            id: crypto.randomUUID(),
            user_id: bakerID,
            order_id: orderId,
            recipe_id: null,
            menu_item_id: listing.id,
            custom_name: listing.name,
            quantity: 1,
            unit: "download",
            price_per_unit: 0,
            variant_id: null,
            variant_label: null,
            notes: "",
            updated_at: now,
          });

          downloadUrl = candidateUrl;

          // Backup emailed copy, same fire-and-forget convention
          // finalize-guest-digital-order itself uses for this same call —
          // never blocks the response.
          fetch(`${SUPABASE_URL}/functions/v1/send-guest-digital-delivery-email`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
            body: JSON.stringify({
              order_id: orderId,
              downloads: [{ item_name: listing.name, download_url: candidateUrl, menu_item_id: listing.id }],
            }),
          }).catch((e) => console.error("send-guest-digital-delivery-email fire-and-forget failed:", e));
        } else {
          console.error("lead magnet orders insert failed:", orderErr.message);
        }
      }
    }
  }

  return json({ ok: true, download_url: downloadUrl });
});
