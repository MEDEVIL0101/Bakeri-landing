// Shared HMAC signing/verification for the Google Calendar OAuth `state` param.
// Used by google-calendar-oauth-start (signs) and google-calendar-oauth-callback
// (verifies) so the callback can trust the userId embedded in state actually came
// from an authenticated request, not just whatever the browser redirect carried.
// Mirrors _shared/square-oauth-state.ts.
//
// Format: "{userId}.{expiresAtEpochSeconds}.{base64url HMAC-SHA256 signature}"

const SECRET = Deno.env.get("GOOGLE_OAUTH_STATE_SECRET")!;

async function hmac(payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return base64UrlEncode(new Uint8Array(sigBuf));
}

function base64UrlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function signState(userId: string, expiresAt: number): Promise<string> {
  const payload = `${userId}.${expiresAt}`;
  const sig = await hmac(payload);
  return `${payload}.${sig}`;
}

/** Returns the verified userId, or null if the signature is invalid/expired/malformed. */
export async function verifyState(state: string): Promise<string | null> {
  const parts = state.split(".");
  if (parts.length !== 3) return null;
  const [userId, expiresAtStr, sig] = parts;

  const expiresAt = Number(expiresAtStr);
  if (!Number.isFinite(expiresAt) || expiresAt < Math.floor(Date.now() / 1000)) return null;

  const expectedSig = await hmac(`${userId}.${expiresAtStr}`);
  if (!timingSafeEqual(sig, expectedSig)) return null;

  return userId;
}
