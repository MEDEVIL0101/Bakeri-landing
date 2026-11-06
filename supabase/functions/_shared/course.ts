// Courses (migration 20261106000001). Buying a course enrolls the buyer: a
// course_enrollments row with a private access token, and the link to
// baker/course.html?t=<token> goes wherever a download link would (the
// checkout success page, the delivery email, resends).
// deno-lint-ignore-file no-explicit-any

export const COURSE_PAGE = "https://bakeriapp.com/baker/course.html";

export function courseURL(token: string): string {
  return `${COURSE_PAGE}?t=${token}`;
}

/** Enrolls (or re-uses the enrollment of) this email in this course; returns its link. */
export async function enrollInCourse(
  db: any,
  opts: { bakerId: string; menuItemId: string; email: string; name?: string | null; orderId?: string | null; source?: "purchase" | "manual" },
): Promise<string | null> {
  const email = opts.email.trim().toLowerCase();
  const { data: existing } = await db
    .from("course_enrollments")
    .select("id, access_token, revoked_at")
    .eq("menu_item_id", opts.menuItemId)
    .ilike("email", email)
    .maybeSingle();
  if (existing) {
    // Buying again restores access that was revoked.
    if (existing.revoked_at) await db.from("course_enrollments").update({ revoked_at: null }).eq("id", existing.id);
    return courseURL(existing.access_token);
  }
  const { data, error } = await db
    .from("course_enrollments")
    .insert({
      user_id: opts.bakerId, menu_item_id: opts.menuItemId, email, name: opts.name || null,
      order_id: opts.orderId ?? null, source: opts.source ?? "purchase",
    })
    .select("access_token")
    .single();
  if (error || !data) {
    console.error("course enrollment failed:", error?.message);
    return null;
  }
  return courseURL(data.access_token);
}

/** Fills the link of every course line in a downloads list (kind "course", empty URL). */
export async function fillCourseLinks(
  db: any,
  downloads: { item_name: string; download_url: string; menu_item_id: string; kind?: string }[],
  opts: { bakerId: string; email: string; name?: string | null; orderId: string },
): Promise<void> {
  for (const d of downloads) {
    if (d.kind !== "course" || d.download_url) continue;
    const url = await enrollInCourse(db, { ...opts, menuItemId: d.menu_item_id });
    if (url) d.download_url = url;
  }
}
