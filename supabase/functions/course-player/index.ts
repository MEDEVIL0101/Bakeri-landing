import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { escapeHtml } from "../_shared/receiptEmailStyle.ts";
import { customerEmailIdentity } from "../_shared/senderIdentity.ts";
import { COURSE_PAGE, courseURL, enrollInCourse } from "../_shared/course.ts";
import { getStripeClient } from "../_shared/stripe.ts";
import { currencyForCountry } from "../_shared/currency.ts";
import { vendorFeeRate } from "../_shared/vendorPlan.ts";
import { resolveAccess } from "../_shared/memberAccess.ts";

// The course player's backend (baker/course.html). Public — the access token
// IS the credential (one per enrollment, emailed at purchase).
//   { token } | { session, menu_item_id } | { owner: true, menu_item_id }
//                                     → the whole course/club, the member's progress
//                                       (see _shared/memberAccess.ts; the owner
//                                       always sees everything)
//   { menu_item_id, preview: true }   → the course with only free-preview lessons open
//   { token, lesson_id, completed }   → mark a lesson done / not done
//   { menu_item_id, email, resend: true } → email this person their link
//                                       again (always answers ok — never
//                                       confirms who is enrolled)
// Clubs (migration 20261106000003) — a course sold as a membership. A
// monthly/yearly club is a Stripe subscription on the vendor's account:
//   { club_checkout: menu_item_id, email? }  → { url } of a Stripe Checkout page
//   { club_session, menu_item_id }           → after paying: enrolls, emails the
//                                              link, returns { token }
//   { token, cancel_club: true }             → cancels at the end of the paid period
// An enrolled member's access is re-checked against Stripe once paid_through
// passes (checkMembership), so no webhook is involved.
// Lesson blocks can point at private files as "course-media:<path>"; those
// come back as signed URLs, good for 6 hours.
// deno-lint-ignore-file no-explicit-any

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const SIGNED_SECONDS = 6 * 60 * 60;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
}

async function resolveMedia(db: any, blocks: any[] | null): Promise<any[]> {
  if (!Array.isArray(blocks)) return [];
  const out = [];
  for (const b of blocks) {
    const c = { ...b };
    for (const key of ["url"]) {
      const v = c[key];
      if (typeof v === "string" && v.startsWith("course-media:")) {
        const { data } = await db.storage.from("course-media").createSignedUrl(v.slice("course-media:".length), SIGNED_SECONDS);
        c[key] = data?.signedUrl ?? null;
      }
    }
    out.push(c);
  }
  return out;
}

async function loadCourse(db: any, menuItemId: string, unlocked: (lesson: any) => boolean, progress: Set<string>) {
  const { data: item } = await db
    .from("menu_items")
    .select("id, user_id, name, item_description, is_course, is_club, club_interval, has_image, default_price, marketplace_price_from, deleted_at, is_listed_in_marketplace")
    .eq("id", menuItemId)
    .maybeSingle();
  if (!item || !item.is_course || item.deleted_at) return null;
  const [{ data: modules }, { data: lessons }, { data: shop }] = await Promise.all([
    db.from("course_modules").select("id, title, description, sort_order, created_at").eq("menu_item_id", menuItemId).is("deleted_at", null),
    db.from("course_lessons").select("id, module_id, title, sort_order, is_preview, content_blocks, created_at").eq("menu_item_id", menuItemId).is("deleted_at", null),
    db.from("profiles").select("business_name, user_name, profile_slug, selected_theme, storefront_design, updated_at").eq("id", item.user_id).maybeSingle(),
  ]);
  const order = (a: any, b: any) => (a.sort_order - b.sort_order) || String(a.created_at).localeCompare(String(b.created_at));
  const outModules = [];
  for (const m of (modules ?? []).sort(order)) {
    const ls = [];
    for (const l of (lessons ?? []).filter((x: any) => x.module_id === m.id).sort(order)) {
      const open = unlocked(l);
      ls.push({
        id: l.id, title: l.title, is_preview: l.is_preview, locked: !open,
        completed: progress.has(l.id),
        blocks: open ? await resolveMedia(db, l.content_blocks) : [],
      });
    }
    outModules.push({ id: m.id, title: m.title, description: m.description, lessons: ls });
  }
  return {
    course: {
      id: item.id, name: item.name, description: item.item_description, is_club: !!item.is_club, interval: item.club_interval ?? null,
      price: Number((item.marketplace_price_from ?? 0) > 0 ? item.marketplace_price_from : item.default_price) || 0,
      image_url: item.has_image ? `${SUPABASE_URL}/storage/v1/object/public/menu-item-images/${String(item.user_id).toUpperCase()}/${String(item.id).toUpperCase()}.jpg` : null,
    },
    shop: {
      id: item.user_id, name: shop?.business_name || shop?.user_name || "", slug: shop?.profile_slug ?? null,
      theme: shop?.selected_theme ?? null, accent: shop?.storefront_design?.colors?.accent ?? null,
      logo_url: `${SUPABASE_URL}/storage/v1/object/public/business-logos/${String(item.user_id).toUpperCase()}/logo.jpg`,
    },
    modules: outModules,
  };
}

