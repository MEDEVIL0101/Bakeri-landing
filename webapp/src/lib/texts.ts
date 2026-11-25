// Two-way texting on an order (migration 20261125000003; functions
// send-order-text and twilio-sms-inbound). iOS: OrderTextsSection.
import { supabase } from './supabase';
import { callFunction, check } from './api';

export interface OrderText { id: string; direction: 'out' | 'in'; body: string; created_at: string; status: string | null; read_at: string | null }

export async function listOrderTexts(orderId: string): Promise<OrderText[]> {
  return check(await supabase.from('order_texts').select('id, direction, body, created_at, status, read_at')
    .eq('order_id', orderId).order('created_at')) as OrderText[];
}

export async function markTextsRead(ids: string[]): Promise<void> {
  if (ids.length) check(await supabase.from('order_texts').update({ read_at: new Date().toISOString() }).in('id', ids));
}

export async function sendOrderText(orderId: string, message: string): Promise<OrderText> {
  return (await callFunction<{ text: OrderText }>('send-order-text', { order_id: orderId, message })).text;
}

export async function loadTextingOn(userId: string): Promise<boolean> {
  return !!(check(await supabase.from('profiles').select('sms_enabled').eq('id', userId).single()) as { sms_enabled: boolean }).sms_enabled;
}

export async function setTextingOn(userId: string, on: boolean): Promise<void> {
  check(await supabase.from('profiles').update({ sms_enabled: on }).eq('id', userId));
}

/** Friendly words for send-order-text's error codes. */
export function textError(code: string): string {
  switch (code) {
    case 'not_set_up': return 'Texting isn’t switched on for Bakerï yet — it’s coming soon.';
    case 'texting_off': return 'Turn on texting in Shop settings to text customers.';
    case 'no_phone': return 'This order has no mobile number to text.';
    case 'opted_out': return 'This customer replied STOP, so they can’t be texted.';
    case 'too_long': return 'Keep it under 600 characters.';
    case 'empty_message': return 'Write a message first.';
    default: return 'The text couldn’t be sent. Please try again.';
  }
}
