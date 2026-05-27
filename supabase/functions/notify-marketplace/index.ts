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

  const targets = [recipient_user_id, recipient_user_id_2].filter(Boolean) as string[];

  const results = await Promise.all(targets.map(async (uid) => {
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
        data: data ?? {},
      }),
    });
    return res.ok;
  }));

  return new Response(JSON.stringify({ sent: results }), {
    headers: { "Content-Type": "application/json" },
  });
});