/** Emails this person their link, if they have access. */
async function sendLink(db: any, menuItemId: string, email: string) {
  const { data: e } = await db.from("course_enrollments")
    .select("access_token, user_id, menu_items(name, is_club)").eq("menu_item_id", menuItemId).ilike("email", email).is("revoked_at", null).maybeSingle();
  if (e) {
    const { data: shop } = await db.from("profiles").select("business_name, user_name").eq("id", e.user_id).maybeSingle();
    const shopName = shop?.business_name || shop?.user_name || "";
    const identity = await customerEmailIdentity(db, e.user_id, shopName);
    const name = e.menu_items?.name ?? "your course";
    const club = !!e.menu_items?.is_club;
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
      body: JSON.stringify({
        from: identity.from, reply_to: identity.reply_to, to: email,
        subject: `Your link to ${name}`,
        html: `<div style="font-family:-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:28px 24px;color:#241712;">
          <h1 style="font-size:22px;margin:0 0 8px;">${escapeHtml(name)}</h1>
          <p style="font-size:15px;color:#6B5F54;">Here’s your link${shopName ? ` from ${escapeHtml(shopName)}` : ""}. ${club ? "Bookmark it — it’s your way in for as long as you’re a member." : "It’s yours for life — bookmark it."}</p>
          <a href="${courseURL(e.access_token)}" style="display:inline-block;margin-top:10px;padding:12px 22px;background:#241712;color:#fff;border-radius:9999px;text-decoration:none;font-weight:700;">${club ? "Open the club" : "Open the course"}</a>
        </div>`,
      }),
    }).catch((err) => console.error("course link email failed:", err));
  }
}

async function connectedAccount(db: any, bakerId: string): Promise<string | null> {
  const { data } = await db.from("profiles").select("stripe_connect_account_id").eq("id", bakerId).maybeSingle();
  return data?.stripe_connect_account_id ?? null;
}

