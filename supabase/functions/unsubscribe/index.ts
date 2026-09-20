import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Public, unauthenticated, GET-only — this is the target of the one-click
// unsubscribe link every campaign/promotional email must carry (see
// baker_contacts.unsubscribe_token). Opened directly in a browser from an
// email client, so it returns a plain HTML page, not JSON. No auth, no
// confirmation step beyond the click itself — matches standard one-click
// unsubscribe expectations (RFC 8058 / mailbox-provider list-unsubscribe
// conventions), not a "are you sure" flow.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function page(title: string, message: string, status = 200) {
  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  body { font-family: -apple-system, sans-serif; max-width: 420px; margin: 80px auto; padding: 0 24px;
         color: #241712; text-align: center; }
  h1 { font-size: 22px; margin-bottom: 8px; }
  p { color: #6B5F54; font-size: 15px; line-height: 1.5; }
</style></head>
<body><h1>${title}</h1><p>${message}</p></body></html>`;
  return new Response(html, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "GET") return page("Method not allowed", "", 405);

  const token = new URL(req.url).searchParams.get("token") ?? "";
  if (!UUID_RE.test(token)) {
    return page("Link not valid", "This unsubscribe link is missing or malformed.", 400);
  }

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data, error } = await db
    .from("baker_contacts")
    .update({ unsubscribed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("unsubscribe_token", token)
    .select("id")
    .maybeSingle();

  if (error || !data) {
    // Already-unsubscribed or unknown token both land here — same message
    // either way, since "already done" and "never existed" look identical
    // from a visitor's side and neither needs different handling.
    return page("You're unsubscribed", "This link has already been used or is no longer active. You won't receive further emails from this address.");
  }

  return page("You're unsubscribed", "You won't receive further promotional emails from this baker. Transactional emails about orders you've actually placed are unaffected.");
});
