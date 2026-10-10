import { useState, type ReactNode } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Button, ErrorBanner, Field, Input, Select, Textarea, Toggle } from '../../components/ui';
import { compressImage } from '../../lib/menu';
import { STORAGE_PUBLIC_URL } from '../../lib/supabase';
import { up } from '../../lib/format';
import {
  BLOCK_LABELS, PATTERNS, SOCIAL_PLATFORMS, THEMES, WEEK_DAYS, blobToDataURL, newFAQ, newLink, uploadBuilderImage,
  type BlockType, type Link, type LinkDesign, type StorefrontData, type StorefrontDraft,
} from '../../lib/storefront';

export interface EditorProps {
  draft: StorefrontDraft;
  set: (patch: Partial<StorefrontDraft>) => void;
  data: StorefrontData;
  userId: string;
  v2: boolean;
}

export function Section({ title, hint, children }: { title: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="ed-section">
      <h3 className="ed-title">{title}</h3>
      {hint && <p className="small muted">{hint}</p>}
      {children}
    </div>
  );
}

function storageURL(bucket: string, userId: string, file: string, updatedAt: string) {
  return `${STORAGE_PUBLIC_URL}/${bucket}/${up(userId)}/${file}?v=${Date.parse(updatedAt) || 0}`;
}

/** Click-to-replace photo. `value` is a data: URL (new) or the live URL. */
export function PhotoPicker({ label, value, onPick, maxSide = 900, round }: {
  label: string; value: string | null; onPick: (blob: Blob) => Promise<void> | void; maxSide?: number; round?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [broken, setBroken] = useState(false);
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <label className={`photo-pick ${round ? 'round' : ''}`}>
        {value && !broken ? <img src={value} alt="" onError={() => setBroken(true)} /> : <span className="muted small">{busy ? 'Uploading…' : 'Choose a photo'}</span>}
        <input type="file" accept="image/*" hidden onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          setBusy(true); setErr(null);
          try { await onPick(await compressImage(f, maxSide, 0.82)); setBroken(false); } catch (x: any) { setErr(x.message); } finally { setBusy(false); }
        }} />
      </label>
      {err && <span className="field-error">{err}</span>}
    </div>
  );
}

// ── Profile ───────────────────────────────────────────────────────────────

export function ProfileEditor({ draft, set, data, userId }: EditorProps) {
  const pickImage = (key: 'logo' | 'header') => async (blob: Blob) =>
    set({ images: { ...draft.images, [key]: await blobToDataURL(blob) } });
  return (
    <>
      <Section title="Logo & header">
        <div className="grid-2">
          <PhotoPicker label="Logo" round value={draft.images.logo ?? storageURL('business-logos', userId, 'logo.jpg', data.updatedAt)} onPick={pickImage('logo')} />
          <PhotoPicker label="Header photo" maxSide={1600} value={draft.images.header ?? storageURL('storefront-headers', userId, 'header.jpg', data.updatedAt)} onPick={pickImage('header')} />
        </div>
      </Section>
      <Section title="Your business">
        <Field label="Business name"><Input value={draft.business_name} onChange={(e) => set({ business_name: e.target.value })} /></Field>
        <Field label="Location" hint="Shown under your name, e.g. “Calgary, AB”."><Input value={draft.location} onChange={(e) => set({ location: e.target.value })} /></Field>
        <Field label="Short bio"><Textarea rows={3} value={draft.bio} onChange={(e) => set({ bio: e.target.value })} /></Field>
      </Section>
      <SocialEditor draft={draft} set={set} />
    </>
  );
}

