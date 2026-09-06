import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Re-mints fresh signed download URLs for an already-paid digital purchase
// and (optionally) re-sends the delivery email.
//
// Why this exists: finalize-guest-digital-order / -digital-physical-order
// mint a Storage signed URL exactly ONCE, at purchase time, and hand it to
// the buyer inline + by email. A guest has no session, so there was no way
// to get that link back once it lapsed — every expired link was a manual
// support job with nothing to hand over. The underlying file never goes
// anywhere (it lives on the baker's menu_items row, keyed by
// digital_file_path); only the URL token dies. This function walks an
// order's items back to that file and signs a new URL.
//
// "Is this a digital order?" is decided by whether its line items resolve to
// a digital listing's file — NOT by fulfillment_type, which gets corrupted
// to 'Pickup' on older app builds (see the 2026-08-24 SUPPORT_LOG entry).
//
// Modes (in the request body):
//   { order_id }                 — one order
//   { customer_email }           — every marketplace order for that buyer
//                                  whose items resolve to digital files
//   { all: true, ... }           — sweep every marketplace order; those that
//                                  resolve no digital files are skipped
//                                  (paged via limit/offset; secret-gated)
// Flags:
//   dry_run     — resolve + report only; mint nothing, email nothing
//   send_email  — default true; false = mint + return URLs without emailing
//   limit/offset — only for customer_email / all modes (default 50, max 200)
//
// Auth, three principals:
//   1. Operator — x-webhook-secret unlocks everything (all-mode, dry_run, and
//      URLs echoed in the response). That's how an operator runs it.
//   2. Baker — a signed-in baker's user JWT in Authorization. Scoped to a
//      single order_id that the baker must own (orders.user_id === their uid,
//      else 403). Always mints + emails the customer; the response reports
//      what resolved / what didn't and whether the email went out, but never
//      echoes signed URLs. This is the "Resend Download Email" button in
//      MarketplaceOrderSheet.
//   3. Public — no secret, no user JWT (anon key or nothing). A locked-down
//      "resend my own links to my own inbox" endpoint: order_id or
//      customer_email only, always emails, never echoes a URL or even
//      confirms the order exists (so it can't be used to enumerate purchases
//      or harvest someone else's files). Here so a storefront "resend my
//      download" button can be wired to it later.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const WEBHOOK_SECRET = Deno.env.get("BAKERI_WEBHOOK_SECRET")!;

// Keep in sync with finalize-guest-digital-order / -digital-physical-order.
const SIGNED_URL_EXPIRY_SECONDS = 60 * 60 * 24 * 365; // 1 year

const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-webhook-secret",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function orderReference(orderId: string): string {
  return orderId.replace(/-/g, "").slice(0, 8).toUpperCase();
}

