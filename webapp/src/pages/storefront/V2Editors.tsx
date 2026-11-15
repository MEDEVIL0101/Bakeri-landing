import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { getOrCreateReferralCode } from '../../lib/account';
import { Button, Field, Input, Modal, Select, Textarea, Toggle, ErrorBanner } from '../../components/ui';
import { menuImageURL } from '../../lib/menu';
import {
  V2_CARDS, V2_FONT_DEFS, V2_FONT_GROUPS, blockKey, ensureDesign, isPresale, offerListings, loadV2FontPreviews, uploadBuilderImage, v2DefaultTitle,
  type CardColors, type FocusPoint, type LinkDesign, type StorefrontData, type StorefrontDesign, type V2Block, type V2CardType,
} from '../../lib/storefront';
import { ColorField, PhotoPicker, Section, type EditorProps } from './Editors';

function useDesign({ draft, set, data }: Pick<EditorProps, 'draft' | 'set' | 'data'>) {
  const design = ensureDesign(draft, data);
  const setDesign = (patch: Partial<StorefrontDesign>) => set({ storefront_design: { ...design, ...patch } });
  return { design, setDesign };
}

/** Drops undefined keys so cleared settings fall back to the theme. */
function clean<T extends object>(o: T): T | undefined {
  const out = Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== '')) as T;
  return Object.keys(out).length ? out : undefined;
}

// ── Site design ───────────────────────────────────────────────────────────

export function DesignEditor(props: EditorProps) {
  const { design, setDesign } = useDesign(props);
  const [err, setErr] = useState<string | null>(null);
  const colors = design.colors ?? {};
  const bg = design.background ?? {};
  const mode = bg.mode ?? (bg.image_url ? 'image_top' : 'theme');
  const setColors = (p: Partial<typeof colors>) => setDesign({ colors: clean({ ...colors, ...p }) });
  const setBg = (p: Partial<typeof bg>) => setDesign({ background: clean({ ...bg, ...p }) });
  const identity = design.identity?.colors ?? {};

  return (
    <>
      <Section title="Site colours" hint="Leave any colour on “Theme” to use your theme’s. Card titles and prices follow each card’s own title colour.">
        <div className="grid-2">
          <ColorField label="Buttons & highlights" value={colors.accent} onChange={(v) => setColors({ accent: v })} />
          <ColorField label="Soft tint" value={colors.tint} onChange={(v) => setColors({ tint: v })} />
          <ColorField label="Sale (promo banner, sale prices, discount tags)" value={colors.sale} onChange={(v) => setColors({ sale: v })} />
        </div>
      </Section>
      <ShopNameSection name={props.draft.business_name} design={design} setDesign={setDesign} />
      <Section title="Text & shape">
        <Field label="Card heading font" hint="Card titles — and your shop name, unless you pick a font for it above.">
          <Select value={design.display_font ?? ''} onChange={(e) => setDesign({ display_font: e.target.value || undefined })}>
            <option value="">Theme default</option>
            {V2_FONT_GROUPS.map((g) => (
              <optgroup key={g} label={g}>
                {V2_FONT_DEFS.filter((f) => f.group === g).map((f) => <option key={f.name}>{f.name}</option>)}
              </optgroup>
            ))}
          </Select>
        </Field>
        <Field label="Corners">
          <Select value={design.corners ?? 'soft'} onChange={(e) => setDesign({ corners: e.target.value === 'soft' ? undefined : e.target.value })}>
            <option value="soft">Rounded</option>
            <option value="square">Square</option>
          </Select>
        </Field>
      </Section>
      <Section title="Background">
        <Field label="Style">
          <Select value={mode} onChange={(e) => setBg({ mode: e.target.value as typeof mode })}>
            <option value="theme">Theme</option>
            <option value="image_top">Photo header (fades into a colour)</option>
            <option value="image_full">Full photo</option>
          </Select>
        </Field>
        {mode !== 'theme' && (
          <PhotoPicker label="Background photo" maxSide={2400} value={bg.image_url ?? null}
            onPick={async (blob) => { try { setBg({ image_url: await uploadBuilderImage(props.userId, blob) }); } catch (e: any) { setErr(e.message); } }} />
        )}
        {mode === 'image_full' && (
          <>
            <Toggle checked={design.identity?.logo !== 'none'} label="Show logo circle" hint="Off: your photo fills the top of the page instead, like a link-in-bio page."
              onChange={(on) => setDesign({ identity: { ...(design.identity ?? {}), logo: on ? undefined : 'none' } })} />
            <Field label={`Raise photo: ${bg.raise ?? 0}%`} hint="Lifts the photo on phones so a face sits clear of your shop name.">
              <input type="range" min={0} max={30} step={1} value={bg.raise ?? 0} onChange={(e) => setBg({ raise: Number(e.target.value) || undefined })} />
            </Field>
          </>
        )}
        <ColorField label={mode === 'theme' ? 'Background colour' : 'Fade / surround colour'} value={bg.color} onChange={(v) => setBg({ color: v })} />
        {err && <ErrorBanner message={err} />}
      </Section>
      <Section title="Profile card colours">
        <CardColorFields value={identity} onChange={(c) => setDesign({ identity: (c || design.identity?.logo) ? { ...(c ? { colors: c } : {}), ...(design.identity?.logo ? { logo: design.identity.logo } : {}) } : undefined })} />
      </Section>
    </>
  );
}

