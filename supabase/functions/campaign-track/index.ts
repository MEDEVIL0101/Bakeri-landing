import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Public, unauthenticated, GET-only (deploy with --no-verify-jwt) — hit from
// inside campaign emails sent by send-baker-campaign:
//   ?e=o&t=<token>  the 1×1 image at the bottom of the email → records an open
//   ?e=c&t=<token>  the email's button → records a click, then redirects
//   ?e=c&t=<token>&l=<n>  link n of a custom-HTML email (baker_campaigns.links)
// <token> is baker_campaign_sends.track_token (one per email sent). The
// click redirect goes only to that campaign's own button destination,
// worked out here from the campaign row — never to a URL taken from the
// request — so this can't be used as an open redirect.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FALLBACK = "https://bakeriapp.com/";

// 1×1 transparent GIF.
const PIXEL = Uint8Array.from(atob("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"), (c) => c.charCodeAt(0));

function pixel() {
  return new Response(PIXEL, {
    headers: {
      "Content-Type": "image/gif",
      "Cache-Control": "no-store, no-cache, must-revalidate, private",
    },
  });
}

function redirect(url: string) {
  return new Response(null, { status: 302, headers: { Location: url, "Cache-Control": "no-store" } });
}

/** Same destination send-baker-campaign gives the button. */
export async function campaignDestination(db: ReturnType<typeof createClient>, campaignId: string): Promise<string> {
  const { data: c } = await db.from("baker_campaigns")
    .select("user_id, cta_url, cta_listing_id").eq("id", campaignId).maybeSingle();
  if (!c) return FALLBACK;
  if (c.cta_url && /^https?:\/\//i.test(c.cta_url)) return c.cta_url;
  const { data: p } = await db.from("profiles").select("profile_slug").eq("id", c.user_id).maybeSingle();
  if (!p?.profile_slug) return FALLBACK;
  return c.cta_listing_id
    ? `https://bakeriapp.com/${p.profile_slug}?item=${c.cta_listing_id}`
    : `https://bakeriapp.com/${p.profile_slug}`;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "GET" && req.method !== "HEAD") return new Response(null, { status: 405 });
  const url = new URL(req.url);
  const kind = url.searchParams.get("e") === "c" ? "click" : "open";
  const token = url.searchParams.get("t") ?? "";
  if (!UUID_RE.test(token)) return kind === "click" ? redirect(FALLBACK) : pixel();

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  let campaignId: string | null = null;
  try {
    // HEAD requests (link checkers) don't count.
    if (req.method === "GET") {
      const { data } = await db.rpc("record_campaign_event", { p_token: token, p_kind: kind });
      campaignId = (data as string | null) ?? null;
    } else {
      const { data } = await db.from("baker_campaign_sends").select("campaign_id").eq("track_token", token).maybeSingle();
      campaignId = data?.campaign_id ?? null;
    }
  } catch (e) {
    console.error("campaign-track:", e instanceof Error ? e.message : e);
  }

  if (kind === "open") return pixel();
  if (!campaignId) return redirect(FALLBACK);
  const linkIndex = url.searchParams.get("l");
  if (linkIndex !== null && /^\d{1,4}$/.test(linkIndex)) {
    const { data: c } = await db.from("baker_campaigns").select("links").eq("id", campaignId).maybeSingle();
    const target = Array.isArray(c?.links) ? c.links[Number(linkIndex)] : null;
    return redirect(typeof target === "string" && /^https?:\/\//i.test(target) ? target : await campaignDestination(db, campaignId));
  }
  return redirect(await campaignDestination(db, campaignId));
});