function SocialEditor({ draft, set }: Pick<EditorProps, 'draft' | 'set'>) {
  const isSocial = (l: Link) => l.section.trim().toLowerCase() === 'social';
  const urlFor = (p: string) => draft.links.find((l) => isSocial(l) && l.label.toLowerCase() === p.toLowerCase())?.url ?? '';
  function setURL(platform: string, url: string) {
    const links = [...draft.links];
    const i = links.findIndex((l) => isSocial(l) && l.label.toLowerCase() === platform.toLowerCase());
    if (i >= 0) {
      if (url.trim()) links[i] = { ...links[i], url };
      else links.splice(i, 1);
    } else if (url.trim()) {
      links.push({ ...newLink('Social'), label: platform, url });
    }
    set({ links });
  }
  return (
    <Section title="Social links" hint="Shown as icons under your name. Paste a link to show it.">
      {SOCIAL_PLATFORMS.map((p) => (
        <Field key={p} label={p}><Input type="url" placeholder="https://" value={urlFor(p)} onChange={(e) => setURL(p, e.target.value)} /></Field>
      ))}
    </Section>
  );
}

// ── Theme ─────────────────────────────────────────────────────────────────

export function ThemeEditor({ draft, set }: EditorProps) {
  return (
    <Section title="Theme" hint="Colours and pattern for your storefront (also used in the Bakeri app).">
      <div className="choice-grid">
        {THEMES.map((t) => (
          <button key={t} type="button" className={`choice ${draft.selected_theme === t ? 'active' : ''}`} onClick={() => set({ selected_theme: t })}>{t}</button>
        ))}
      </div>
      <Field label="Background pattern">
        <Select value={draft.background_pattern} onChange={(e) => set({ background_pattern: e.target.value })}>
          {PATTERNS.map((p) => <option key={p}>{p}</option>)}
        </Select>
      </Field>
    </Section>
  );
}

// ── Layout (v1 block order / visibility) ──────────────────────────────────

export function LayoutEditor({ draft, set, onOpen }: EditorProps & { onOpen: (t: BlockType) => void }) {
  const blocks = draft.storefront_block_layout;
  const hasEmailCapture = blocks.some((b) => b.type === 'emailCapture');
  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= blocks.length) return;
    const next = [...blocks];
    [next[i], next[j]] = [next[j], next[i]];
    set({ storefront_block_layout: next });
  }
  return (
    <Section title="Sections" hint="Your profile always comes first. Reorder, hide, or click a section to edit it.">
      <ul className="block-list">
        {blocks.map((b, i) => (
          <li key={b.type} className={b.hidden ? 'is-hidden' : ''}>
            <span className="reorder">
              <button type="button" className="icon-btn sm" aria-label="Move up" onClick={() => move(i, -1)}>↑</button>
              <button type="button" className="icon-btn sm" aria-label="Move down" onClick={() => move(i, 1)}>↓</button>
            </span>
            <button type="button" className="grow link-btn left" onClick={() => onOpen(b.type)}>
              <span className="row-title">{BLOCK_LABELS[b.type]}</span>
            </button>
            <label className="small muted eye">
              <input type="checkbox" className="switch" checked={!b.hidden}
                onChange={(e) => set({ storefront_block_layout: blocks.map((x, j) => (j === i ? { ...x, hidden: !e.target.checked } : x)) })} />
            </label>
          </li>
        ))}
      </ul>
      {!hasEmailCapture && (
        <Button type="button" variant="secondary" onClick={() => set({ storefront_block_layout: [...blocks, { type: 'emailCapture', hidden: false }] })}>
          + Add a mailing list signup
        </Button>
      )}
    </Section>
  );
}

export function ListingsInfo({ kind }: { kind: 'menu' | 'physical' | 'digital' | 'form' }) {
  const text = {
    menu: 'Your menu shows every food item listed on your storefront.',
    physical: 'Shows products you ship or deliver.',
    digital: 'Shows your digital downloads.',
    form: 'Your storefront is showing a custom-order form instead of a menu.',
  }[kind];
  return (
    <Section title={kind === 'form' ? 'Custom order form' : BLOCK_LABELS[kind]} hint={text}>
      <RouterLink to="/menu" className="btn btn-secondary">Manage in Menu &amp; Listings</RouterLink>
    </Section>
  );
}

// ── Links ─────────────────────────────────────────────────────────────────

