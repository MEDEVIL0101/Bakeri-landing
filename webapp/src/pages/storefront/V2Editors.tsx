import { useEffect, useRef, useState } from 'react';
import { Button, Field, Input, Modal, Select, Textarea, Toggle, ErrorBanner } from '../../components/ui';
import { menuImageURL } from '../../lib/menu';
import {
  V2_CARDS, V2_FONT_DEFS, V2_FONT_GROUPS, ensureDesign, loadV2FontPreviews, uploadBuilderImage, v2DefaultTitle,
  type CardColors, type FocusPoint, type StorefrontData, type StorefrontDesign, type V2Block, type V2CardType,
} from '../../lib/storefront';
import { ColorField, PhotoPicker, Section, type EditorProps } from './Editors';

function useDesign({ draft, set }: Pick<EditorProps, 'draft' | 'set'>) {
  const design = ensureDesign(draft);
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
      <Section title="Site colours" hint="Leave any colour on “Theme” to use your theme’s.">
        <div className="grid-2">
          <ColorField label="Buttons & highlights" value={colors.accent} onChange={(v) => setColors({ accent: v })} />
          <ColorField label="Titles & prices" value={colors.ink} onChange={(v) => setColors({ ink: v })} />
          <ColorField label="Soft tint" value={colors.tint} onChange={(v) => setColors({ tint: v })} />
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
          <PhotoPicker label="Background photo" maxSide={1600} value={bg.image_url ?? null}
            onPick={async (blob) => { try { setBg({ image_url: await uploadBuilderImage(props.userId, blob) }); } catch (e: any) { setErr(e.message); } }} />
        )}
        <ColorField label={mode === 'theme' ? 'Background colour' : 'Fade / surround colour'} value={bg.color} onChange={(v) => setBg({ color: v })} />
        {err && <ErrorBanner message={err} />}
      </Section>
      <Section title="Profile card colours">
        <CardColorFields value={identity} onChange={(c) => setDesign({ identity: c ? { colors: c } : undefined })} />
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
  const tile = (value: string | undefined, f: (typeof V2_FONT_DEFS)[number], label?: string) => (
    <button key={value ?? '_same'} type="button" className={`font-tile ${design.title_font === value ? 'on' : ''}`} aria-pressed={design.title_font === value}
      onClick={() => setDesign({ title_font: value })}>
      <span className="font-tile-sample ellipsis" style={{ fontFamily: `"${f.name}", system-ui`, fontWeight: f.w }}>{sample}</span>
      <span className="font-tile-name">{label ?? f.name}</span>
    </button>
  );
  return (
    <Section title="Shop name" hint="Your name stays on one line — a long name shrinks to fit.">
      <div className="stack">
        <span className="field-label">Font</span>
        <div className="font-tiles">
          {tile(undefined, headingFont, 'Same as card headings')}
          {V2_FONT_GROUPS.map((g) => (
            <div key={g} className="font-tile-group">
              <span className="font-tile-group-label">{g}</span>
              {V2_FONT_DEFS.filter((f) => f.group === g).map((f) => tile(f.name, f))}
            </div>
          ))}
        </div>
      </div>
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
      <ColorField label="Title" value={value.title} onChange={(v) => upd({ title: v })} />
      <ColorField label="Text" value={value.text} onChange={(v) => upd({ text: v })} />
      <ColorField label="Buttons" value={value.button} onChange={(v) => upd({ button: v })} />
    </div>
  );
}

// ── Cards list ────────────────────────────────────────────────────────────

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

  return (
    <>
      <Section title={`${meta.label} card`}>
        <Toggle checked={!block.hidden} onChange={(v) => upd({ hidden: !v })} label="Show this card"
          hint={block.hidden ? 'Hidden — this card and its menu button don’t appear on your page.' : undefined} />
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
      </Section>

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
          <PhotoPicker label="Picture (optional)" maxSide={1200} value={block.image_url ?? null}
            onPick={async (blob) => { try { upd({ image_url: await uploadBuilderImage(props.userId, blob) }); } catch (e: any) { setErr(e.message); } }} />
          {block.image_url && <button type="button" className="link-btn small" onClick={() => upd({ image_url: undefined })}>Remove picture</button>}
        </Section>
      )}

      {/* A hidden card has no menu button to set up. */}
      {!block.hidden && (
      <Section title="Menu button" hint="A button for this card in the menu on your profile card.">
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

      <Section title="Card colours">
        <CardColorFields value={block.colors ?? {}} onChange={(c) => upd({ colors: c })} />
      </Section>
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
