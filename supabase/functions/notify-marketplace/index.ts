import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const ONESIGNAL_APP_ID      = Deno.env.get("ONESIGNAL_APP_ID")!;
const ONESIGNAL_REST_API_KEY = Deno.env.get("ONESIGNAL_REST_API_KEY")!;
const WEBHOOK_SECRET         = Deno.env.get("BAKERI_WEBHOOK_SECRET")!;

interface NotifyPayload {
  recipient_user_id: string;   // Supabase UUID — matched to OneSignal external_id
  title: string;
  body: string;
  data?: Record<string, string>;
  // Optional second recipient (e.g. both parties on completion)
  recipient_user_id_2?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type, x-webhook-secret" },
    });
  }

  const secret = req.headers.get("x-webhook-secret");
  if (!secret || secret !== WEBHOOK_SECRET) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  const payload: NotifyPayload = await req.json();
  const { recipient_user_id, recipient_user_id_2, title, body, data } = payload;

  // OneSignal external_id is registered via OneSignal.login(uuid.uuidString) in Swift,
  // which produces uppercase UUIDs. Postgres serialises UUIDs as lowercase in JSON,
  // so we must uppercase here to match the registered subscriber.
  //
  // recipient_user_id_2 is only ever the baker (see trg_fn_marketplace_order_notify's
  // "completed" branch — "both parties on completion"). Its copy of the push is tagged
  // audience: "baker" so NotificationClickRouter (BakeriApp.swift) can tell it apart
  // from the buyer's copy and route within Baker Tools instead of switching the whole
  // app over to the buyer/social side — a real bug where a baker who'd just tapped
  // "Mark Order as Completed" themselves got bounced into the (paused) Shop tab by
  // their own confirmation push (confirmed live, Diana's iPhone, 2026-08-04).
  const targets = [
    recipient_user_id ? { uid: recipient_user_id.toUpperCase(), data: data ?? {} } : null,
    recipient_user_id_2 ? { uid: recipient_user_id_2.toUpperCase(), data: { ...(data ?? {}), audience: "baker" } } : null,
  ].filter((t): t is { uid: string; data: Record<string, unknown> } => t !== null);

  const results = await Promise.all(targets.map(async ({ uid, data: targetData }) => {
    const res = await fetch("https://onesignal.com/api/v1/notifications", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Key ${ONESIGNAL_REST_API_KEY}`,
      },
      body: JSON.stringify({
        app_id: ONESIGNAL_APP_ID,
        include_aliases: { external_id: [uid] },
        target_channel: "push",
        headings: { en: title },
        contents: { en: body },
        data: targetData,
      }),
    });
    return res.ok;
  }));

  return new Response(JSON.stringify({ sent: results }), {
    headers: { "Content-Type": "application/json" },
  });
});