/** The shop name's own font (shown in that font) and size. It always stays on one line. */
function ShopNameSection({ name, design, setDesign }: { name: string; design: StorefrontDesign; setDesign: (p: Partial<StorefrontDesign>) => void }) {
  useEffect(loadV2FontPreviews, []);
  const sample = name.trim() || 'Your shop';
  const headingFont = V2_FONT_DEFS.find((f) => f.name === design.display_font) ?? V2_FONT_DEFS[0];
  const size = design.title_size ?? 100;
  const titleFont = V2_FONT_DEFS.find((f) => f.name === design.title_font) ?? headingFont;
  return (
    <Section title="Shop name" hint="Your name stays on one line — a long name shrinks to fit.">
      {/* The shop name's own colour (design.colors.ink) — card titles and
          prices follow each card's title colour instead. */}
      <ColorField label="Colour" value={design.colors?.ink} onChange={(v) => setDesign({ colors: { ...(design.colors ?? {}), ink: v } })} />
      <Field label="Font">
        <Select value={design.title_font ?? ''} onChange={(e) => setDesign({ title_font: e.target.value || undefined })}>
          <option value="">Same as card headings ({headingFont.name})</option>
          {V2_FONT_GROUPS.map((g) => (
            <optgroup key={g} label={g}>
              {V2_FONT_DEFS.filter((f) => f.group === g).map((f) => <option key={f.name}>{f.name}</option>)}
            </optgroup>
          ))}
        </Select>
      </Field>
      <div className="font-tile-sample ellipsis" aria-hidden style={{ fontFamily: `"${titleFont.name}", system-ui`, fontWeight: titleFont.w, fontSize: 26 }}>{sample}</div>
      <div className="stack">
        <span className="field-label">Size</span>
        <div className="pct-row">
          <span className="small muted" aria-hidden>A</span>
          <input type="range" min={50} max={200} step={5} value={size} aria-label="Shop name size"
            onChange={(e) => { const v = Number(e.target.value); setDesign({ title_size: v === 100 ? undefined : v }); }} />
          <span style={{ fontSize: 20, fontWeight: 700 }} aria-hidden>A</span>
          <span className="small tabular" style={{ minWidth: 40, textAlign: 'right' }}>{size}%</span>
        </div>
        {size !== 100 && <button type="button" className="link-btn" style={{ alignSelf: 'flex-start' }} onClick={() => setDesign({ title_size: undefined })}>Reset size</button>}
      </div>
      <TitleEffects design={design} setDesign={setDesign} />
    </Section>
  );
}