// Same as finalize-guest-digital-order.buildDownloadFilename — names the saved
// file after the item, not the content-hashed storage path.
function buildDownloadFilename(itemName: string, filePath: string): string {
  const ext = (filePath.split(".").pop() || "").toLowerCase();
  const safeName = (itemName || "download").replace(/[\/\\?%*:|"<>]/g, "-").trim() || "download";
  return ext && ext !== filePath ? `${safeName}.${ext}` : safeName;
}

// One entry per order line — NOT deduped by file. A buyer who ordered three
// things should get three buttons, each labelled with what she actually
// bought (item_name), even when two of them are variants sharing one
// uploaded file. The handler signs each distinct file once and reuses the
// URL across the lines that point at it.
interface ResolvedLine {
  item_name: string; // the buyer's own cart line, incl. any variant suffix
  file_path: string;
  menu_item_id: string | null; // the listing this resolved to, for the email's photo
}
interface Unresolved {
  custom_name: string;
  reason: string;
}

// deno-lint-ignore no-explicit-any
type Db = any;

async function resolveOrderFiles(
  db: Db,
  order: { id: string; user_id: string },
): Promise<{ lines: ResolvedLine[]; unresolved: Unresolved[] }> {
  const { data: items } = await db
    .from("order_items")
    .select("custom_name, menu_item_id")
    .eq("order_id", order.id)
    .is("deleted_at", null);

  // The baker's digital listings that still have a file — fetched once for
  // the whole order rather than per line.
  const { data: listingRows } = await db
    .from("menu_items")
    .select("id, name, digital_file_path")
    .eq("user_id", order.user_id)
    .eq("listing_kind", "digital")
    .is("deleted_at", null);
  const digitalListings: { id: string; name: string; digital_file_path: string }[] =
    (listingRows ?? []).filter((l: { digital_file_path: string | null }) => l.digital_file_path);

  const lines: ResolvedLine[] = [];
  const unresolved: Unresolved[] = [];
  const seen = new Set<string>(); // collapse only exact (name + file) dupes

  const add = (itemName: string, filePath: string, menuItemId: string | null) => {
    const key = `${itemName} ${filePath}`;
    if (seen.has(key)) return;
    seen.add(key);
    lines.push({ item_name: itemName, file_path: filePath, menu_item_id: menuItemId });
  };

  for (const item of items ?? []) {
    const customName: string = (item.custom_name ?? "").trim();

    // 1. Direct link — order_items.menu_item_id, recorded on orders placed
    // after 2026-08-28.
    if (item.menu_item_id) {
      const direct = digitalListings.find((l) => l.id === item.menu_item_id);
      if (direct) {
        add(customName || direct.name, direct.digital_file_path, direct.id);
        continue;
      }
      // menu_item_id set but not one of this baker's current digital
      // listings (converted/deleted) — fall through to a name match.
    }

    // 2. Name match. custom_name is either the listing name exactly, or the
    // listing name followed by a variant suffix — the separator has varied
    // over time (" — Pink", "-pink set", " | Large"), so match any listing
    // whose name is custom_name or a separator-delimited prefix of it, and
    // take the longest (most specific) such match when it's unambiguous.
    const lc = customName.toLowerCase();
    const prefixed = digitalListings.filter((l) => {
      const n = l.name.toLowerCase().trim();
      if (!n) return false;
      if (lc === n) return true;
      return lc.startsWith(n) && /^[\s\-—|:/]/.test(lc.slice(n.length));
    });
    const maxLen = prefixed.reduce((m, c) => Math.max(m, c.name.trim().length), 0);
    const best = prefixed.filter((c) => c.name.trim().length === maxLen);

    const distinctFiles = [...new Set(best.map((b) => b.digital_file_path))];
    if (best.length === 0) {
      unresolved.push({ custom_name: customName, reason: "no matching digital listing with a file (deleted, renamed, or file removed)" });
    } else if (distinctFiles.length === 1) {
      add(customName || best[0].name, best[0].digital_file_path, best[0].id);
    } else {
      // Genuine ambiguity: the baker has >1 listing with this exact name
      // pointing at different files (usually an accidental duplicate upload —
      // e.g. a PDF and a PNG of the same printable). We can't know which the
      // buyer meant, so hand over every candidate rather than short her.
      for (const b of best) add(customName || b.name, b.digital_file_path, b.id);
    }
  }

  return { lines, unresolved };
}

async function sendDeliveryEmail(orderId: string, downloads: { item_name: string; download_url: string }[]): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 500 * attempt));
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/send-guest-digital-delivery-email`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": SUPABASE_ANON_KEY,
          "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ order_id: orderId, downloads }),
      });
      if (res.ok) return true;
    } catch { /* retry */ }
  }
  return false;
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

  const isOperator = req.headers.get("x-webhook-secret") === WEBHOOK_SECRET;

  // Baker-authenticated path: a signed-in baker reissuing links for one of
  // their own orders. Triggered only by a real user JWT — the anon key (or
  // no Authorization at all) falls straight through to the public path
  // below, unchanged. A malformed/expired user token is rejected rather
  // than silently downgraded to public.
  let bakerUserId: string | null = null;
  if (!isOperator) {
    const authHeader = req.headers.get("Authorization");
    if (authHeader && authHeader !== `Bearer ${SUPABASE_ANON_KEY}`) {
      const authedClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user }, error: authErr } = await authedClient.auth.getUser();
      if (authErr || !user) return json({ error: "Unauthorized" }, 401);
      bakerUserId = user.id;
    }
  }
  const isBaker = bakerUserId !== null;

  const orderId = String(body.order_id ?? "").trim();
  const customerEmail = String(body.customer_email ?? "").trim().toLowerCase();
  const sweepAll = body.all === true;
  const dryRun = isOperator && body.dry_run === true;
  const sendEmail = isOperator ? body.send_email !== false : true;
  const since = String(body.since ?? "").trim(); // ISO date, all-mode filter
  const limit = Math.min(200, Math.max(1, Number(body.limit) || 50));
  const offset = Math.max(0, Number(body.offset) || 0);

  if (sweepAll && !isOperator) return json({ error: "Not authorized for sweep mode." }, 403);
  if (isBaker && !orderId) {
    return json({ error: "Provide order_id." }, 400);
  }
  if (!sweepAll && !orderId && !customerEmail) {
    return json({ error: "Provide order_id or customer_email (or all:true with the operator secret)." }, 400);
  }
  if (customerEmail && !EMAIL_RE.test(customerEmail)) {
    return json({ error: "Invalid customer_email." }, 400);
  }

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // ---- gather target orders -------------------------------------------------
  // Deliberately NOT filtered on fulfillment_type = 'Digital'. A digital
  // marketplace order that synced to a baker whose app build predates the
  // FulfillmentType.digital fix gets silently relabeled 'Pickup' (and shows
  // pickup UI). Those still need their downloads re-issued, so "is this a
  // digital order?" is decided by whether its items resolve to a digital
  // listing's file (resolveOrderFiles), not by this column. An order that
  // resolves zero files is treated as genuinely non-digital and skipped.
  let q = db
    .from("orders")
    .select("id, user_id, order_name, customer_email, created_at, fulfillment_type")
    .eq("order_source", "marketplace");

  if (orderId) {
    q = q.eq("id", orderId);
  } else if (customerEmail) {
    q = q.eq("customer_email", customerEmail).order("created_at", { ascending: false }).range(offset, offset + limit - 1);
  } else {
    // sweep
    if (since) q = q.gte("created_at", since);
    q = q.order("created_at", { ascending: false }).range(offset, offset + limit - 1);
  }

  const { data: orders, error: ordersErr } = await q;
  if (ordersErr) {
    console.error("orders lookup failed:", ordersErr.message);
    return json({ error: "Lookup failed." }, 500);
  }

  // Baker path: an order_id that resolves nothing is "not found or not
  // yours" — same 403 as an order that exists but belongs to someone else.
  if (isBaker && (!orders || orders.length === 0)) {
    return json({ error: "Order not found or not yours." }, 403);
  }

  // Public path: never confirm whether the order/buyer exists.
  if (!isOperator && !isBaker && (!orders || orders.length === 0)) {
    return json({ ok: true, message: "If a matching purchase exists, fresh links are on their way to the email on file." });
  }
  if (!orders || orders.length === 0) {
    return json({ ok: true, orders: [], summary: { orders: 0, fully_resolved: 0, partial: 0, failed: 0 } });
  }

  // If order_id was given alongside customer_email, enforce the pairing.
  let scoped = orderId && customerEmail
    ? orders.filter((o: { customer_email: string }) => (o.customer_email ?? "").toLowerCase() === customerEmail)
    : orders;

  // Baker path: the order must belong to the caller. Same 403 whether the
  // order isn't theirs or doesn't exist, so this can't be used to probe.
  if (isBaker) {
    scoped = scoped.filter((o: { user_id: string }) => o.user_id === bakerUserId);
    if (scoped.length === 0) return json({ error: "Order not found or not yours." }, 403);
  }

  // ---- process ------------------------------------------------------------
  const results: Record<string, unknown>[] = [];
  let fullyResolved = 0, partial = 0, failed = 0, emailedCount = 0;

  const isSweep = !orderId && !customerEmail;

  for (const order of scoped) {
    const { lines, unresolved } = await resolveOrderFiles(db, order);

    if (lines.length === 0) {
      // Sweep scans every marketplace order — a genuine pickup/shipping
      // order resolves nothing and is simply not our concern, so don't
      // report it or count it as a failure. An explicitly named order or
      // buyer email that resolves nothing IS worth surfacing.
      if (isSweep) continue;
      failed++;
      results.push({
        order_id: order.id,
        order_reference: orderReference(order.id),
        customer_email: order.customer_email,
        order_name: order.order_name,
        fulfillment_type: order.fulfillment_type,
        downloads: [],
        unresolved,
        emailed: false,
        error: "No digital-listing files could be resolved for this order — is it actually a digital purchase?",
      });
      continue;
    }

    // Sign each distinct file once; a variant line that shares a file reuses
    // the URL. The per-line `&download=` name (what lands in the buyer's
    // Downloads folder) is appended after signing — the token covers the
    // path + expiry, not the query string — so two lines on one file each
    // save under their own item name.
    const signedByPath = new Map<string, string>();
    let signFailed = false;
    for (const path of new Set(lines.map((l) => l.file_path))) {
      if (dryRun) { signedByPath.set(path, `(dry run — would sign ${path})`); continue; }
      const { data: signed, error: signErr } = await db.storage
        .from("digital-products")
        .createSignedUrl(path, SIGNED_URL_EXPIRY_SECONDS);
      if (signErr || !signed?.signedUrl) {
        console.error("createSignedUrl failed:", order.id, path, signErr?.message);
        signFailed = true;
        break;
      }
      signedByPath.set(path, signed.signedUrl);
    }

    const downloads = signFailed ? [] : lines.map((l) => {
      const base = signedByPath.get(l.file_path)!;
      const url = dryRun ? base : `${base}&download=${encodeURIComponent(buildDownloadFilename(l.item_name, l.file_path))}`;
      return { item_name: l.item_name, download_url: url, menu_item_id: l.menu_item_id };
    });

    if (signFailed) {
      failed++;
      results.push({
        order_id: order.id, order_reference: orderReference(order.id), customer_email: order.customer_email,
        order_name: order.order_name, downloads: [], unresolved, emailed: false,
        error: "Storage could not sign the file (still exists in the bucket?).",
      });
      continue;
    }

    let emailed = false;
    if (sendEmail && !dryRun) emailed = await sendDeliveryEmail(order.id, downloads);
    if (emailed) emailedCount++;

    if (unresolved.length === 0) fullyResolved++; else partial++;

    results.push({
      order_id: order.id,
      order_reference: orderReference(order.id),
      customer_email: order.customer_email,
      order_name: order.order_name,
      fulfillment_type: order.fulfillment_type,
      // Public path never echoes URLs; operator path always does.
      downloads: isOperator ? downloads : downloads.map((d) => ({ item_name: d.item_name })),
      unresolved,
      emailed,
    });
  }

  if (!isOperator && !isBaker) {
    // Public path only. Only claim a send if one actually happened —
    // otherwise stay vague so this can't be used to probe which emails have
    // purchases. The baker path falls through to the detailed response
    // below (still URL-free — that's gated on isOperator).
    return json({
      ok: true,
      message: emailedCount > 0
        ? "Fresh links have been emailed to the address on file."
        : "If a matching purchase exists, fresh links are on their way to the email on file.",
    });
  }

  return json({
    ok: true,
    dry_run: dryRun,
    mode: orderId ? "order" : customerEmail ? "buyer" : "sweep",
    page: orderId ? undefined : { limit, offset, returned: scoped.length },
    orders: results,
    summary: { orders: scoped.length, fully_resolved: fullyResolved, partial, failed },
  });
});