export function LinksEditor({ draft, set, data, userId, v2 }: EditorProps) {
  const isSocial = (l: Link) => l.section.trim().toLowerCase() === 'social';
  const others = draft.links.filter((l) => !isSocial(l));
  const sections = [...new Set(others.map((l) => l.section).filter(Boolean))];
  const [open, setOpen] = useState<string | null>(null);

  function update(id: string, patch: Partial<Link>) {
    set({ links: draft.links.map((l) => (l.id === id ? { ...l, ...patch } : l)) });
  }
  function move(id: string, dir: -1 | 1) {
    const ids = others.map((l) => l.id);
    const i = ids.indexOf(id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    const byId = new Map(draft.links.map((l) => [l.id, l]));
    set({ links: [...draft.links.filter(isSocial), ...ids.map((x) => byId.get(x)!)] });
  }
  function add() {
    const l = newLink(sections[0] ?? 'My Links');
    set({ links: [...draft.links, l] });
    setOpen(l.id);
  }

  return (
    <Section title="Links" hint="Buttons and cards linking to your other pages, products or anything else. Social icons live under Profile.">
      {others.length === 0 && <p className="small muted">No links yet.</p>}
      <ul className="block-list">
        {others.map((l) => (
          <li key={l.id} className="link-item">
            <div className="link-head">
              <span className="reorder">
                <button type="button" className="icon-btn sm" aria-label="Move up" onClick={() => move(l.id, -1)}>↑</button>
                <button type="button" className="icon-btn sm" aria-label="Move down" onClick={() => move(l.id, 1)}>↓</button>
              </span>
              <button type="button" className="grow link-btn left" onClick={() => setOpen(open === l.id ? null : l.id)}>
                <span className="row-title">{l.label || 'Untitled link'}</span>
                <span className="row-sub">{l.target_type === 'product' ? `Product · ${data.menuItems.find((m) => m.id === l.linked_listing_id)?.name ?? 'choose one'}` : l.url || 'No link yet'}</span>
              </button>
              <button type="button" className="icon-btn sm" aria-label="Remove link" onClick={() => set({ links: draft.links.filter((x) => x.id !== l.id) })}>×</button>
            </div>
            {open === l.id && <LinkForm link={l} sections={sections} update={(p) => update(l.id, p)} data={data} userId={userId} v2={v2} draft={draft} set={set} />}
          </li>
        ))}
      </ul>
      <Button type="button" variant="secondary" onClick={add}>+ Add a link</Button>
    </Section>
  );
}

function LinkForm({ link, sections, update, data, userId, v2, draft, set }: {
  link: Link; sections: string[]; update: (p: Partial<Link>) => void; data: StorefrontData; userId: string; v2: boolean;
  draft: StorefrontDraft; set: EditorProps['set'];
}) {
  const [err, setErr] = useState<string | null>(null);
  const designKey = link.id.toLowerCase();
  const ld: LinkDesign = draft.storefront_design?.links?.[designKey] ?? {};
  function setLd(patch: Partial<LinkDesign>) {
    const design = draft.storefront_design ?? {};
    const next = { ...ld, ...patch };
    (Object.keys(next) as (keyof LinkDesign)[]).forEach((k) => { if (next[k] === undefined || next[k] === '') delete next[k]; });
    set({ storefront_design: { ...design, links: { ...(design.links ?? {}), [designKey]: next } } });
  }
  return (
    <div className="link-form">
      <Field label="Button text"><Input value={link.label} onChange={(e) => update({ label: e.target.value })} /></Field>
      <Field label="Goes to">
        <Select value={link.target_type === 'file' ? 'url' : link.target_type} onChange={(e) => update({ target_type: e.target.value as Link['target_type'] })}>
          <option value="url">A web link</option>
          <option value="product">One of my listings</option>
        </Select>
      </Field>
      {link.target_type === 'product' ? (
        <Field label="Listing">
          <Select value={link.linked_listing_id ?? ''} onChange={(e) => update({ linked_listing_id: e.target.value || null })}>
            <option value="">Choose…</option>
            {data.menuItems.map((m) => <option key={m.id} value={m.id}>{m.name}{m.is_listed_in_marketplace ? '' : ' (not listed)'}</option>)}
          </Select>
        </Field>
      ) : (
        <Field label="Link"><Input type="url" placeholder="https://" value={link.url} onChange={(e) => update({ url: e.target.value })} /></Field>
      )}
      <Field label="Group" hint="Links with the same group name appear together.">
        <Input list="link-sections" value={link.section} onChange={(e) => update({ section: e.target.value })} />
        <datalist id="link-sections">{[...new Set(['My Links', ...sections])].map((s) => <option key={s} value={s} />)}</datalist>
      </Field>
      <Field label="Style">
        <Select value={link.style} onChange={(e) => update({ style: e.target.value as Link['style'] })}>
          <option value="list">Button</option>
          <option value="photoCard">Photo card</option>
          <option value="richCard">Card with photo &amp; text</option>
        </Select>
      </Field>
      {link.style !== 'list' && (
        <PhotoPicker label="Card photo" maxSide={1200} value={link.image_url}
          onPick={async (blob) => { try { update({ image_url: await uploadBuilderImage(userId, blob) }); } catch (e: any) { setErr(e.message); } }} />
      )}
      <Field label="Outline">
        <Select value={link.outline_style} onChange={(e) => update({ outline_style: e.target.value as Link['outline_style'] })}>
          <option value="none">None</option><option value="border">Border</option><option value="glow">Glow</option>
        </Select>
      </Field>
      <Toggle checked={link.shake} onChange={(v) => update({ shake: v })} label="Shake to draw attention" />
      {v2 && (
        <>
          <p className="small muted">New design styling (border and glow work independently here):</p>
          <div className="grid-2">
            <ColorField label="Button colour" value={ld.background} onChange={(v) => setLd({ background: v })} />
            <ColorField label="Text colour" value={ld.text} onChange={(v) => setLd({ text: v })} />
          </div>
          <Toggle checked={!!ld.border} onChange={(v) => setLd({ border: v || undefined })} label="Border" />
          {ld.border && <ColorField label="Border colour" value={ld.border_color} onChange={(v) => setLd({ border_color: v })} />}
          <Toggle checked={!!ld.glow} onChange={(v) => setLd({ glow: v || undefined })} label="Glow" />
          {ld.glow && <ColorField label="Glow colour" value={ld.glow_color} onChange={(v) => setLd({ glow_color: v })} />}
        </>
      )}
      {err && <ErrorBanner message={err} />}
    </div>
  );
}

/** Optional colour: empty means "use the theme". */
export function ColorField({ label, value, onChange }: { label: string; value?: string; onChange: (v: string | undefined) => void }) {
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <div className="color-row">
        <input type="color" value={value ?? '#000000'} onChange={(e) => onChange(e.target.value)} aria-label={label} className={value ? '' : 'unset'} />
        <span className="small muted grow">{value ?? 'Theme'}</span>
        {value && <button type="button" className="link-btn small" onClick={() => onChange(undefined)}>Reset</button>}
      </div>
    </div>
  );
}