/** Outline, drop shadow and glow on the shop name, to lift it off a busy background. */
function TitleEffects({ design, setDesign }: { design: StorefrontDesign; setDesign: (p: Partial<StorefrontDesign>) => void }) {
  const fx = design.title_effect ?? {};
  const upd = (p: Partial<typeof fx>) => setDesign({ title_effect: clean({ ...fx, ...p }) });
  const width = fx.stroke_width ?? 2;
  return (
    <div className="stack">
      <span className="field-label">Make it stand out</span>
      <Toggle checked={!!fx.stroke} onChange={(v) => upd({ stroke: v ? '#FFFFFF' : undefined, stroke_width: undefined })} label="Outline" />
      {fx.stroke && (
        <div className="grid-2">
          <ColorField label="Outline colour" value={fx.stroke} onChange={(v) => upd({ stroke: v ?? '#FFFFFF' })} />
          <div className="field">
            <span className="field-label">Thickness</span>
            <div className="pct-row">
              <input type="range" min={1} max={8} step={1} value={width} aria-label="Outline thickness"
                onChange={(e) => { const v = Number(e.target.value); upd({ stroke_width: v === 2 ? undefined : v }); }} />
              <span className="small tabular">{width}px</span>
            </div>
          </div>
        </div>
      )}
      <Toggle checked={!!fx.shadow} onChange={(v) => upd({ shadow: v ? '#000000' : undefined })} label="Drop shadow" />
      {fx.shadow && <ColorField label="Shadow colour" value={fx.shadow} onChange={(v) => upd({ shadow: v ?? '#000000' })} />}
      <Toggle checked={!!fx.glow} onChange={(v) => upd({ glow: v ? '#FFFFFF' : undefined })} label="Glow" />
      {fx.glow && <ColorField label="Glow colour" value={fx.glow} onChange={(v) => upd({ glow: v ?? '#FFFFFF' })} />}
    </div>
  );
}

function CardColorFields({ value, onChange }: { value: CardColors; onChange: (c: CardColors | undefined) => void }) {
  const upd = (p: Partial<CardColors>) => onChange(clean({ ...value, ...p }));
  return (
    <div className="grid-2">
      <ColorField label="Card background" value={value.background} onChange={(v) => upd({ background: v })} />
      <ColorField label="Title & prices" value={value.title} onChange={(v) => upd({ title: v })} />
      <ColorField label="Text" value={value.text} onChange={(v) => upd({ text: v })} />
      <ColorField label="Buttons" value={value.button} onChange={(v) => upd({ button: v })} />
    </div>
  );
}

// ── Cards list ────────────────────────────────────────────────────────────

// ── Forms on the site (form takeover with one or more forms) ──────────────
// Mirrors iOS V2CardSheet.siteFormsSection and next.html's sfForms.

