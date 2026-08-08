// Shared HTML-building blocks for every guest-facing "money" email in the
// custom-order lifecycle — the quote (send-guest-quote-email), the balance
// invoice (send-invoice-email), and the payment receipt
// (guestReceiptEmail.ts) — so all three read as one product instead of
// three templates that drifted apart from being written at different times
// (2026-08-07: Harvey flagged the quote email looked nothing like the
// receipt email). Every future change to the shared shell/item-row shape
// only needs to happen here.

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

export interface ReceiptItemInput {
  custom_name: string;
  quantity: number;
  price_per_unit: number;
  menu_item_id: string | null;
  variant_breakdown?: { name: string; quantity: number }[] | null;
}

// order_items.menu_item_id exists but is populated on 0 of 430 rows today
// (2026-08-07 audit) — falls back to an exact, case-insensitive name match
// against the baker's own listings, scoped to bakerId and only trusted when
// it resolves to exactly one row, so a generic item name can't pull in the
// wrong baker's/wrong item's photo.
// deno-lint-ignore no-explicit-any
export async function resolveItemImageUrl(db: any, bakerId: string, item: ReceiptItemInput): Promise<string | null> {
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const STORAGE_URL = `${SUPABASE_URL}/storage/v1/object/public`;

  let menuItemId = item.menu_item_id;
  if (!menuItemId) {
    const { data } = await db
      .from("menu_items")
      .select("id, has_image")
      .eq("user_id", bakerId)
      .ilike("name", item.custom_name)
      .is("deleted_at", null)
      .limit(2);
    if (data?.length === 1 && data[0].has_image) menuItemId = data[0].id;
    else return null;
  } else {
    const { data } = await db.from("menu_items").select("has_image").eq("id", menuItemId).maybeSingle();
    if (!data?.has_image) return null;
  }
  return `${STORAGE_URL}/menu-item-images/${bakerId.toUpperCase()}/${String(menuItemId).toUpperCase()}.jpg`;
}

// A "$X" price only makes unambiguous sense next to a single item — a
// multi-item order under one flat quote can't be split back into per-item
// prices, so those rows show no price at all and the real total lives in
// the breakdown table below instead. Never shows the listing's raw
// per-unit price once a quote overrides it — "if the quote establishes a
// price, that must be the shown price" (Harvey, 2026-08-07).
export async function renderReceiptItemsHtml(
  // deno-lint-ignore no-explicit-any
  db: any,
  bakerId: string,
  items: ReceiptItemInput[],
  hasQuote: boolean,
  quoteTotalCents: number
): Promise<string> {
  const images = await Promise.all(items.map((i) => resolveItemImageUrl(db, bakerId, i)));
  return items
    .map((i, idx) => {
      const lineCents = hasQuote
        ? (items.length === 1 ? quoteTotalCents : null)
        : (i.price_per_unit ? Math.round(i.price_per_unit * i.quantity * 100) : null);
      const imageUrl = images[idx];
      const imageHtml = imageUrl
        ? `<img src="${imageUrl}" width="56" height="56" style="width:56px;height:56px;border-radius:10px;object-fit:cover;display:block;" alt="" />`
        : `<div style="width:56px;height:56px;border-radius:10px;background:#F0E9DC;"></div>`;
      // Assorted Box flavor mix — a snapshot taken at checkout, so it stays
      // accurate even if the baker later edits the listing (same data
      // MarketplaceOrderSheet's own item rows show).
      const variantHtml = Array.isArray(i.variant_breakdown) && i.variant_breakdown.length > 0
        ? `<div style="font-size:11.5px;color:#A89B8C;margin-top:2px;">${i.variant_breakdown.map((v) => `${v.quantity}× ${escapeHtml(v.name)}`).join(", ")}</div>`
        : "";
      return `<tr>
        <td style="width:56px;padding:10px 0;vertical-align:top;">${imageHtml}</td>
        <td style="padding:10px 0 10px 12px;vertical-align:top;">
          <div style="font-size:14.5px;font-weight:600;color:#241712;">${escapeHtml(i.custom_name)}</div>
          <div style="font-size:12.5px;color:#A89B8C;margin-top:2px;">${i.quantity}×</div>
          ${variantHtml}
          ${lineCents != null ? `<div style="font-size:13.5px;font-weight:700;color:#241712;margin-top:6px;">${formatCents(lineCents)}</div>` : ""}
        </td>
      </tr>`;
    })
    .join("");
}