// ── About / FAQ / Policies / Hours ────────────────────────────────────────

export function AboutEditor({ draft, set, data, userId }: EditorProps) {
  return (
    <Section title="About">
      <PhotoPicker label="Portrait" value={draft.images.portrait ?? storageURL('baker-portraits', userId, 'portrait.jpg', data.updatedAt)}
        onPick={async (blob) => set({ images: { ...draft.images, portrait: await blobToDataURL(blob) } })} />
      <Field label="Heading"><Input value={draft.about_heading} placeholder={`Meet ${data.firstName}`} onChange={(e) => set({ about_heading: e.target.value })} /></Field>
      <Field label="Your story"><Textarea rows={10} value={draft.about_story} onChange={(e) => set({ about_story: e.target.value })} /></Field>
    </Section>
  );
}

export function FAQEditor({ draft, set }: EditorProps) {
  const upd = (id: string, p: Partial<{ question: string; answer: string }>) => set({ faqs: draft.faqs.map((f) => (f.id === id ? { ...f, ...p } : f)) });
  return (
    <Section title="FAQ" hint="Answer the questions customers ask most.">
      {draft.faqs.map((f) => (
        <div key={f.id} className="faq-edit">
          <div className="link-head">
            <Input className="grow" placeholder="Question" value={f.question} onChange={(e) => upd(f.id, { question: e.target.value })} />
            <button type="button" className="icon-btn sm" aria-label="Remove question" onClick={() => set({ faqs: draft.faqs.filter((x) => x.id !== f.id) })}>×</button>
          </div>
          <Textarea rows={3} placeholder="Answer" value={f.answer} onChange={(e) => upd(f.id, { answer: e.target.value })} />
        </div>
      ))}
      <Button type="button" variant="secondary" onClick={() => set({ faqs: [...draft.faqs, newFAQ()] })}>+ Add a question</Button>
    </Section>
  );
}

