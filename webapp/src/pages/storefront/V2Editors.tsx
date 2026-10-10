import { useState } from 'react';
import { Field, Input, Select, Textarea, Toggle, ErrorBanner } from '../../components/ui';
import {
  V2_CARDS, V2_FONTS, ensureDesign, uploadBuilderImage, v2DefaultTitle,
  type CardColors, type StorefrontDesign, type V2Block, type V2CardType,
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
      <Section title="Text & shape">
        <Field label="Heading font">
          <Select value={design.display_font ?? ''} onChange={(e) => setDesign({ display_font: e.target.value || undefined })}>
            <option value="">Theme default</option>
            {V2_FONTS.map((f) => <option key={f}>{f}</option>)}
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

export function CardsEditor(props: EditorProps & { onOpen: (t: V2CardType) => void }) {
  const { design, setDesign } = useDesign(props);
  const blocks = design.blocks ?? [];
  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= blocks.length) return;
    const next = [...blocks];
    [next[i], next[j]] = [next[j], next[i]];
    setDesign({ blocks: next });
  }
  return (
    <Section title="Cards" hint="Your profile card always comes first. Reorder, hide, or click a card to edit it.">
      <ul className="block-list">
        {blocks.map((b, i) => (
          <li key={b.type} className={b.hidden ? 'is-hidden' : ''}>
            <span className="reorder">
              <button type="button" className="icon-btn sm" aria-label="Move up" onClick={() => move(i, -1)}>↑</button>
              <button type="button" className="icon-btn sm" aria-label="Move down" onClick={() => move(i, 1)}>↓</button>
            </span>
            <button type="button" className="grow link-btn left" onClick={() => props.onOpen(b.type)}>
              <span className="row-title">{b.title || v2DefaultTitle(b.type, props.data.firstName)}</span>
              <span className="row-sub">{V2_CARDS.find((c) => c.type === b.type)?.label}</span>
            </button>
            <input type="checkbox" className="switch" aria-label="Show card" checked={!b.hidden}
              onChange={(e) => setDesign({ blocks: blocks.map((x, j) => (j === i ? { ...x, hidden: !e.target.checked } : x)) })} />
          </li>
        ))}
      </ul>
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

  return (
    <>
      <Section title={`${meta.label} card`}>
        <Toggle checked={!block.hidden} onChange={(v) => upd({ hidden: !v })} label="Show this card" />
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

      <Section title="Card colours">
        <CardColorFields value={block.colors ?? {}} onChange={(c) => upd({ colors: c })} />
      </Section>
      {err && <ErrorBanner message={err} />}
    </>
  );
}
