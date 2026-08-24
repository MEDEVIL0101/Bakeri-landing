// Shared retry wrapper for calling another internal, x-webhook-secret-gated
// edge function (notify-marketplace, a send-guest-*-email function, etc.) —
// a plain `fetch(...).catch(...)` doesn't catch a non-2xx response, which
// would otherwise silently drop a push/email. Several functions
// (mark-order-shipped, mark-order-delivered, cancel-order) each keep their
// own copy of this same helper; this shared one is for new call sites so
// that duplication doesn't keep growing — not a retrofit of those.
export async function postWithRetry(
  url: string,
  body: unknown,
  opts: { anonKey: string; webhookSecret: string }
): Promise<{ ok: boolean; error?: string }> {
  let lastError = "unknown error";
  const delaysMs = [0, 600, 1400, 2600];
  for (let attempt = 0; attempt < delaysMs.length; attempt++) {
    if (delaysMs[attempt] > 0) await new Promise((resolve) => setTimeout(resolve, delaysMs[attempt]));
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": opts.anonKey,
          "Authorization": `Bearer ${opts.anonKey}`,
          "x-webhook-secret": opts.webhookSecret,
        },
        body: JSON.stringify(body),
      });
      if (res.ok) return { ok: true };
      lastError = (await res.text()).slice(0, 500);
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }
  return { ok: false, error: lastError };
}