export function PoliciesEditor({ draft, set }: EditorProps) {
  return (
    <Section title="Store policies" hint="Deposits, cancellations, allergens, refunds — anything customers should know.">
      <Textarea rows={14} value={draft.store_policies} onChange={(e) => set({ store_policies: e.target.value })} />
    </Section>
  );
}

const DAY_NAMES: Record<string, string> = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };

export function HoursEditor({ draft, set }: EditorProps) {
  const h = draft.pickup_hours_json;
  const setDay = (d: keyof typeof h, p: Partial<(typeof h)['mon']>) => set({ pickup_hours_json: { ...h, [d]: { ...h[d], ...p } } });
  return (
    <Section title="Pickup hours">
      <div className="hours">
        {WEEK_DAYS.map((d) => (
          <div key={d} className="hours-row">
            <label className="check"><input type="checkbox" checked={!h[d].closed} onChange={(e) => setDay(d, { closed: !e.target.checked })} />{DAY_NAMES[d]}</label>
            {h[d].closed ? <span className="muted small">Closed</span> : (
              <span className="hours-times">
                <Input type="time" value={h[d].open} onChange={(e) => setDay(d, { open: e.target.value })} />
                <span>–</span>
                <Input type="time" value={h[d].close} onChange={(e) => setDay(d, { close: e.target.value })} />
              </span>
            )}
          </div>
        ))}
      </div>
      <Field label="Neighbourhood" hint="Shown instead of your full address until someone orders."><Input value={draft.neighbourhood} onChange={(e) => set({ neighbourhood: e.target.value })} /></Field>
      <Field label="Pickup note"><Textarea rows={3} value={draft.pickup_note} onChange={(e) => set({ pickup_note: e.target.value })} placeholder="Porch pickup, ring the bell" /></Field>
    </Section>
  );
}

// ── Mailing list ──────────────────────────────────────────────────────────

export function MailingEditor({ draft, set, data }: EditorProps) {
  const downloads = data.menuItems.filter((m) => m.listing_kind === 'digital');
  return (
    <Section title="Mailing list signup" hint="Collect emails right on your storefront. Signups appear under Customers.">
      <Field label="Heading"><Input value={draft.email_capture_heading} placeholder="Join my list" onChange={(e) => set({ email_capture_heading: e.target.value })} /></Field>
      <Field label="Message"><Textarea rows={3} value={draft.email_capture_body} placeholder="Be first to hear about new drops." onChange={(e) => set({ email_capture_body: e.target.value })} /></Field>
      <Field label="Show it as">
        <Select value={draft.email_capture_display_style} onChange={(e) => set({ email_capture_display_style: e.target.value as 'inline' | 'popup' })}>
          <option value="inline">A section on the page</option>
          <option value="popup">A popup</option>
        </Select>
      </Field>
      <Field label="Free download for signing up (optional)" hint="Turns this into a lead magnet: they get the file when they join.">
        <Select value={draft.email_capture_deliverable_listing_id ?? ''} onChange={(e) => set({ email_capture_deliverable_listing_id: e.target.value || null })}>
          <option value="">None</option>
          {downloads.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </Select>
      </Field>
      <Toggle checked={draft.header_signup_enabled} onChange={(v) => set({ header_signup_enabled: v })} label="Sign-up button at the top of the page" />
      {draft.header_signup_enabled && (
        <Field label="Button text"><Input value={draft.header_signup_label} onChange={(e) => set({ header_signup_label: e.target.value })} /></Field>
      )}
    </Section>
  );
}
