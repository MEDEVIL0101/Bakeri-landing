import { useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { Button, Card, ErrorBanner, Field, Input, PageHeader, Spinner, Textarea } from '../components/ui';
import { slugify } from '../lib/account';
import { createLinkPage, loadLinkPage, saveLinkPage, type PartnerPage } from './partnerApi';

/**
 * A Growth Partner's link-in-bio page: bakeriapp.com/<slug> with their name,
 * a short bio, their links and their partner code (partner_pages). Partners
 * have their own experience — this is not the vendor storefront builder.
 */
export function PartnerLinkPage() {
  const { partner, refreshPartner } = useAuth();
  if (!partner) return null;
  if (partner.link_page_slug) return <EditLinkPage />;
  return <CreateLinkPage suggested={slugify(partner.company || partner.name).slice(0, 40)} onCreated={refreshPartner} />;
}

type Link = { label: string; url: string };

function EditLinkPage() {
  const [page, setPage] = useState<PartnerPage | null>(null);
  const [name, setName] = useState('');
  const [bio, setBio] = useState('');
  const [links, setLinks] = useState<Link[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const fill = (p: PartnerPage) => { setPage(p); setName(p.name); setBio(p.bio ?? ''); setLinks(p.links ?? []); };
  useEffect(() => {
    loadLinkPage().then((p) => (p ? fill(p) : setLoadError('Couldn’t find your page.')), (e) => setLoadError(e.message));
  }, []);

  if (loadError) return <div className="page"><ErrorBanner message={loadError} /></div>;
  if (!page) return <div className="page"><Spinner label="Loading your page…" /></div>;

  const url = `https://bakeriapp.com/${page.slug}`;
  const setLink = (i: number, patch: Partial<Link>) => { setLinks(links.map((l, j) => (j === i ? { ...l, ...patch } : l))); setSaved(false); };
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= links.length) return;
    const next = [...links]; [next[i], next[j]] = [next[j], next[i]]; setLinks(next); setSaved(false);
  };

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const cleaned = links.map((l) => ({ label: l.label.trim(), url: /^https?:\/\//i.test(l.url.trim()) ? l.url.trim().replace(/^http:/i, 'https:') : `https://${l.url.trim()}` }))
        .filter((l) => l.label || l.url !== 'https://');
      fill(await saveLinkPage({ name, bio, links: cleaned }));
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t save your page.');
    }
    setBusy(false);
  }

  return (
    <div className="page">
      <PageHeader title="Link in bio" subtitle={<>Your page: <a href={url} target="_blank" rel="noreferrer">bakeriapp.com/{page.slug}</a></>} />
      <form onSubmit={save} className="stack">
        <Card title="About you">
          <div className="stack">
            <Field label="Name"><Input value={name} onChange={(e) => { setName(e.target.value); setSaved(false); }} maxLength={80} required /></Field>
            <Field label="Short bio" hint="Up to 300 characters.">
              <Textarea value={bio} onChange={(e) => { setBio(e.target.value); setSaved(false); }} maxLength={300} rows={3} />
            </Field>
          </div>
        </Card>
        <Card title="Links" actions={links.length < 20 && <Button type="button" variant="secondary" onClick={() => { setLinks([...links, { label: '', url: '' }]); setSaved(false); }}>Add link</Button>}>
          <div className="stack">
            {links.length === 0 && <p className="muted" style={{ margin: 0 }}>No links yet. Add your socials, your website or anything you want people to find.</p>}
            {links.map((l, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                <Field label={i === 0 ? 'Title' : undefined}><Input value={l.label} onChange={(e) => setLink(i, { label: e.target.value })} placeholder="My Instagram" maxLength={80} /></Field>
                <Field label={i === 0 ? 'Address' : undefined}><Input value={l.url} onChange={(e) => setLink(i, { url: e.target.value })} placeholder="https://instagram.com/…" /></Field>
                <Button type="button" variant="ghost" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up">↑</Button>
                <Button type="button" variant="ghost" onClick={() => move(i, 1)} disabled={i === links.length - 1} aria-label="Move down">↓</Button>
                <Button type="button" variant="ghost" onClick={() => { setLinks(links.filter((_, j) => j !== i)); setSaved(false); }}>Remove</Button>
              </div>
            ))}
          </div>
        </Card>
        <p className="muted small" style={{ margin: 0 }}>Your page also shows a Bakerï card with your partner code, so visitors can start their own shop with 10% off.</p>
        {error && <ErrorBanner message={error} />}
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <Button type="submit" loading={busy}>Save</Button>
          {saved && <span className="muted small">Saved. Your page is up to date.</span>}
        </div>
      </form>
    </div>
  );
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
            It’s free while you’re a partner.
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
