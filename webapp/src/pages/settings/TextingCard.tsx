import { useState } from 'react';
import { useUserId } from '../../auth/AuthProvider';
import { Card, ErrorBanner, Toggle, useLoad } from '../../components/ui';
import { loadTextingOn, setTextingOn } from '../../lib/texts';

/** profiles.sms_enabled — texting customers about their orders (off by default). */
export function TextingCard() {
  const userId = useUserId();
  const loaded = useLoad(() => loadTextingOn(userId), [userId]);
  const [on, setOn] = useState<boolean | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const value = on ?? loaded.data ?? false;
  async function save(next: boolean) {
    setOn(next); setErr(null);
    try { await setTextingOn(userId, next); } catch (e: any) { setOn(!next); setErr(`Couldn’t save: ${e.message}`); }
  }
  return (
    <Card title="Texting">
      {loaded.error && <ErrorBanner message={loaded.error} onRetry={loaded.reload} />}
      <Toggle checked={value} onChange={save} label="Text customers about their orders"
        hint="Text a customer right from their order. Texts come from the Bakerï number, start with your shop's name, and their replies land in the order. Customers can reply STOP at any time." />
      {err && <ErrorBanner message={err} />}
    </Card>
  );
}
