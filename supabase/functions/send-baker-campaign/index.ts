import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { customerEmailIdentity, sanitizeDisplayName } from "../_shared/senderIdentity.ts";
import { sendEmail } from "../_shared/resend.ts";

// Baker-authenticated only (a real signed-in user JWT, verified below) —
// never public/anon, unlike capture-storefront-email. Composing/saving a
// campaign as a 'draft' happens client-side via direct RLS
// (baker_manage_own_campaigns already lets a baker insert/update her own
// rows); this function's only job is the actual send — loading the
// campaign + her non-unsubscribed baker_contacts, sending one email per
// recipient via Resend, and logging each outcome to baker_campaign_sends.
//
// Every email carries a mandatory one-click unsubscribe link
// (baker_contacts.unsubscribe_token → the unsubscribe function) — the
// actual compliance backstop for this whole feature, not a consent flag
// captured at signup time. See baker_contacts' own migration for that
// reasoning.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildCampaignHtml(opts: {
  bodyText: string;
  imageUrl: string | null;
  ctaLabel: string | null;
  ctaHref: string | null;
  unsubscribeUrl: string;
  /** campaign-track's 1×1 open image; omitted on test sends. */
  openPixelUrl?: string | null;
}): string {
  const paragraphs = opts.bodyText
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px;font-size:14.5px;line-height:1.55;color:#4A3E33;">${escapeHtml(p).replace(/\n/g, "<br/>")}</p>`)
    .join("");
  const image = opts.imageUrl
    ? `<img src="${opts.imageUrl}" style="width:100%;border-radius:12px;margin-bottom:16px;" alt="" />`
    : "";
  const cta = opts.ctaLabel && opts.ctaHref
    ? `<a href="${opts.ctaHref}" style="display:inline-block;margin:8px 0 4px;padding:12px 22px;background:#241712;color:#fff;border-radius:9999px;text-decoration:none;font-weight:700;font-size:14px;">${escapeHtml(opts.ctaLabel)}</a>`
    : "";
  return `
    <div style="font-family:-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:28px 24px;color:#241712;background:#fff;">
      ${image}
      ${paragraphs}
      ${cta}
      <div style="height:1px;background:#E4D9C8;margin:24px 0 14px;"></div>
      <p style="color:#A89B8C;font-size:11.5px;line-height:1.5;margin:0;">
        You're receiving this because you're on this baker's mailing list.
        <a href="${opts.unsubscribeUrl}" style="color:#A89B8C;">Unsubscribe</a>
      </p>
      ${opts.openPixelUrl ? `<img src="${opts.openPixelUrl}" width="1" height="1" alt="" style="display:block;border:0;width:1px;height:1px;" />` : ""}
    </div>
  `;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader || authHeader === `Bearer ${SUPABASE_ANON_KEY}`) {
    return json({ error: "Sign in required." }, 401);
  }
  const authedClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user } } = await authedClient.auth.getUser();
  if (!user) return json({ error: "Sign in required." }, 401);
  const bakerId = user.id;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid request." }, 400);
  }
  const campaignId = String(body.campaign_id ?? "").trim();
  if (!campaignId) return json({ error: "Invalid request." }, 400);
  // A copy to the vendor's own email only — nothing recorded, no tracking.
  const isTest = body.test === true;

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Email campaigns are a Pro feature (Harvey 2026-10-30).
  // effective_plan_tier() so lifetime Pro and payment grace periods count.
  const { data: tier } = await db.rpc("effective_plan_tier", { p_user_id: bakerId });
  if (tier !== "pro") {
    return json({ error: "Email campaigns are part of the Pro plan." }, 403);
  }

  const { data: campaign } = await db
    .from("baker_campaigns")
    .select("id, user_id, subject, body_text, image_url, cta_label, cta_url, cta_listing_id, status, audience")
    .eq("id", campaignId)
    .eq("user_id", bakerId)
    .maybeSingle();
  if (!campaign) return json({ error: "Campaign not found." }, 404);
  if (!isTest && (campaign.status === "sending" || campaign.status === "sent")) {
    return json({ error: `This campaign is already ${campaign.status}.` }, 409);
  }

  const { data: bakerProfile } = await db.from("profiles").select("business_name, user_name").eq("id", bakerId).maybeSingle();
  const bakerDisplayName = bakerProfile?.business_name?.trim() || bakerProfile?.user_name?.trim() || null;
  const identity = await customerEmailIdentity(db, bakerId, bakerDisplayName);

  let ctaHref = campaign.cta_url || null;
  if (!ctaHref && campaign.cta_listing_id) {
    // A product CTA needs a real storefront URL, not just an id — resolve
    // via the baker's own slug the same way the rest of the storefront
    // links out. Best-effort: falls back to no CTA if the slug is missing.
    const { data: profileRow } = await db.from("profiles").select("profile_slug").eq("id", bakerId).maybeSingle();
    if (profileRow?.profile_slug) {
      ctaHref = `https://bakeriapp.com/${profileRow.profile_slug}?item=${campaign.cta_listing_id}`;
    }
  }

  // ── Test send: one copy to the vendor, marked as a test ────────────────
  if (isTest) {
    const to = user.email;
    if (!to) return json({ error: "Your account has no email address to send a test to." }, 400);
    const result = await sendEmail({
      from: identity.from,
      reply_to: identity.reply_to,
      to,
      subject: `[Test] ${sanitizeDisplayName(campaign.subject) || "Update"}`,
      html: buildCampaignHtml({
        bodyText: campaign.body_text || "",
        imageUrl: campaign.image_url,
        ctaLabel: campaign.cta_label,
        ctaHref,
        unsubscribeUrl: "https://bakeriapp.com/",
      }),
    });
    return result.ok ? json({ ok: true, to }) : json({ error: "The test email couldn't be sent. Please try again." }, 502);
  }

  // ── Recipients: the campaign's audience (contact ids the web app worked
  // out), or everyone when it has none (older campaigns, the iPhone app).
  // Always only this vendor's own contacts who are still subscribed.
  const audienceIds: string[] | null = Array.isArray(campaign.audience?.contact_ids)
    ? (campaign.audience.contact_ids as unknown[]).map(String)
    : null;
  if (audienceIds && audienceIds.length === 0) {
    return json({ error: "Nobody is in this campaign's audience." }, 400);
  }
  let contacts: { id: string; email: string; unsubscribe_token: string }[] = [];
  const pageSize = 300;
  for (let i = 0; i < (audienceIds ? audienceIds.length : 1); i += pageSize) {
    let q = db.from("baker_contacts")
      .select("id, email, unsubscribe_token")
      .eq("user_id", bakerId)
      .is("unsubscribed_at", null);
    if (audienceIds) q = q.in("id", audienceIds.slice(i, i + pageSize));
    const { data } = await q;
    contacts = contacts.concat(data ?? []);
  }
  if (contacts.length === 0) {
    return json({ error: "No subscribed contacts to send to." }, 400);
  }

  await db.from("baker_campaigns").update({ status: "sending", updated_at: new Date().toISOString() }).eq("id", campaignId);

  // One row per email up front — each gets the track_token its open image
  // and button carry (campaign-track).
  const { data: rows, error: rowsErr } = await db.from("baker_campaign_sends")
    .insert(contacts.map((c) => ({ campaign_id: campaignId, contact_id: c.id, email: c.email, status: "pending" })))
    .select("id, contact_id, track_token");
  if (rowsErr || !rows) {
    await db.from("baker_campaigns").update({ status: "failed", updated_at: new Date().toISOString() }).eq("id", campaignId);
    return json({ error: "Couldn't start sending. Please try again." }, 500);
  }
  const rowFor = new Map(rows.map((r) => [r.contact_id as string, r]));
  const trackBase = `${SUPABASE_URL}/functions/v1/campaign-track`;

  let sentCount = 0;
  let failedCount = 0;

  for (const contact of contacts) {
    const row = rowFor.get(contact.id);
    const unsubscribeUrl = `${SUPABASE_URL}/functions/v1/unsubscribe?token=${contact.unsubscribe_token}`;
    const html = buildCampaignHtml({
      bodyText: campaign.body_text || "",
      imageUrl: campaign.image_url,
      ctaLabel: campaign.cta_label,
      ctaHref: ctaHref && row ? `${trackBase}?e=c&t=${row.track_token}` : ctaHref,
      unsubscribeUrl,
      openPixelUrl: row ? `${trackBase}?e=o&t=${row.track_token}` : null,
    });
    const result = await sendEmail({
      from: identity.from,
      reply_to: identity.reply_to,
      to: contact.email,
      subject: sanitizeDisplayName(campaign.subject) || "Update",
      html,
    });
    if (row) {
      await db.from("baker_campaign_sends").update({
        status: result.ok ? "sent" : "failed",
        sent_at: result.ok ? new Date().toISOString() : null,
        error: result.ok ? null : (result.error ?? null),
      }).eq("id", row.id);
    }
    if (result.ok) sentCount++; else failedCount++;
  }

  await db.from("baker_campaigns").update({
    status: "sent",
    sent_at: new Date().toISOString(),
    recipient_count: sentCount,
    updated_at: new Date().toISOString(),
  }).eq("id", campaignId);

  return json({ ok: true, sent: sentCount, failed: failedCount });
});
