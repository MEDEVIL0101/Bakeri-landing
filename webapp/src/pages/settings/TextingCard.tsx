import { useEffect, useState } from 'react';
import { useAuth, useUserId } from '../../auth/AuthProvider';
import { Card, ErrorBanner, Field, Input, Toggle, useLoad } from '../../components/ui';
import { loadTexting, setReplyPhone, setTextingOn } from '../../lib/texts';

/** profiles.sms_enabled (off by default) + sms_reply_phone. Texts go out from
 *  the Bakerï number, which can't take replies — each one ends with how
 *  customers reach you (this number, else your storefront link). */
export function TextingCard() {
  const userId = useUserId();
  const { profile } = useAuth();
  const loaded = useLoad(() => loadTexting(userId), [userId]);
  const [on, setOn] = useState<boolean | null>(null);
  const [phone, setPhone] = useState('');
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (loaded.data) setPhone(loaded.data.replyPhone); }, [loaded.data]);
  const value = on ?? loaded.data?.on ?? false;
  const first = (profile?.user_name || '').trim().split(/\s+/)[0] || 'you';
  async function save(next: boolean) {
    setOn(next); setErr(null);
    try { await setTextingOn(userId, next); } catch (e: any) { setOn(!next); setErr(`Couldn’t save: ${e.message}`); }
  }
  async function savePhone() {
    if (phone === (loaded.data?.replyPhone ?? '')) return;
    setErr(null);
    try { await setReplyPhone(userId, phone); } catch (e: any) { setErr(`Couldn’t save: ${e.message}`); }
  }
  return (
    <Card title="Texting">
      {loaded.error && <ErrorBanner message={loaded.error} onRetry={loaded.reload} />}
      <Toggle checked={value} onChange={save} label="Text customers about their orders"
        hint="Texts come from the Bakerï number and start with your shop’s name. That number can’t take replies, so every text ends with how to reach you." />
      {value && (
        <Field label="Number customers can text you on" hint={phone.trim() ? `Texts end with “Questions? Text ${first} at ${phone.trim()}”.` : 'Leave empty to point customers to your storefront link instead.'}>
          <Input type="tel" placeholder="(717) 555-0123" value={phone} onChange={(e) => setPhone(e.target.value)} onBlur={savePhone} />
        </Field>
      )}
      {err && <ErrorBanner message={err} />}
    </Card>
  );
}
