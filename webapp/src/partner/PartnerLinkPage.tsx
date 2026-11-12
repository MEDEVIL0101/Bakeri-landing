import { useState, type FormEvent } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { Button, Card, ErrorBanner, Field, Input, PageHeader } from '../components/ui';
import { slugify } from '../lib/account';
import { StorefrontPage } from '../pages/storefront/StorefrontPage';
import { createLinkPage } from './partnerApi';

/**
 * A Growth Partner's link-in-bio page: bakeriapp.com/<slug> with their links
 * and their partner code, edited in the storefront builder's links-only mode
 * (partner_create_link_page makes it once).
 */
export function PartnerLinkPage() {
  const { partner, refreshPartner } = useAuth();
  if (!partner) return null;
  if (partner.link_page_slug) return <StorefrontPage linksOnly />;
  return <CreateLinkPage suggested={slugify(partner.company || partner.name).slice(0, 40)} onCreated={refreshPartner} />;
}

function CreateLinkPage({ suggested, onCreated }: { suggested: string; onCreated: () => Promise<unknown> | void }) {
  const [slug, setSlug] = useState(suggested);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clean = slugify(slug);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await createLinkPage(clean);
      await onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t create your page.');
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <PageHeader title="Link in bio" subtitle="A Bakerï page for your bio: your links, your socials and your partner code, in one place." />
      <Card title="Create your page">
        <form onSubmit={submit} className="stack">
          <p className="muted" style={{ margin: 0 }}>
            Your page shows your links and a Bakerï card with your partner code, so anyone who visits can start their own shop with 10% off.
            Design it in the same builder Bakerï vendors use. It’s free while you’re a partner.
          </p>
          <Field label="Your page address">
            <div className="copy-row">
              <span className="muted">bakeriapp.com/</span>
              <Input value={slug} onChange={(e) => setSlug(e.target.value)} maxLength={40} required aria-label="Page address" />
            </div>
          </Field>
          {error && <ErrorBanner message={error} />}
          <div><Button type="submit" loading={busy} disabled={clean.length < 3}>Create my page</Button></div>
        </form>
      </Card>
    </div>
  );
}
