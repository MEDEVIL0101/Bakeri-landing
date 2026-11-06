import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { escapeHtml } from "../_shared/receiptEmailStyle.ts";
import { customerEmailIdentity } from "../_shared/senderIdentity.ts";
import { courseURL } from "../_shared/course.ts";

// The course player's backend (baker/course.html). Public — the access token
// IS the credential (one per enrollment, emailed at purchase).
//   { token }                         → the whole course, the student's progress
//   { menu_item_id, preview: true }   → the course with only free-preview lessons open
//   { token, lesson_id, completed }   → mark a lesson done / not done
//   { menu_item_id, email, resend: true } → email this person their link
//                                       again (always answers ok — never
//                                       confirms who is enrolled)
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
    .select("id, user_id, name, item_description, is_course, deleted_at, is_listed_in_marketplace")
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
    course: { id: item.id, name: item.name, description: item.item_description },
    shop: {
      id: item.user_id, name: shop?.business_name || shop?.user_name || "", slug: shop?.profile_slug ?? null,
      theme: shop?.selected_theme ?? null, accent: shop?.storefront_design?.colors?.accent ?? null,
      logo_url: `${SUPABASE_URL}/storage/v1/object/public/business-logos/${String(item.user_id).toUpperCase()}/logo.jpg`,
    },
    modules: outModules,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Invalid request." }, 400); }
  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // ── Resend my link ──
  if (body.resend === true) {
    const menuItemId = String(body.menu_item_id ?? "");
    const email = String(body.email ?? "").trim().toLowerCase();
    if (!UUID_RE.test(menuItemId) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "Please enter a valid email address." }, 400);
    const { data: e } = await db.from("course_enrollments")
      .select("access_token, user_id, menu_items(name)").eq("menu_item_id", menuItemId).ilike("email", email).is("revoked_at", null).maybeSingle();
    if (e) {
      const { data: shop } = await db.from("profiles").select("business_name, user_name").eq("id", e.user_id).maybeSingle();
      const shopName = shop?.business_name || shop?.user_name || "";
      const identity = await customerEmailIdentity(db, e.user_id, shopName);
      const name = e.menu_items?.name ?? "your course";
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
        body: JSON.stringify({
          from: identity.from, reply_to: identity.reply_to, to: email,
          subject: `Your link to ${name}`,
          html: `<div style="font-family:-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:28px 24px;color:#241712;">
            <h1 style="font-size:22px;margin:0 0 8px;">${escapeHtml(name)}</h1>
            <p style="font-size:15px;color:#6B5F54;">Here’s your link${shopName ? ` from ${escapeHtml(shopName)}` : ""}. It’s yours for life — bookmark it.</p>
            <a href="${courseURL(e.access_token)}" style="display:inline-block;margin-top:10px;padding:12px 22px;background:#241712;color:#fff;border-radius:9999px;text-decoration:none;font-weight:700;">Open the course</a>
          </div>`,
        }),
      }).catch((err) => console.error("course link email failed:", err));
    }
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

  // ── Enrolled ──
  const token = String(body.token ?? "");
  if (!UUID_RE.test(token)) return json({ error: "This course link isn’t valid." }, 400);
  const { data: enrollment } = await db.from("course_enrollments")
    .select("id, menu_item_id, name, email, revoked_at").eq("access_token", token).maybeSingle();
  if (!enrollment || enrollment.revoked_at) return json({ error: "This course link isn’t valid any more. Contact the shop for help." }, 403);

  if (body.lesson_id) {
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

  const { data: done } = await db.from("course_progress").select("lesson_id").eq("enrollment_id", enrollment.id);
  const data = await loadCourse(db, enrollment.menu_item_id, () => true, new Set((done ?? []).map((d: any) => d.lesson_id)));
  if (!data) return json({ error: "This course isn’t available any more. Contact the shop for help." }, 404);
  await db.from("course_enrollments").update({ last_opened_at: new Date().toISOString() }).eq("id", enrollment.id);
  return json({ ...data, enrolled: true, student: { name: enrollment.name, email: enrollment.email } });
});
