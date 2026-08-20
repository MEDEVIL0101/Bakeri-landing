// Records every guest-order email send attempt to notification_log, so a
// Resend failure (bad address, revoked key, etc.) is visible somewhere
// durable instead of only ever reaching an edge function's console.error —
// which nobody was watching. See 20260730000002_notification_log.sql.

// deno-lint-ignore no-explicit-any
export async function logNotification(
  db: any,
  orderId: string,
  eventType: string,
  status: "sent" | "failed",
  errorMessage?: string,
  channel: "email" | "push" = "email"
): Promise<void> {
  const { error } = await db.from("notification_log").insert({
    order_id: orderId,
    event_type: eventType,
    channel,
    status,
    error_message: errorMessage ?? null,
  });
  if (error) {
    console.error(`notification_log insert failed for ${eventType}/${orderId}:`, error.message);
  }
}