function SiteFormsSection({ data, block, upd, looks, setLooks }: {
  data: EditorProps['data']; block: V2Block; upd: (p: Partial<V2Block>) => void;
  looks: Record<string, LinkDesign>; setLooks: (forms: Record<string, LinkDesign>) => void;
}) {
  const [styling, setStyling] = useState<string | null>(null);
  const setLook = (id: string, p: Partial<LinkDesign>) => {
    const next: LinkDesign = { ...(looks[id] ?? {}), ...p };
    (Object.keys(next) as (keyof LinkDesign)[]).forEach((k) => { if (next[k] === undefined || next[k] === false) delete next[k]; });
    const all = { ...looks };
    if (Object.keys(next).length) all[id] = next; else delete all[id];
    setLooks(all);
  };
  const primary = String((data.publicProfile as any)?.storefront_listing_id ?? '').toLowerCase();
  const order = block.forms_order ?? [];
  const forms = data.menuItems
    .filter((m) => m.is_listed_in_marketplace && m.intake_form_id && (m.is_storefront_form || m.id.toLowerCase() === primary))
    .sort((a, b) => {
      const ia = order.indexOf(a.id.toLowerCase()), ib = order.indexOf(b.id.toLowerCase());
      if (ia !== ib) return (ia < 0 ? 1e9 : ia) - (ib < 0 ? 1e9 : ib);
      const pa = a.id.toLowerCase() === primary, pb = b.id.toLowerCase() === primary;
      if (pa !== pb) return pa ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  if (!primary || !forms.some((f) => f.id.toLowerCase() === primary)) return null;
  const valid = block.forms_expanded === 'none' || forms.some((f) => f.id.toLowerCase() === block.forms_expanded);
  const pick = valid && block.forms_expanded ? block.forms_expanded : (forms.length === 1 ? forms[0].id.toLowerCase() : 'none');
  const move = (i: number, d: number) => {
    const ids = forms.map((f) => f.id.toLowerCase());
    [ids[i], ids[i + d]] = [ids[i + d], ids[i]];
    upd({ forms_order: ids });
  };
  return (
    <Section title="Forms on your site"
      hint={forms.length > 1
        ? 'Your forms stack as cards in this section, like link cards — give each its own colours, border, glow or shake. Customers tap one to open it. Turn more forms on from your listings.'
        : 'Collapsed shows a card customers tap to open the form. Turn on another form from your listings to stack them.'}>
      <Field label={forms.length > 1 ? 'Show open' : 'Show the form'}>
        <Select value={pick} onChange={(e) => upd({ forms_expanded: e.target.value })}>
          <option value="none">{forms.length > 1 ? 'All collapsed' : 'Collapsed'}</option>
          {forms.map((f) => <option key={f.id} value={f.id.toLowerCase()}>{forms.length > 1 ? f.name : 'Expanded'}</option>)}
        </Select>
      </Field>
      <div className="stack">
        {forms.map((f, i) => {
          const id = f.id.toLowerCase();
          const look = looks[id] ?? {};
          return (
            <div key={f.id} className="stack">
              <div className="row-between">
                <span className="ellipsis">{f.name}</span>
                <span>
                  <button type="button" className="link-btn small" onClick={() => setStyling(styling === id ? null : id)}>{styling === id ? 'Done' : 'Card look'}</button>
                  {forms.length > 1 && <>
                    <button type="button" className="icon-btn sm" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
                    <button type="button" className="icon-btn sm" aria-label="Move down" disabled={i === forms.length - 1} onClick={() => move(i, 1)}>↓</button>
                  </>}
                </span>
              </div>
              {styling === id && (
                <div className="stack">
                  <div className="grid-2">
                    <ColorField label="Card colour" value={look.background} onChange={(v) => setLook(id, { background: v })} />
                    <ColorField label="Text colour" value={look.text} onChange={(v) => setLook(id, { text: v })} />
                  </div>
                  <Toggle checked={!!look.border} onChange={(v) => setLook(id, { border: v || undefined })} label="Border" />
                  {look.border && <ColorField label="Border colour" value={look.border_color} onChange={(v) => setLook(id, { border_color: v })} />}
                  <Toggle checked={!!look.glow} onChange={(v) => setLook(id, { glow: v || undefined })} label="Glow" />
                  {look.glow && <ColorField label="Glow colour" value={look.glow_color} onChange={(v) => setLook(id, { glow_color: v })} />}
                  <Toggle checked={!!look.shake} onChange={(v) => setLook(id, { shake: v || undefined })} label="Shake to draw attention" />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Section>
  );
}

// ── One card's settings ───────────────────────────────────────────────────

export function CardSettings(props: EditorProps & { type: V2CardType }) {
  const { design, setDesign } = useDesign(props);
  const [err, setErr] = useState<string | null>(null);
  const meta = V2_CARDS.find((c) => c.type === props.type)!;
  const blocks = design.blocks ?? [];
  const block: V2Block = blocks.find((b) => b.type === props.type) ?? { type: props.type };
  const upd = (p: Partial<V2Block>) => {
    const next = { ...block, ...p };
    (Object.keys(next) as (keyof V2Block)[]).forEach((k) => { if (next[k] === undefined || next[k] === '') delete next[k]; });
    setDesign({ blocks: blocks.some((b) => b.type === props.type) ? blocks.map((b) => (b.type === props.type ? next : b)) : [...blocks, next] });
  };
  const nav = block.nav ?? meta.navByDefault;
  const downloads = props.data.menuItems.filter((m) => m.listing_kind === 'digital');

  // Same order as the page reads (and the app's card sheet): whether the
  // card shows, its button in the navigation menu at the top, then the card
  // itself (title, colours), then what's in it.
  return (
    <>
      <Section title={`${meta.label} card`}>
        <Toggle checked={!block.hidden} onChange={(v) => upd({ hidden: !v })} label="Show this card"
          hint={block.hidden ? 'Hidden — this card and its menu button don’t appear on your page.' : undefined} />
      </Section>

      {/* A hidden card has no menu button to set up. */}
      {!block.hidden && (
      <Section title="Navigation menu button" hint="This card’s button in the menu at the top of your page.">
        <Toggle checked={nav} onChange={(v) => upd({ nav: v === meta.navByDefault ? undefined : v })} label="Show in the menu" />
        {nav && (
          <>
            <Field label="Button text"><Input value={block.nav_label ?? ''} placeholder={block.title || v2DefaultTitle(props.type, props.data.firstName)} onChange={(e) => upd({ nav_label: e.target.value || undefined })} /></Field>
            <div className="grid-2">
              <ColorField label="Button colour" value={block.nav_color} onChange={(v) => upd({ nav_color: v })} />
              <ColorField label="Text colour" value={block.nav_text_color} onChange={(v) => upd({ nav_text_color: v })} />
            </div>
            <Toggle checked={!!block.nav_border} onChange={(v) => upd({ nav_border: v || undefined })} label="Border" />
            {block.nav_border && <ColorField label="Border colour" value={block.nav_border_color} onChange={(v) => upd({ nav_border_color: v })} />}
            <Toggle checked={!!block.nav_shake} onChange={(v) => upd({ nav_shake: v || undefined })} label="Shake to draw attention" />
          </>
        )}
      </Section>
      )}

      {!block.hidden && (
      <Section title="The card" hint="Its title and colours on your page.">
        <Field label="Card title"><Input value={block.title ?? ''} placeholder={v2DefaultTitle(props.type, props.data.firstName)} onChange={(e) => upd({ title: e.target.value || undefined })} /></Field>
        {meta.parts && (
          <div className="stack">
            <span className="field-label">Includes</span>
            {meta.parts.map((p) => (
              <label key={p.key} className="check">
                <input type="checkbox" checked={!block.parts_hidden?.includes(p.key)}
                  onChange={(e) => {
                    const hidden = new Set(block.parts_hidden ?? []);
                    if (e.target.checked) hidden.delete(p.key); else hidden.add(p.key);
                    upd({ parts_hidden: hidden.size ? [...hidden] : undefined });
                  }} />
                {p.label}
              </label>
            ))}
          </div>
        )}
        <CardColorFields value={block.colors ?? {}} onChange={(c) => upd({ colors: c })} />
      </Section>
      )}

      {props.type === 'menu' && !block.hidden && (
        <SiteFormsSection data={props.data} block={block} upd={upd}
          looks={design.forms ?? {}} setLooks={(forms) => setDesign({ forms: Object.keys(forms).length ? forms : undefined })} />
      )}

      {props.type === 'leadMagnet' && (
        <Section title="Free download" hint="Visitors enter their email and get this file. They’re added to your mailing list.">
          <Field label="File to give away">
            <Select value={block.listing_id ?? ''} onChange={(e) => upd({ listing_id: e.target.value ? e.target.value.toLowerCase() : undefined })}>
              <option value="">Choose a digital listing…</option>
              {downloads.map((m) => <option key={m.id} value={m.id.toLowerCase()}>{m.name}</option>)}
            </Select>
          </Field>
          <Field label="Heading"><Input value={block.heading ?? ''} onChange={(e) => upd({ heading: e.target.value || undefined })} /></Field>
          <Field label="Description"><Textarea rows={3} value={block.body ?? ''} onChange={(e) => upd({ body: e.target.value || undefined })} /></Field>
        </Section>
      )}

      {(props.type === 'leadMagnet' || props.type === 'emailCapture') && (
        <Section title="Card picture">
          <PhotoPicker label="Picture (optional)" maxSide={1600} value={block.image_url ?? null}
            onPick={async (blob) => { try { upd({ image_url: await uploadBuilderImage(props.userId, blob) }); } catch (e: any) { setErr(e.message); } }} />
          {block.image_url && <button type="button" className="link-btn small" onClick={() => upd({ image_url: undefined })}>Remove picture</button>}
        </Section>
      )}

      {(props.type === 'menu' || props.type === 'products') && <PhotoFocusSection {...props} type={props.type} />}
      {err && <ErrorBanner message={err} />}
    </>
  );
}

// ── Photo focus ───────────────────────────────────────────────────────────

type BuilderItem = StorefrontData['menuItems'][number];

/**
 * "Tap the subject" for each listing photo this card shows, like the app's
 * PHOTO FOCUS section. Stored in storefront_design.focus.items[listingId]
 * (lowercased id); next.html crops every tile/photo around it.
 */
function PhotoFocusSection(props: EditorProps & { type: 'menu' | 'products' }) {
  const { design, setDesign } = useDesign(props);
  const [editing, setEditing] = useState<BuilderItem | null>(null);
  const items = props.data.menuItems.filter((m) => m.has_image && (props.type === 'menu'
    ? m.is_listed_in_marketplace && ['ready_now', 'preorder', 'custom'].includes(m.listing_kind)
    : ['physical', 'digital'].includes(m.listing_kind) && !m.is_lead_magnet));
  if (!items.length) return null;
  const all = design.focus?.items ?? {};
  const setPoint = (item: BuilderItem, p: FocusPoint | null) => {
    const next = { ...all };
    if (p) next[item.id.toLowerCase()] = p; else delete next[item.id.toLowerCase()];
    const focus = { ...(design.focus ?? {}), items: Object.keys(next).length ? next : undefined };
    if (!focus.items) delete focus.items;
    setDesign({ focus: Object.keys(focus).length ? focus : undefined });
  };
  return (
    <Section title="Photo focus" hint="Photos are cropped to fit. Tap the subject so it stays in frame on every screen size.">
      <ul className="focus-list">
        {items.map((m) => (
          <li key={m.id}>
            <button type="button" className="focus-row" onClick={() => setEditing(m)}>
              <img src={menuImageURL(m)} alt="" />
              <span className="grow ellipsis">{m.name}</span>
              <span className="small muted">{all[m.id.toLowerCase()] ? 'Set' : 'Automatic'}</span>
              <span className="chev" aria-hidden>›</span>
            </button>
          </li>
        ))}
      </ul>
      {editing && (
        <FocalPointModal title={editing.name} src={menuImageURL(editing)} point={all[editing.id.toLowerCase()] ?? null}
          onSave={(p) => { setPoint(editing, p); setEditing(null); }} onClose={() => setEditing(null)} />
      )}
    </Section>
  );
}

const round1 = (v: number) => Math.round(Math.max(0, Math.min(100, v)) * 10) / 10;

/** Tap or drag on the photo to place the focal point; previews show how tiles crop around it. */
export function FocalPointModal({ title, src, point, onSave, onClose }: {
  title: string; src: string; point: FocusPoint | null; onSave: (p: FocusPoint | null) => void; onClose: () => void;
}) {
  const [p, setP] = useState<FocusPoint | null>(point);
  const box = useRef<HTMLDivElement>(null);
  const place = (e: React.PointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    setP({ x: round1(((e.clientX - r.left) / r.width) * 100), y: round1(((e.clientY - r.top) / r.height) * 100) });
  };
  const pos = p ? `${p.x}% ${p.y}%` : '50% 50%';
  return (
    <Modal title="Photo focus" wide onClose={onClose}
      footer={<>
        <Button variant="ghost" className="mr-auto" onClick={() => onSave(null)} disabled={!point && !p}>Use automatic</Button>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={() => onSave(p)} disabled={!p}>Save</Button>
      </>}>
      <p className="small muted">Tap the subject of <strong>{title}</strong> — it stays in frame however the photo is cropped.</p>
      <div className="focal-stage">
        <div className="focal-photo" ref={box}
          onPointerDown={(e) => { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); place(e); }}
          onPointerMove={(e) => { if (e.buttons) place(e); }}>
          <img src={src} alt="" draggable={false} />
          {p && <span className="focal-dot" style={{ left: `${p.x}%`, top: `${p.y}%` }} />}
        </div>
      </div>
      <div className="focal-previews" aria-label="Crop previews">
        <figure><div className="focal-crop sq"><img src={src} alt="" style={{ objectPosition: pos }} /></div><figcaption>Tile</figcaption></figure>
        <figure><div className="focal-crop wide"><img src={src} alt="" style={{ objectPosition: pos }} /></div><figcaption>Wide</figcaption></figure>
        <figure><div className="focal-crop tall"><img src={src} alt="" style={{ objectPosition: pos }} /></div><figcaption>Tall</figcaption></figure>
      </div>
    </Modal>
  );
}

/** Bakerï Referral card: what it shows, with the vendor's own code. */
/**
 * A course or club's own card on the page (block type 'offer'): whether it
 * shows, its words, its colours and border / glow / shake — plus the way to
 * its content and the member view.
 */
export function OfferCardSettings(props: EditorProps & { listingId: string }) {
  const { design, setDesign } = useDesign(props);
  const id = props.listingId.toLowerCase();
  const offer = offerListings(props.data).find((o) => String(o.id).toLowerCase() === id);
  const blocks = design.blocks ?? [];
  const block: V2Block = blocks.find((b) => blockKey(b) === `offer:${id}`) ?? { type: 'offer', listing_id: id };
  const upd = (p: Partial<V2Block>) => {
    const next = { ...block, ...p };
    (Object.keys(next) as (keyof V2Block)[]).forEach((k) => { if (k !== 'hidden' && (next[k] === undefined || next[k] === '' || next[k] === false)) delete next[k]; });
    next.hidden = !!next.hidden;   // always written — iPhone builds require it
    const has = blocks.some((b) => blockKey(b) === `offer:${id}`);
    setDesign({ blocks: has ? blocks.map((b) => (blockKey(b) === `offer:${id}` ? next : b)) : [...blocks, next] });
  };
  if (!offer) return <p className="muted">This item isn’t listed any more (or its pre-sale has ended).</p>;
  // Each kind gets its own card: course / club (words + member preview — its
  // lessons are built in the course itself) or pre-sale (words + its dates).
  const isSpace = !!offer.is_course;
  const kind = offer.is_club ? 'club' : isSpace ? 'course' : 'pre-sale';
  const price = `$${Number(offer.price).toFixed(2)}`;
  const defaultButton = offer.is_club ? (offer.club_interval ? `Join — ${price}/${offer.club_interval === 'year' ? 'yr' : 'mo'}` : `Join — ${price}`)
    : isSpace ? `Get the course — ${price}` : `Pre-order — ${price}`;
  const day = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '');
  return (
    <>
      <Section title={offer.is_club ? 'Club card' : isSpace ? 'Course card' : 'Pre-sale card'}>
        <Toggle checked={!block.hidden} onChange={(v) => upd({ hidden: !v })} label="Show this card"
          hint={block.hidden
            ? (isSpace ? `Hidden — people can still reach the ${kind} from a direct link.` : 'Hidden — it shows in your Products grid instead.')
            : isSpace ? `Its own card on your page, with the ${offer.is_club ? 'join' : 'buy'} button and “Already a member? Sign in”.`
            : 'Its own card on your page with a pre-order button — not repeated in your Products grid.'} />
        {isSpace && (
          <a className="btn btn-ghost" href={`/baker/course.html?owner=${offer.id}`} target="_blank" rel="noreferrer">Preview as a member ↗</a>
        )}
      </Section>
      {!isSpace && !block.hidden && (
        <Section title="Pre-sale" hint="The card shows these from the product itself.">
          <p className="small">
            {offer.listing_kind === 'physical' ? 'Ships' : 'Arrives'} {day(offer.presale_release_at)}
            {offer.presale_order_by ? ` · pre-order by ${day(offer.presale_order_by)}` : ''}
            {offer.sell_limit ? ` · limit ${offer.sell_limit}` : ''}
          </p>
          <Link className="btn btn-secondary" to={`/menu/${offer.id}`}><span>Edit dates, price &amp; stock</span></Link>
        </Section>
      )}
      {!block.hidden && (
        <>
          <Section title="Words" hint="Leave blank to use the listing’s name and description.">
            <Field label="Title"><Input value={block.title ?? ''} placeholder={offer.name} onChange={(e) => upd({ title: e.target.value || undefined })} /></Field>
            <Field label="Short pitch"><Textarea rows={3} value={block.blurb ?? ''} placeholder={String(offer.item_description ?? '').slice(0, 160)}
              onChange={(e) => upd({ blurb: e.target.value || undefined })} /></Field>
            <Field label="Button text"><Input value={block.button_label ?? ''} placeholder={defaultButton} onChange={(e) => upd({ button_label: e.target.value || undefined })} /></Field>
          </Section>
          <Section title="Look" hint="The card’s colours, plus a border, glow or shake to make it stand out.">
            <CardColorFields value={block.colors ?? {}} onChange={(c) => upd({ colors: c })} />
            <Toggle checked={!!block.border} onChange={(v) => upd({ border: v || undefined })} label="Border" />
            {block.border && <ColorField label="Border colour" value={block.border_color} onChange={(v) => upd({ border_color: v })} />}
            <Toggle checked={!!block.glow} onChange={(v) => upd({ glow: v || undefined })} label="Glow" />
            {block.glow && <ColorField label="Glow colour" value={block.glow_color} onChange={(v) => upd({ glow_color: v })} />}
            <Toggle checked={!!block.shake} onChange={(v) => upd({ shake: v || undefined })} label="Shake to draw attention" />
          </Section>
          <Section title="Navigation menu button" hint="A button for this card in the menu at the top of your page.">
            <Toggle checked={!!block.nav} onChange={(v) => upd({ nav: v || undefined })} label="Show in the menu" />
            {block.nav && (
              <>
                <Field label="Button text"><Input value={block.nav_label ?? ''} placeholder={block.title || offer.name} onChange={(e) => upd({ nav_label: e.target.value || undefined })} /></Field>
                <div className="grid-2">
                  <ColorField label="Button colour" value={block.nav_color} onChange={(v) => upd({ nav_color: v })} />
                  <ColorField label="Text colour" value={block.nav_text_color} onChange={(v) => upd({ nav_text_color: v })} />
                </div>
                <Toggle checked={!!block.nav_shake} onChange={(v) => upd({ nav_shake: v || undefined })} label="Shake to draw attention" />
              </>
            )}
          </Section>
        </>
      )}
    </>
  );
}

/**
 * What's in the Courses / Clubs section: every listed course or club of that
 * kind, each of which can be featured on its own big card instead (an
 * 'offer' block, placed right after this section — drag it anywhere).
 */
export function SpacesSectionContent(props: EditorProps & { club: boolean }) {
  const { design, setDesign } = useDesign(props);
  const blocks = design.blocks ?? [];
  const items = offerListings(props.data).filter((o) => o.is_course && !!o.is_club === props.club);
  const kind = props.club ? 'club' : 'course';
  const featured = (id: string) => blocks.some((b) => b.type === 'offer' && String(b.listing_id).toLowerCase() === id && !b.hidden);
  const toggle = (id: string, on: boolean) => {
    const rest = blocks.filter((b) => !(b.type === 'offer' && String(b.listing_id).toLowerCase() === id));
    if (!on) { setDesign({ blocks: rest }); return; }
    const at = rest.findIndex((b) => b.type === (props.club ? 'clubs' : 'courses'));
    rest.splice(at === -1 ? rest.length : at + 1, 0, { type: 'offer', listing_id: id, hidden: false });
    setDesign({ blocks: rest });
  };
  return (
    <Section title={`Your ${kind}s`} hint={items.length
      ? `Every listed ${kind} shows in this section. Feature one to give it its own big card — then drag that card anywhere on your page.`
      : `You have no listed ${kind}s yet, so this section is hidden on your page.`}>
      {items.map((o) => {
        const id = String(o.id).toLowerCase();
        return (
          <div key={id} className="row-between">
            <span className="ellipsis">{o.name}</span>
            <Toggle checked={featured(id)} onChange={(v) => toggle(id, v)} label="Feature on its own card" />
          </div>
        );
      })}
      <Link className="btn btn-secondary" to={props.club ? '/clubs' : '/courses'}><span>{props.club ? 'Manage clubs' : 'Manage courses'}</span></Link>
    </Section>
  );
}

/**
 * Products card: each pre-sale either stays in the grid or gets its own
 * highlight card ('offer' block, right after Products) — like a featured
 * course or club. Nothing shows when there are no pre-sales.
 */
export function PresalesFeatureContent(props: EditorProps) {
  const { design, setDesign } = useDesign(props);
  const blocks = design.blocks ?? [];
  const items = (props.data.listings ?? []).filter((l: any) => isPresale(l) && !l.is_course);
  if (!items.length) return null;
  const featured = (id: string) => blocks.some((b) => b.type === 'offer' && String(b.listing_id).toLowerCase() === id && !b.hidden);
  const toggle = (id: string, on: boolean) => {
    const rest = blocks.filter((b) => !(b.type === 'offer' && String(b.listing_id).toLowerCase() === id));
    if (!on) { setDesign({ blocks: rest }); return; }
    const at = rest.findIndex((b) => b.type === 'products');
    rest.splice(at === -1 ? rest.length : at + 1, 0, { type: 'offer', listing_id: id, hidden: false });
    setDesign({ blocks: rest });
  };
  return (
    <Section title="Your pre-sales" hint="A pre-sale stays in this grid, or give it its own highlight card — it moves out of the grid into a card you can retitle and style, then drag anywhere.">
      {items.map((o: any) => {
        const id = String(o.id).toLowerCase();
        return (
          <div key={id} className="row-between">
            <span className="ellipsis">{o.name}</span>
            <Toggle checked={featured(id)} onChange={(v) => toggle(id, v)} label="Feature on its own card" />
          </div>
        );
      })}
    </Section>
  );
}

export function ReferralCardInfo() {
  const [code, setCode] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { getOrCreateReferralCode().then(setCode, (e) => setErr(e?.message ?? 'Couldn’t load your code.')); }, []);
  return (
    <Section title="Your code">
      {code && <p style={{ margin: 0 }}><b style={{ letterSpacing: '.06em' }}>{code}</b> · 10% off a new shop’s first 3 months</p>}
      {err && <ErrorBanner message={err} />}
      <p className="small muted">Earnings in <Link to="/refer">Referral Program</Link>.</p>
    </Section>
  );
}
