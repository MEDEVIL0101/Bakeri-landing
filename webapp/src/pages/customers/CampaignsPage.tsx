import { useState } from 'react';
import { useUserId } from '../../auth/AuthProvider';
import { Badge, Button, Card, ConfirmModal, EmptyState, ErrorBanner, Field, Input, Modal, PageHeader, Select, Spinner, Textarea, useLoad, useToast } from '../../components/ui';
import { deleteCampaign, listCampaigns, listContacts, saveCampaignDraft, sendCampaign } from '../../lib/data';
import { listMenuItems } from '../../lib/menu';
import { formatDateTime } from '../../lib/format';
import type { Campaign } from '../../lib/types';

export function CampaignsPage() {
  const userId = useUserId();
  const toast = useToast();
  const campaigns = useLoad(() => listCampaigns(userId), [userId]);
  const contacts = useLoad(() => listContacts(userId), [userId]);
  const [editing, setEditing] = useState<Partial<Campaign> | null>(null);
  const [sending, setSending] = useState<Campaign | null>(null);
  const [deleting, setDeleting] = useState<Campaign | null>(null);

  const subscriberCount = (contacts.data ?? []).filter((c) => !c.unsubscribed_at).length;

  return (
    <div className="page">
      <PageHeader
        title="Email Campaigns"
        subtitle={contacts.data ? `Send an email to your ${subscriberCount} subscriber${subscriberCount === 1 ? '' : 's'}.` : undefined}
        actions={<Button onClick={() => setEditing({})}>New campaign</Button>}
      />
      {campaigns.error && <ErrorBanner message={campaigns.error} onRetry={campaigns.reload} />}
      <div className="card">
        {campaigns.loading ? <Spinner /> : !campaigns.data?.length ? (
          <EmptyState title="No campaigns yet" body="Announce a new menu, a pre-order drop or a holiday special." action={<Button onClick={() => setEditing({})}>Write your first email</Button>} />
        ) : (
          <ul className="list">
            {campaigns.data.map((c) => (
              <li key={c.id} className="list-row">
                <span className="grow">
                  <span className="row-title">{c.subject || '(No subject)'}</span>
                  <span className="row-sub">
                    {c.status === 'sent' ? `Sent ${formatDateTime(c.sent_at)} to ${c.recipient_count}` : `Draft · edited ${formatDateTime(c.updated_at)}`}
                  </span>
                </span>
                {c.status === 'sent' ? <Badge tone="green">Sent</Badge> : (
                  <span className="btn-row">
                    <Button variant="secondary" onClick={() => setEditing(c)}>Edit</Button>
                    <Button onClick={() => setSending(c)} disabled={!subscriberCount}>Send</Button>
                    <button className="icon-btn sm" aria-label="Delete draft" onClick={() => setDeleting(c)}>×</button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {editing && (
        <CampaignEditor userId={userId} campaign={editing} onClose={() => setEditing(null)}
          onSaved={(sendNow, saved) => { campaigns.reload(); if (sendNow) setSending(saved); else toast('Draft saved'); }} />
      )}
      {sending && (
        <ConfirmModal
          title={`Send to ${subscriberCount} subscriber${subscriberCount === 1 ? '' : 's'}?`}
          body={`“${sending.subject}” goes out now. This can’t be undone.`}
          confirmLabel="Send now"
          onClose={() => setSending(null)}
          onConfirm={async () => {
            const r = await sendCampaign(sending.id);
            toast(`Sent to ${r.sent} subscriber${r.sent === 1 ? '' : 's'}${r.failed ? ` (${r.failed} failed)` : ''}`);
            campaigns.reload();
          }}
        />
      )}
      {deleting && (
        <ConfirmModal title="Delete this draft?" confirmLabel="Delete" danger onClose={() => setDeleting(null)}
          onConfirm={async () => { await deleteCampaign(deleting.id); campaigns.reload(); }} />
      )}
    </div>
  );
}

function CampaignEditor({ userId, campaign, onClose, onSaved }: {
  userId: string; campaign: Partial<Campaign>; onClose: () => void; onSaved: (sendNow: boolean, c: Campaign) => void;
}) {
  const menu = useLoad(() => listMenuItems(userId), [userId]);
  const [subject, setSubject] = useState(campaign.subject ?? '');
  const [body, setBody] = useState(campaign.body_text ?? '');
  const [ctaMode, setCtaMode] = useState<'none' | 'listing' | 'url'>(campaign.cta_listing_id ? 'listing' : campaign.cta_url ? 'url' : 'none');
  const [ctaLabel, setCtaLabel] = useState(campaign.cta_label ?? '');
  const [ctaURL, setCtaURL] = useState(campaign.cta_url ?? '');
  const [ctaListing, setCtaListing] = useState(campaign.cta_listing_id ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save(sendNow: boolean) {
    if (!subject.trim() || !body.trim()) { setErr('Add a subject and a message.'); return; }
    if (ctaMode === 'url' && !/^https?:\/\//i.test(ctaURL.trim())) { setErr('The button link must start with https://'); return; }
    setBusy(true); setErr(null);
    try {
      const fields = {
        id: campaign.id,
        subject: subject.trim(),
        body_text: body,
        cta_label: ctaMode === 'none' ? null : ctaLabel.trim() || (ctaMode === 'listing' ? 'Order now' : 'Learn more'),
        cta_url: ctaMode === 'url' ? ctaURL.trim() : null,
        cta_listing_id: ctaMode === 'listing' ? ctaListing || null : null,
      };
      const id = await saveCampaignDraft(userId, fields);
      onClose();
      onSaved(sendNow, { ...(campaign as Campaign), ...fields, id });
    } catch (e: any) { setErr(e.message); setBusy(false); }
  }

  return (
    <Modal title={campaign.id ? 'Edit campaign' : 'New campaign'} onClose={onClose} wide
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="secondary" loading={busy} onClick={() => save(false)}>Save draft</Button>
        <Button loading={busy} onClick={() => save(true)}>Save & send…</Button>
      </>}
    >
      <Field label="Subject"><Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Fall menu is here 🍂" /></Field>
      <Field label="Message"><Textarea rows={10} value={body} onChange={(e) => setBody(e.target.value)} /></Field>
      <Card title="Button (optional)">
        <Field label="Button links to">
          <Select value={ctaMode} onChange={(e) => setCtaMode(e.target.value as typeof ctaMode)}>
            <option value="none">No button</option>
            <option value="listing">One of my listings</option>
            <option value="url">A web link</option>
          </Select>
        </Field>
        {ctaMode === 'listing' && (
          <Field label="Listing">
            <Select value={ctaListing} onChange={(e) => setCtaListing(e.target.value)}>
              <option value="">Choose…</option>
              {(menu.data ?? []).filter((m) => m.is_listed_in_marketplace).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </Select>
          </Field>
        )}
        {ctaMode === 'url' && <Field label="Link"><Input type="url" value={ctaURL} onChange={(e) => setCtaURL(e.target.value)} placeholder="https://" /></Field>}
        {ctaMode !== 'none' && <Field label="Button text"><Input value={ctaLabel} onChange={(e) => setCtaLabel(e.target.value)} placeholder={ctaMode === 'listing' ? 'Order now' : 'Learn more'} /></Field>}
      </Card>
      {err && <ErrorBanner message={err} />}
    </Modal>
  );
}
