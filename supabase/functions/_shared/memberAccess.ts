// Who is opening a course/club (migration 20261107000001). Three ways in:
//   token      — an enrollment's access_token (the emailed link)
//   session    — a member session from email-code sign-in (member-space fn),
//                which opens every space that email has with that shop
//   owner      — the shop's own signed-in user (Authorization: Bearer <user JWT>):
//                sees everything, always, even before anyone has bought
// deno-lint-ignore-file no-explicit-any

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface Access {
  menuItemId: string;
  bakerId: string;
  owner: boolean;
  enrollment: any | null;   // null for the owner
  actor: string;            // 'shop' or the enrollment id
  name: string;
}

/** The signed-in user's id when the request carries a real user JWT (not the anon key). */
export async function ownerUserId(db: any, req: Request): Promise<string | null> {
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt) return null;
  try {
    const role = JSON.parse(atob(jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).role;
    if (role !== "authenticated") return null;
  } catch { return null; }
  const { data } = await db.auth.getUser(jwt);
  return data?.user?.id ?? null;
}

/** A live member session (email-code sign-in), or null. */
export async function memberSession(db: any, token: unknown): Promise<any | null> {
  const t = String(token ?? "");
  if (!UUID_RE.test(t)) return null;
  const { data } = await db.from("member_sessions").select("id, baker_id, email, expires_at, revoked_at").eq("token", t).maybeSingle();
  if (!data || data.revoked_at || new Date(data.expires_at).getTime() < Date.now()) return null;
  db.from("member_sessions").update({ last_seen_at: new Date().toISOString() }).eq("id", data.id).then(() => {});
  return data;
}

const ENROLL_COLS = "id, user_id, menu_item_id, name, email, revoked_at, stripe_subscription_id, paid_through, cancel_at, access_token";

/**
 * Resolves body.{token | session+menu_item_id | owner+menu_item_id}.
 * Returns the access, or a reason it was refused.
 */
export async function resolveAccess(db: any, req: Request, body: Record<string, unknown>):
  Promise<{ access: Access } | { error: string; status: number }> {
  const menuItemId = String(body.menu_item_id ?? "");
  if (body.owner === true) {
    if (!UUID_RE.test(menuItemId)) return { error: "Invalid request.", status: 400 };
    const uid = await ownerUserId(db, req);
    const { data: item } = await db.from("menu_items").select("id, user_id").eq("id", menuItemId).maybeSingle();
    if (!uid || !item || item.user_id !== uid) return { error: "Sign in to your Bakerï account to preview this.", status: 403 };
    const { data: shop } = await db.from("profiles").select("business_name, user_name").eq("id", uid).maybeSingle();
    return { access: { menuItemId, bakerId: uid, owner: true, enrollment: null, actor: "shop", name: shop?.business_name || shop?.user_name || "Shop" } };
  }
  let enrollment: any = null;
  if (body.token) {
    const token = String(body.token);
    if (!UUID_RE.test(token)) return { error: "This link isn’t valid.", status: 400 };
    const { data } = await db.from("course_enrollments").select(ENROLL_COLS).eq("access_token", token).maybeSingle();
    enrollment = data;
  } else if (body.session) {
    if (!UUID_RE.test(menuItemId)) return { error: "Invalid request.", status: 400 };
    const s = await memberSession(db, body.session);
    if (!s) return { error: "Please sign in again.", status: 401 };
    const { data } = await db.from("course_enrollments").select(ENROLL_COLS)
      .eq("menu_item_id", menuItemId).eq("user_id", s.baker_id).ilike("email", s.email).maybeSingle();
    enrollment = data;
  } else {
    return { error: "Invalid request.", status: 400 };
  }
  if (!enrollment || enrollment.revoked_at) return { error: "You don’t have access to this any more. Contact the shop for help.", status: 403 };
  return {
    access: {
      menuItemId: enrollment.menu_item_id, bakerId: enrollment.user_id, owner: false, enrollment,
      actor: enrollment.id, name: enrollment.name || String(enrollment.email).split("@")[0],
    },
  };
}