/** A club membership past its paid period: renewed → extend; ended → revoke. */
async function checkMembership(db: any, e: any): Promise<boolean> {
  if (!e.stripe_subscription_id || (e.paid_through && new Date(e.paid_through).getTime() > Date.now())) return true;
  const acct = await connectedAccount(db, e.user_id);
  try {
    const sub: any = await getStripeClient().subscriptions.retrieve(e.stripe_subscription_id, {}, { stripeAccount: acct ?? undefined });
    if (["active", "trialing", "past_due"].includes(sub.status)) {
      await db.from("course_enrollments").update({ paid_through: new Date(sub.current_period_end * 1000).toISOString() }).eq("id", e.id);
      return true;
    }
  } catch (err) {
    console.error("membership check failed:", err);
    return true;   // Stripe unreachable: don't lock a member out
  }
  await db.from("course_enrollments").update({ revoked_at: new Date().toISOString() }).eq("id", e.id);
  return false;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Invalid request." }, 400); }
  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // ── Club: start a membership ──
  if (body.club_checkout) {
    const menuItemId = String(body.club_checkout);
    if (!UUID_RE.test(menuItemId)) return json({ error: "Invalid request." }, 400);
    const { data: item } = await db.from("menu_items")
      .select("id, user_id, name, default_price, marketplace_price_from, is_club, club_interval, deleted_at, is_active, is_listed_in_marketplace")
      .eq("id", menuItemId).maybeSingle();
    if (!item || !item.is_club || !item.club_interval || item.deleted_at || !item.is_active) return json({ error: "This membership isn’t available." }, 404);
    const { data: shop } = await db.from("profiles")
      .select("stripe_connect_account_id, stripe_connect_onboarding_complete, country, profile_slug").eq("id", item.user_id).maybeSingle();
    if (!shop?.stripe_connect_account_id || !shop.stripe_connect_onboarding_complete) return json({ error: "This shop isn’t taking payments yet." }, 400);
    const price = Number((item.marketplace_price_from ?? 0) > 0 ? item.marketplace_price_from : item.default_price) || 0;
    if (price < 1) return json({ error: "This membership isn’t available." }, 400);
    const email = String(body.email ?? "").trim().toLowerCase();
    const feePercent = Math.round((await vendorFeeRate(db, item.user_id)) * 10000) / 100;
    const back = shop.profile_slug ? `https://bakeriapp.com/${shop.profile_slug}` : `https://bakeriapp.com/baker/?id=${item.user_id}`;
    try {
      const session = await getStripeClient().checkout.sessions.create({
        mode: "subscription",
        line_items: [{
          quantity: 1,
          price_data: {
            currency: currencyForCountry(shop.country), unit_amount: Math.round(price * 100),
            recurring: { interval: item.club_interval }, product_data: { name: item.name },
          },
        }],
        subscription_data: {
          metadata: { menu_item_id: item.id, baker_id: item.user_id, kind: "club" },
          ...(feePercent > 0 ? { application_fee_percent: feePercent } : {}),
        },
        metadata: { menu_item_id: item.id, baker_id: item.user_id, kind: "club" },
        ...(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? { customer_email: email } : {}),
        success_url: `${COURSE_PAGE}?club=${item.id}&session={CHECKOUT_SESSION_ID}`,
        cancel_url: back,
      } as any, { stripeAccount: shop.stripe_connect_account_id });
      return json({ url: session.url });
    } catch (err) {
      console.error("club checkout failed:", err);
      return json({ error: "Couldn’t start checkout. Please try again." }, 500);
    }
  }

  // ── Club: back from Stripe Checkout ──
  if (body.club_session) {
    const menuItemId = String(body.menu_item_id ?? "");
    const sessionId = String(body.club_session);
    if (!UUID_RE.test(menuItemId) || !/^cs_[A-Za-z0-9_]+$/.test(sessionId)) return json({ error: "Invalid request." }, 400);
    const { data: item } = await db.from("menu_items").select("id, user_id, is_club").eq("id", menuItemId).maybeSingle();
    const acct = item ? await connectedAccount(db, item.user_id) : null;
    if (!item?.is_club || !acct) return json({ error: "This membership isn’t available." }, 404);
    let session: any;
    try {
      session = await getStripeClient().checkout.sessions.retrieve(sessionId, { expand: ["subscription"] }, { stripeAccount: acct });
    } catch { return json({ error: "We couldn’t find that payment." }, 404); }
    const sub = session.subscription;
    const email = String(session.customer_details?.email ?? "").trim().toLowerCase();
    if (session.status !== "complete" || session.metadata?.menu_item_id !== item.id || !sub?.id || !email) {
      return json({ error: "That payment didn’t go through." }, 400);
    }
    const { data: already } = await db.from("course_enrollments").select("access_token").eq("stripe_subscription_id", sub.id).maybeSingle();
    if (already) return json({ token: already.access_token });
    const url = await enrollInCourse(db, { bakerId: item.user_id, menuItemId: item.id, email, name: session.customer_details?.name ?? null });
    if (!url) return json({ error: "Your payment went through but we couldn’t set up access. Contact the shop." }, 500);
    const token = new URL(url).searchParams.get("t")!;
    await db.from("course_enrollments").update({
      stripe_subscription_id: sub.id, paid_through: new Date(sub.current_period_end * 1000).toISOString(),
      cancel_at: null, revoked_at: null,
    }).eq("access_token", token);
    await sendLink(db, item.id, email);
    return json({ token });
  }

  // ── Resend my link ──
  if (body.resend === true) {
    const menuItemId = String(body.menu_item_id ?? "");
    const email = String(body.email ?? "").trim().toLowerCase();
    if (!UUID_RE.test(menuItemId) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "Please enter a valid email address." }, 400);
    await sendLink(db, menuItemId, email);
    return json({ ok: true });
  }

  // ── Preview (no enrollment) ──
  if (body.preview === true) {
    const menuItemId = String(body.menu_item_id ?? "");
    if (!UUID_RE.test(menuItemId)) return json({ error: "Invalid request." }, 400);
    const data = await loadCourse(db, menuItemId, (l) => !!l.is_preview, new Set());
    if (!data) return json({ error: "This course isn’t available." }, 404);
    return json({ ...data, enrolled: false });
  }

  // ── Enrolled (or the owner) ──
  const res = await resolveAccess(db, req, body);
  if ("error" in res) return json({ error: res.error }, res.status);
  const { owner } = res.access;
  const enrollment = res.access.enrollment;
  if (enrollment && !(await checkMembership(db, enrollment))) return json({ error: "Your membership has ended. Join again from the shop to get back in." }, 403);

  if (body.cancel_club === true) {
    if (!enrollment?.stripe_subscription_id) return json({ error: "Invalid request." }, 400);
    try {
      const sub: any = await getStripeClient().subscriptions.update(enrollment.stripe_subscription_id, { cancel_at_period_end: true },
        { stripeAccount: (await connectedAccount(db, enrollment.user_id)) ?? undefined });
      const cancelAt = new Date(sub.current_period_end * 1000).toISOString();
      await db.from("course_enrollments").update({ cancel_at: cancelAt, paid_through: cancelAt }).eq("id", enrollment.id);
      return json({ ok: true, cancel_at: cancelAt });
    } catch (err) {
      console.error("club cancel failed:", err);
      return json({ error: "Couldn’t cancel right now. Please try again or contact the shop." }, 500);
    }
  }

  if (body.lesson_id) {
    if (!enrollment) return json({ ok: true });   // the owner's clicks aren't progress
    const lessonId = String(body.lesson_id);
    if (!UUID_RE.test(lessonId)) return json({ error: "Invalid request." }, 400);
    if (body.completed === false) {
      await db.from("course_progress").delete().eq("enrollment_id", enrollment.id).eq("lesson_id", lessonId);
    } else {
      const { data: lesson } = await db.from("course_lessons").select("id").eq("id", lessonId).eq("menu_item_id", enrollment.menu_item_id).maybeSingle();
      if (lesson) await db.from("course_progress").upsert({ enrollment_id: enrollment.id, lesson_id: lessonId }, { onConflict: "enrollment_id,lesson_id" });
    }
    return json({ ok: true });
  }

  const menuItemId = res.access.menuItemId;
  const { data: done } = enrollment
    ? await db.from("course_progress").select("lesson_id").eq("enrollment_id", enrollment.id)
    : { data: [] };
  const data = await loadCourse(db, menuItemId, () => true, new Set((done ?? []).map((d: any) => d.lesson_id)));
  if (!data) return json({ error: "This isn’t available any more. Contact the shop for help." }, 404);
  if (enrollment) await db.from("course_enrollments").update({ last_opened_at: new Date().toISOString() }).eq("id", enrollment.id);
  const { data: meta } = await db.from("menu_items").select("is_club, club_interval, channel_enabled, members_can_post, space_design").eq("id", menuItemId).maybeSingle();
  return json({
    ...data, enrolled: true, owner,
    student: enrollment ? { name: enrollment.name, email: enrollment.email } : null,
    space: {
      is_club: !!meta?.is_club, interval: meta?.club_interval ?? null,
      channel_enabled: meta?.channel_enabled !== false, members_can_post: meta?.members_can_post !== false,
      design: meta?.space_design ?? null,
    },
    club: meta?.is_club && enrollment ? {
      interval: enrollment.stripe_subscription_id ? meta.club_interval : null,
      paid_through: enrollment.paid_through, cancel_at: enrollment.cancel_at,
    } : null,
  });
});
