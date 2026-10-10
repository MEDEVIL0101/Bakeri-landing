import { supabase, SUPABASE_URL } from './supabase';

export class ApiError extends Error {
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.code = code;
  }
}

/**
 * POSTs to a Bakeri edge function with the vendor's own JWT, the same way
 * the iOS app's PaymentService does. Only Authorization + Content-Type are
 * sent: several functions' CORS allow-lists (capture-payment, cancel-order,
 * charge-balance-payment) don't include apikey/x-client-info, so
 * supabase.functions.invoke() would fail the browser preflight.
 */
export async function callFunction<T = any>(name: string, body: unknown): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new ApiError('Please sign in to continue.');
  let res: Response;
  try {
    res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError('Something went wrong. Please check your connection and try again.');
  }
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON body */ }
  if (!res.ok) {
    throw new ApiError(json?.error || json?.message || 'Something went wrong. Please try again.', json?.code);
  }
  return json as T;
}

/** Throws the PostgREST error, if any, so callers can use plain try/catch. */
export function check<T>(result: { data: T; error: { message: string } | null }): T {
  if (result.error) throw new ApiError(result.error.message);
  return result.data;
}
