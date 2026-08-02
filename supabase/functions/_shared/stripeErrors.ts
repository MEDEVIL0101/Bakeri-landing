// Maps a Stripe SDK error to a message safe to show a paying customer.
// Card declines are genuinely useful and safe to surface verbatim ("Your
// card was declined", "Insufficient funds", etc.) — a customer needs that
// to fix their own payment. Everything else (a broken/disconnected Connect
// account, a bad API key, a Stripe outage) is a platform/baker-side
// problem that means nothing to a customer and shouldn't be dumped on
// screen as a raw API error — see the Sweet Southern Bakery incident,
// where "The provided key ... does not have access to account ..."
// rendered directly on baker/pay-quote.html.
export function friendlyStripeError(err: unknown): string {
  const stripeErr = err as { type?: string; message?: string } | null;
  if (stripeErr?.type === "StripeCardError") {
    return stripeErr.message || "Your card was declined. Please try a different payment method.";
  }
  console.error("Stripe error (not shown to customer):", err instanceof Error ? err.message : err);
  return "This baker's payment setup needs attention right now. Please try again later or contact them directly.";
}
