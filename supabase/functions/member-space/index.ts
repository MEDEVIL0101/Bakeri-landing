import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { escapeHtml } from "../_shared/receiptEmailStyle.ts";
import { customerEmailIdentity } from "../_shared/senderIdentity.ts";
import { sendEmail } from "../_shared/resend.ts";
import { COURSE_PAGE, courseURL } from "../_shared/course.ts";
import { UUID_RE, memberSession, resolveAccess, type Access } from "../_shared/memberAccess.ts";
import { resolveBakerEmail } from "../_shared/bakerEmail.ts";
import { postWithRetry } from "../_shared/postWithRetry.ts";

// Member spaces (migration 20261107000001) — sign-in and the channel behind
// baker/course.html. Public; each action checks its own credential.
//
// Sign-in (email code):
//   { send_code: true, baker_id, email }        → emails a 6-digit code if that
//                                                 email has anything with the shop
//                                                 (always answers ok)
//   { verify_code: true, baker_id, email, code } → { session, spaces }
//   { spaces: true, session }                   → { spaces, email }
//   { sign_out: true, session }
//
// Channel (one per course/club; access = token | session+menu_item_id |
// owner+menu_item_id, see _shared/memberAccess.ts):
//   { channel: "list", ..., before?, thread? }   → { messages, pinned, me }
//   { channel: "post", ..., body, parent_id?, is_update?, attachments? }
//   { channel: "react", ..., message_id, emoji }  (toggles)
//   { channel: "pin", ..., message_id, pinned }   owner only
//   { channel: "delete", ..., message_id }        owner, or the author
//   { channel: "edit", ..., message_id, body }    the author
// deno-lint-ignore-file no-explicit-any

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const WEBHOOK_SECRET = Deno.env.get("BAKERI_WEBHOOK_SECRET")!;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PAGE = 50;
const MAX_BODY = 8000;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
}

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function shopOf(db: any, bakerId: string) {
  const { data } = await db.from("profiles").select("business_name, user_name, profile_slug").eq("id", bakerId).maybeSingle();
  return { name: data?.business_name || data?.user_name || "", slug: data?.profile_slug ?? null };
}

