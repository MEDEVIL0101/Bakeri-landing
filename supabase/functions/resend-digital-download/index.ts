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
// Modes (in the request body):
//   { order_id }                 — one order
//   { customer_email }           — every completed digital order for that buyer
//   { all: true, ... }           — sweep every completed digital order
//                                  (paged via limit/offset; secret-gated)
// Flags:
//   dry_run     — resolve + report only; mint nothing, email nothing
//   send_email  — default true; false = mint + return URLs without emailing
//   limit/offset — only for customer_email / all modes (default 50, max 200)
//
// Auth: pass x-webhook-secret to unlock everything (all-mode, dry_run, and
// URLs echoed in the response — that's how an operator runs it). Without the
// secret it's a locked-down "resend my own links to my own inbox" endpoint:
// order_id or customer_email only, always emails, never echoes a URL or even
// confirms the order exists (so it can't be used to enumerate purchases or
// harvest someone else's files). That public path is here so a storefront
// "resend my download" button can be wired to it later.

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

// order_items.custom_name for a variant line is "Listing Name — Option"
// (see finalize-guest-digital-order). Strip the option to match the listing.
function listingNameFromCustomName(customName: string): string {
  const dash = customName.indexOf(" — ");
  return (dash === -1 ? customName : customName.slice(0, dash)).trim();
}

interface ResolvedFile {
  file_path: string;
  item_name: string;
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
): Promise<{ files: ResolvedFile[]; unresolved: Unresolved[] }> {
  const { data: items } = await db
    .from("order_items")
    .select("custom_name, menu_item_id")
    .eq("order_id", order.id)
    .is("deleted_at", null);

  const files = new Map<string, ResolvedFile>(); // dedupe by file_path
  const unresolved: Unresolved[] = [];

  for (const item of items ?? []) {
    const customName: string = item.custom_name ?? "";

    // 1. Direct link (recorded on orders placed after 2026-08-28).
    if (item.menu_item_id) {
      const { data: mi } = await db
        .from("menu_items")
        .select("name, listing_kind, digital_file_path")
        .eq("id", item.menu_item_id)
        .maybeSingle();
      if (mi?.listing_kind === "digital" && mi.digital_file_path) {
        files.set(mi.digital_file_path, {
          file_path: mi.digital_file_path,
          item_name: mi.name || listingNameFromCustomName(customName),
        });
        continue;
      }
    }

    // 2. Fall back to an exact, case-insensitive listing-name match against
    // the baker's own digital listings — trusted only when it's unambiguous
    // (mirrors resolve_order_item_image_id).
    const listingName = listingNameFromCustomName(customName);
    // ilike treats % _ \ as wildcards — escape so this stays an exact
    // (case-insensitive) match, not a pattern.
    const escaped = listingName.replace(/([\\%_])/g, "\\$1");
    const { data: matches } = await db
      .from("menu_items")
      .select("name, digital_file_path")
      .eq("user_id", order.user_id)
      .eq("listing_kind", "digital")
      .is("deleted_at", null)
      .ilike("name", escaped);
    const withFile = (matches ?? []).filter((m: { digital_file_path: string | null }) => m.digital_file_path);

    if (withFile.length === 1) {
      files.set(withFile[0].digital_file_path, {
        file_path: withFile[0].digital_file_path,
        item_name: withFile[0].name || listingName,
      });
    } else if (withFile.length === 0) {
      unresolved.push({ custom_name: customName, reason: "no matching digital listing with a file (deleted or file removed?)" });
    } else {
      unresolved.push({ custom_name: customName, reason: `${withFile.length} listings named "${listingName}" — can't tell which file` });
    }
  }

  return { files: [...files.values()], unresolved };
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

  const orderId = String(body.order_id ?? "").trim();
  const customerEmail = String(body.customer_email ?? "").trim().toLowerCase();
  const sweepAll = body.all === true;
  const dryRun = isOperator && body.dry_run === true;
  const sendEmail = isOperator ? body.send_email !== false : true;
  const since = String(body.since ?? "").trim(); // ISO date, all-mode filter
  const limit = Math.min(200, Math.max(1, Number(body.limit) || 50));
  const offset = Math.max(0, Number(body.offset) || 0);

  if (sweepAll && !isOperator) return json({ error: "Not authorized for sweep mode." }, 403);
  if (!sweepAll && !orderId && !customerEmail) {
    return json({ error: "Provide order_id or customer_email (or all:true with the operator secret)." }, 400);
  }
  if (customerEmail && !EMAIL_RE.test(customerEmail)) {
    return json({ error: "Invalid customer_email." }, 400);
  }

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // ---- gather target orders -------------------------------------------------
  let q = db
    .from("orders")
    .select("id, user_id, order_name, customer_email, created_at")
    .eq("fulfillment_type", "Digital")
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

  // Public path: never confirm whether the order/buyer exists.
  if (!isOperator && (!orders || orders.length === 0)) {
    return json({ ok: true, message: "If a matching purchase exists, fresh links are on their way to the email on file." });
  }
  if (!orders || orders.length === 0) {
    return json({ ok: true, orders: [], summary: { orders: 0, fully_resolved: 0, partial: 0, failed: 0 } });
  }

  // If order_id was given alongside customer_email, enforce the pairing.
  const scoped = orderId && customerEmail
    ? orders.filter((o: { customer_email: string }) => (o.customer_email ?? "").toLowerCase() === customerEmail)
    : orders;

  // ---- process ------------------------------------------------------------
  const results: Record<string, unknown>[] = [];
  let fullyResolved = 0, partial = 0, failed = 0;

  for (const order of scoped) {
    const { files, unresolved } = await resolveOrderFiles(db, order);

    if (files.length === 0) {
      failed++;
      results.push({
        order_id: order.id,
        order_reference: orderReference(order.id),
        customer_email: order.customer_email,
        order_name: order.order_name,
        downloads: [],
        unresolved,
        emailed: false,
        error: "No files could be resolved for this order.",
      });
      continue;
    }

    const downloads: { item_name: string; download_url: string }[] = [];
    let signFailed = false;
    for (const f of files) {
      if (dryRun) {
        downloads.push({ item_name: f.item_name, download_url: `(dry run — would sign ${f.file_path})` });
        continue;
      }
      const { data: signed, error: signErr } = await db.storage
        .from("digital-products")
        .createSignedUrl(f.file_path, SIGNED_URL_EXPIRY_SECONDS, { download: buildDownloadFilename(f.item_name, f.file_path) });
      if (signErr || !signed?.signedUrl) {
        console.error("createSignedUrl failed:", order.id, f.file_path, signErr?.message);
        signFailed = true;
        break;
      }
      downloads.push({ item_name: f.item_name, download_url: signed.signedUrl });
    }

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

    if (unresolved.length === 0) fullyResolved++; else partial++;

    results.push({
      order_id: order.id,
      order_reference: orderReference(order.id),
      customer_email: order.customer_email,
      order_name: order.order_name,
      // Public path never echoes URLs; operator path always does.
      downloads: isOperator ? downloads : downloads.map((d) => ({ item_name: d.item_name })),
      unresolved,
      emailed,
    });
  }

  if (!isOperator) {
    return json({ ok: true, message: "Fresh links have been emailed to the address on file." });
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