export interface ReceiptShellParams {
  docType: string;          // top label: "Quote" / "Invoice" / "Receipt"
  bakerName: string;        // shown big, right under the doc-type label — this is a
  bakerUrl: string;         // transaction with the BAKER, not with Bakeri; burying that
                             // in a meta line risks the guest thinking Bakeri is the seller.
  metaRowsHtml: string;     // pre-built <tr> rows: date / order id / email
  heading: string;          // sentence-style heading right above the items ("Your quote is ready", "Balance received"...)
  itemsHtml: string;
  afterItemsHtml?: string;  // optional extra content between the items and the second section (e.g. the quote email's baker note / "what you requested" block)
  sectionTitle?: string;    // second section's title — "Billing and Payment" everywhere except the pickup-ready email ("Pickup Details")
  sectionSubRowHtml: string; // customer name row (or pickup-window row) under the second section
  breakdownRowsHtml: string;
  footerHtml: string;       // CTA button block OR a "Paid by..." bar
  legalHtml: string;
}

// Same shell for every email in the order lifecycle: Bakerï wordmark (small
// — this is Bakeri's own branding on the email, not the seller), doc-type
// label, the baker's name prominent right under it (this is who the guest
// is actually buying from), meta block, a divider, the event heading + item
// rows, another divider, a second section (title defaults to "Billing and
// Payment" — the anchor that makes the quote/invoice/receipt trio read as
// one sequence; overridden to "Pickup Details" for the ready-for-pickup
// email, which isn't about money at all), the breakdown, and a
// type-specific footer/legal note.
export function renderReceiptShell(p: ReceiptShellParams): string {
  return `
    <div style="font-family:-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:28px 24px;color:#241712;background:#fff;">
      <div style="font-size:13px;font-weight:700;letter-spacing:.04em;color:#A89B8C;text-transform:uppercase;">Bakerï</div>
      <h1 style="margin:14px 0 2px;font-size:26px;">${escapeHtml(p.docType)}</h1>
      <div style="font-size:15px;margin-bottom:14px;"><a href="${p.bakerUrl}" style="color:#6B5F54;text-decoration:none;">from <strong style="color:#241712;">${escapeHtml(p.bakerName)}</strong></a></div>
      <table style="width:100%;border-collapse:collapse;font-size:13px;color:#6B5F54;">
        ${p.metaRowsHtml}
      </table>

      <div style="height:1px;background:#E4D9C8;margin:20px 0;"></div>

      <div style="font-size:20px;font-weight:700;margin-bottom:6px;">${escapeHtml(p.heading)}</div>
      <table style="width:100%;border-collapse:collapse;">
        ${p.itemsHtml}
      </table>
      ${p.afterItemsHtml ?? ""}

      <div style="height:1px;background:#E4D9C8;margin:20px 0;"></div>

      <div style="font-size:15px;font-weight:700;margin-bottom:10px;">${escapeHtml(p.sectionTitle ?? "Billing and Payment")}</div>
      <table style="width:100%;border-collapse:collapse;font-size:13.5px;color:#241712;margin-bottom:14px;">
        ${p.sectionSubRowHtml}
      </table>
      <table style="width:100%;border-collapse:collapse;">
        ${p.breakdownRowsHtml}
      </table>

      <div style="height:1px;background:#E4D9C8;margin:14px 0 0;"></div>
      ${p.footerHtml}
      ${p.legalHtml}
    </div>
  `;
}

export function metaRow(label: string, valueHtml: string): string {
  return `<tr><td style="padding:2px 0;">${label ? `<strong style="color:#241712;">${escapeHtml(label)}:</strong> ` : ""}${valueHtml}</td></tr>`;
}