function emailShell(title: string, inner: string, footer: string): string {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head>
<body style="margin:0;padding:0;background-color:#f3ecdd;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f3ecdd;"><tr><td align="center" style="padding:28px 12px;">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px;">
  <tr><td style="background-color:#ffffff;border-radius:18px;padding:32px 32px 28px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;color:#3d353f;">
    <h1 style="margin:0 0 12px;font-size:22px;line-height:1.3;color:#14110e;">${title}</h1>
    ${inner}
  </td></tr>
  <tr><td align="center" style="padding:18px 12px 4px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:12px;line-height:1.6;color:#8a7f88;">${footer}</td></tr>
</table></td></tr></table></body></html>`;
}

/** Everything this email can open with the shop. */
async function spacesFor(db: any, bakerId: string, email: string) {
  const { data } = await db.from("course_enrollments")
    .select("menu_item_id, created_at, revoked_at, cancel_at, paid_through, stripe_subscription_id, menu_items(id, name, is_club, club_interval, has_image, updated_at, deleted_at)")
    .eq("user_id", bakerId).ilike("email", email).is("revoked_at", null);
  return (data ?? [])
    .filter((e: any) => e.menu_items && !e.menu_items.deleted_at)
    .map((e: any) => ({
      menu_item_id: e.menu_item_id, name: e.menu_items.name, is_club: !!e.menu_items.is_club,
      interval: e.stripe_subscription_id ? e.menu_items.club_interval : null,
      image_url: e.menu_items.has_image ? `${SUPABASE_URL}/storage/v1/object/public/menu-item-images/${String(bakerId).toUpperCase()}/${String(e.menu_item_id).toUpperCase()}.jpg` : null,
      joined_at: e.created_at, cancel_at: e.cancel_at,
    }));
}

function publicMessage(m: any, access: Access, reactions: any[]) {
  const mine = m.enrollment_id ? m.enrollment_id === access.actor : access.owner;
  const counts: Record<string, { n: number; me: boolean }> = {};
  for (const r of reactions.filter((r) => r.message_id === m.id)) {
    counts[r.emoji] ??= { n: 0, me: false };
    counts[r.emoji].n++;
    if (r.actor === access.actor) counts[r.emoji].me = true;
  }
  return {
    id: m.id, parent_id: m.parent_id, body: m.deleted_at ? "" : m.body, attachments: m.deleted_at ? [] : (m.attachments ?? []),
    author: m.enrollment_id ? (m.author_name || "Member") : m.author_name, from_shop: !m.enrollment_id, mine,
    is_pinned: m.is_pinned, is_update: m.is_update, reply_count: m.reply_count, last_reply_at: m.last_reply_at,
    created_at: m.created_at, edited_at: m.edited_at, deleted: !!m.deleted_at,
    reactions: Object.entries(counts).map(([emoji, c]) => ({ emoji, count: c.n, me: c.me })),
  };
}

async function withReactions(db: any, rows: any[], access: Access) {
  const ids = rows.map((r) => r.id);
  const { data: reactions } = ids.length
    ? await db.from("channel_reactions").select("message_id, actor, emoji").in("message_id", ids)
    : { data: [] };
  return rows.map((m) => publicMessage(m, access, reactions ?? []));
}

/** Emails an Update to every member who still has access (in the background). */
async function emailUpdate(db: any, access: Access, message: any) {
  const [{ data: item }, shop, { data: members }] = await Promise.all([
    db.from("menu_items").select("name").eq("id", access.menuItemId).maybeSingle(),
    shopOf(db, access.bakerId),
    db.from("course_enrollments").select("email, access_token").eq("menu_item_id", access.menuItemId).is("revoked_at", null),
  ]);
  const identity = await customerEmailIdentity(db, access.bakerId, shop.name);
  const spaceName = item?.name ?? "your membership";
  const preview = escapeHtml(String(message.body).slice(0, 1200)).replace(/\n/g, "<br/>");
  for (const m of members ?? []) {
    await sendEmail({
      from: identity.from, reply_to: identity.reply_to, to: m.email,
      subject: `${shop.name ? shop.name + ": " : ""}New update in ${spaceName}`,
      html: emailShell(`New update in ${escapeHtml(spaceName)}`,
        `<p style="margin:0 0 18px;font-size:15px;line-height:1.65;">${preview}</p>
         <a href="${courseURL(m.access_token)}#community" style="display:inline-block;padding:12px 22px;background:#14110e;color:#fff;border-radius:9999px;text-decoration:none;font-weight:700;">Open the conversation</a>`,
        `You're getting this because you're a member of ${escapeHtml(spaceName)}${shop.name ? ` from ${escapeHtml(shop.name)}` : ""}.`),
    });
    await new Promise((r) => setTimeout(r, 120));   // stay under Resend's rate limit
  }
}

/**
 * Tells the shop a member posted: a push to their phone every time (the
 * same OneSignal route as order alerts; tapping it opens that community in
 * the app), and an email once per burst — only when no other member message
 * arrived in this space in the half hour before, so a lively thread is one
 * email, not twenty.
 */
async function notifyShop(db: any, access: Access, message: any) {
  const { data: it } = await db.from("menu_items").select("name").eq("id", access.menuItemId).maybeSingle();
  const text = String(message.body).replace(/\s+/g, " ").trim();
  await postWithRetry(`${SUPABASE_URL}/functions/v1/notify-marketplace`, {
    recipient_user_id: access.bakerId,
    title: it?.name ?? "Your community",
    body: `${access.name}${message.parent_id ? " (reply)" : ""}: ${text.length > 140 ? text.slice(0, 139) + "…" : text}`,
    data: { type: "community_message", menu_item_id: access.menuItemId },
  }, { anonKey: SUPABASE_ANON_KEY, webhookSecret: WEBHOOK_SECRET }).catch((e: unknown) => console.error("community push failed:", e));

  const since = new Date(new Date(message.created_at).getTime() - 30 * 60 * 1000).toISOString();
  const { count } = await db.from("channel_messages").select("id", { count: "exact", head: true })
    .eq("menu_item_id", access.menuItemId).not("enrollment_id", "is", null).neq("id", message.id)
    .gte("created_at", since);
  if ((count ?? 0) > 0) return;
  const to = await resolveBakerEmail(db, access.bakerId);
  if (!to) return;
  const { data: item } = await db.from("menu_items").select("name, is_club").eq("id", access.menuItemId).maybeSingle();
  const space = item?.name ?? "your community";
  const preview = escapeHtml(String(message.body).slice(0, 600)).replace(/\n/g, "<br/>");
  const kind = message.parent_id ? "replied in a thread" : "posted";
  await sendEmail({
    from: "Bakerï <hello@bakeriapp.com>", to,
    subject: `${access.name} ${kind} in ${space}`,
    html: emailShell(`New in ${escapeHtml(space)}`,
      `<p style="margin:0 0 6px;font-size:14px;color:#8a7f88;"><b style="color:#14110e;">${escapeHtml(access.name)}</b> ${kind}:</p>
       <p style="margin:0 0 20px;font-size:15px;line-height:1.65;padding:12px 14px;background:#f6f1e8;border-radius:12px;">${preview}</p>
       <a href="${COURSE_PAGE}?owner=${access.menuItemId}#community" style="display:inline-block;padding:12px 22px;background:#14110e;color:#fff;border-radius:9999px;text-decoration:none;font-weight:700;">Reply</a>
       <p style="margin:16px 0 0;font-size:13px;color:#8a7f88;">Or open the Bakerï app → ${item?.is_club ? "Clubs" : "Courses"}.</p>`,
      "You get one email when members start talking, not one per message."),
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Invalid request." }, 400); }
  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // ── Sign-in: send a code ──
  if (body.send_code === true) {
    const bakerId = String(body.baker_id ?? "");
    const email = String(body.email ?? "").trim().toLowerCase();
    if (!UUID_RE.test(bakerId) || !EMAIL_RE.test(email)) return json({ error: "Please enter a valid email address." }, 400);
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count } = await db.from("member_login_codes").select("id", { count: "exact", head: true })
      .eq("baker_id", bakerId).ilike("email", email).gte("created_at", since);
    if ((count ?? 0) >= 5) return json({ error: "Too many codes requested. Try again in an hour." }, 429);
    const spaces = await spacesFor(db, bakerId, email);
    if (spaces.length) {
      const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, "0");
      const { data: row } = await db.from("member_login_codes").insert({
        baker_id: bakerId, email, code_hash: "pending", expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      }).select("id").single();
      await db.from("member_login_codes").update({ code_hash: await sha256(row.id + code) }).eq("id", row.id);
      const shop = await shopOf(db, bakerId);
      const identity = await customerEmailIdentity(db, bakerId, shop.name);
      await sendEmail({
        from: identity.from, reply_to: identity.reply_to, to: email,
        subject: `${code} is your sign-in code${shop.name ? ` for ${shop.name}` : ""}`,
        html: emailShell("Your sign-in code",
          `<p style="margin:0 0 16px;font-size:15px;line-height:1.65;">Enter this code to open your courses and memberships${shop.name ? ` from ${escapeHtml(shop.name)}` : ""}:</p>
           <div style="font-size:34px;font-weight:800;letter-spacing:.24em;color:#14110e;margin:0 0 16px;">${code}</div>
           <p style="margin:0;font-size:13px;color:#8a7f88;">It works for 15 minutes. If you didn't ask for it, you can ignore this email.</p>`,
          "Sent because someone asked to sign in with this email."),
      });
    }
    return json({ ok: true });
  }

  // ── Sign-in: check the code ──
  if (body.verify_code === true) {
    const bakerId = String(body.baker_id ?? "");
    const email = String(body.email ?? "").trim().toLowerCase();
    const code = String(body.code ?? "").replace(/\D/g, "");
    if (!UUID_RE.test(bakerId) || !EMAIL_RE.test(email) || code.length !== 6) return json({ error: "Enter the 6-digit code from your email." }, 400);
    const { data: row } = await db.from("member_login_codes").select("id, code_hash, attempts, expires_at, used_at")
      .eq("baker_id", bakerId).ilike("email", email).is("used_at", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (!row || new Date(row.expires_at).getTime() < Date.now() || row.attempts >= 5) {
      return json({ error: "That code has expired. Send a new one." }, 400);
    }
    if (row.code_hash !== await sha256(row.id + code)) {
      await db.from("member_login_codes").update({ attempts: row.attempts + 1 }).eq("id", row.id);
      return json({ error: "That code isn’t right. Check your email and try again." }, 400);
    }
    await db.from("member_login_codes").update({ used_at: new Date().toISOString() }).eq("id", row.id);
    const { data: s } = await db.from("member_sessions").insert({ baker_id: bakerId, email }).select("token").single();
    return json({ session: s.token, email, spaces: await spacesFor(db, bakerId, email) });
  }

  if (body.spaces === true) {
    const s = await memberSession(db, body.session);
    if (!s) return json({ error: "Please sign in again." }, 401);
    return json({ email: s.email, spaces: await spacesFor(db, s.baker_id, s.email) });
  }

  if (body.sign_out === true) {
    if (UUID_RE.test(String(body.session ?? ""))) {
      await db.from("member_sessions").update({ revoked_at: new Date().toISOString() }).eq("token", String(body.session));
    }
    return json({ ok: true });
  }

  // ── Channel ──
  const action = String(body.channel ?? "");
  if (!action) return json({ error: "Invalid request." }, 400);
  const res = await resolveAccess(db, req, body);
  if ("error" in res) return json({ error: res.error }, res.status);
  const access = res.access;
  const { data: item } = await db.from("menu_items").select("channel_enabled, members_can_post").eq("id", access.menuItemId).maybeSingle();
  if (!item?.channel_enabled && !access.owner) return json({ error: "The conversation is turned off." }, 403);
  const msgCols = "id, enrollment_id, author_name, body, attachments, parent_id, is_pinned, is_update, reply_count, last_reply_at, created_at, edited_at, deleted_at";

  if (action === "list") {
    const thread = body.thread ? String(body.thread) : null;
    if (thread && !UUID_RE.test(thread)) return json({ error: "Invalid request." }, 400);
    let q = db.from("channel_messages").select(msgCols).eq("menu_item_id", access.menuItemId);
    if (thread) q = q.or(`id.eq.${thread},parent_id.eq.${thread}`).order("created_at", { ascending: true }).limit(500);
    else {
      q = q.is("parent_id", null).order("created_at", { ascending: false }).limit(PAGE);
      if (body.before) q = q.lt("created_at", String(body.before));
    }
    const [{ data: rows }, { data: pins }] = await Promise.all([
      q,
      thread || body.before ? Promise.resolve({ data: [] }) :
        db.from("channel_messages").select(msgCols).eq("menu_item_id", access.menuItemId).eq("is_pinned", true).is("deleted_at", null).order("created_at", { ascending: false }),
    ]);
    // Removed messages with no replies drop out entirely; ones with replies stay as "removed".
    const visible = (rows ?? []).filter((m: any) => !m.deleted_at || m.reply_count > 0);
    db.from("channel_reads").upsert({ menu_item_id: access.menuItemId, actor: access.actor, last_read_at: new Date().toISOString() }).then(() => {});
    return json({
      messages: await withReactions(db, thread ? visible : visible.reverse(), access),
      pinned: await withReactions(db, pins ?? [], access),
      more: !thread && (rows ?? []).length === PAGE,
      me: { name: access.name, owner: access.owner, can_post: access.owner || item?.members_can_post !== false },
    });
  }

  if (action === "post") {
    const text = String(body.body ?? "").trim().slice(0, MAX_BODY);
    // Attachments (images, video, files) are the shop's; members post text.
    const attachments = access.owner && Array.isArray(body.attachments)
      ? (body.attachments as any[]).filter((a) => a && typeof a.url === "string" && ["image", "video", "file"].includes(a.type)).slice(0, 10)
      : null;
    if (!text && !attachments?.length) return json({ error: "Write a message first." }, 400);
    if (!access.owner && item?.members_can_post === false) return json({ error: "Only the shop can post here." }, 403);
    const parentId = body.parent_id ? String(body.parent_id) : null;
    if (parentId) {
      const { data: parent } = await db.from("channel_messages").select("id, parent_id").eq("id", parentId).eq("menu_item_id", access.menuItemId).maybeSingle();
      if (!parent || parent.parent_id) return json({ error: "That conversation isn’t available." }, 400);
    }
    const isUpdate = access.owner && !parentId && body.is_update === true;
    const { data: row, error } = await db.from("channel_messages").insert({
      baker_id: access.bakerId, menu_item_id: access.menuItemId, enrollment_id: access.owner ? null : access.actor,
      author_name: access.name, body: text, attachments, parent_id: parentId, is_update: isUpdate,
    }).select(msgCols).single();
    if (error || !row) return json({ error: "Couldn’t post that. Please try again." }, 500);
    if (isUpdate) EdgeRuntime.waitUntil(emailUpdate(db, access, row).catch((e) => console.error("update email failed:", e)));
    if (!access.owner) EdgeRuntime.waitUntil(notifyShop(db, access, row).catch((e) => console.error("shop notify failed:", e)));
    return json({ message: (await withReactions(db, [row], access))[0] });
  }

  const messageId = String(body.message_id ?? "");
  if (!UUID_RE.test(messageId)) return json({ error: "Invalid request." }, 400);
  const { data: msg } = await db.from("channel_messages").select("id, enrollment_id, deleted_at")
    .eq("id", messageId).eq("menu_item_id", access.menuItemId).maybeSingle();
  if (!msg || msg.deleted_at) return json({ error: "That message isn’t available." }, 404);
  const isAuthor = msg.enrollment_id ? msg.enrollment_id === access.actor : access.owner;

  if (action === "react") {
    const emoji = String(body.emoji ?? "").slice(0, 16);
    if (!emoji) return json({ error: "Invalid request." }, 400);
    const { data: had } = await db.from("channel_reactions").select("emoji").eq("message_id", messageId).eq("actor", access.actor).eq("emoji", emoji).maybeSingle();
    if (had) await db.from("channel_reactions").delete().eq("message_id", messageId).eq("actor", access.actor).eq("emoji", emoji);
    else await db.from("channel_reactions").insert({ message_id: messageId, actor: access.actor, emoji });
    return json({ ok: true });
  }
  if (action === "pin") {
    if (!access.owner) return json({ error: "Only the shop can pin messages." }, 403);
    await db.from("channel_messages").update({ is_pinned: body.pinned === true }).eq("id", messageId);
    return json({ ok: true });
  }
  if (action === "delete") {
    if (!access.owner && !isAuthor) return json({ error: "You can only remove your own messages." }, 403);
    await db.from("channel_messages").update({ deleted_at: new Date().toISOString(), is_pinned: false }).eq("id", messageId);
    return json({ ok: true });
  }
  if (action === "edit") {
    const text = String(body.body ?? "").trim().slice(0, MAX_BODY);
    if (!isAuthor) return json({ error: "You can only edit your own messages." }, 403);
    if (!text) return json({ error: "Write a message first." }, 400);
    await db.from("channel_messages").update({ body: text, edited_at: new Date().toISOString() }).eq("id", messageId);
    return json({ ok: true });
  }
  return json({ error: "Invalid request." }, 400);
});
