import { useRef, useState } from 'react';
import { Button, Input, Select, Textarea } from './ui';
import {
  BLOCK_KINDS, blockLabel, newBlock, uploadContentImage, videoEmbedURL,
  type ContentBlock, type ContentBlockType,
} from '../lib/contentBlocks';

/**
 * The product-page builder: an ordered list of blocks (text, heading, lists,
 * photos, a gallery, a video, a callout panel, small print, dividers). Mirrors
 * iOS ContentBlocksEditorView — same block types, same JSON.
 */
export function ContentBlocksEditor({ userId, blocks, onChange }: {
  userId: string;
  blocks: ContentBlock[];
  /** Gets an updater, so a photo upload that finishes later applies to the
   *  blocks as they are then, not as they were when it started. */
  onChange: (update: (prev: ContentBlock[]) => ContentBlock[]) => void;
}) {
  const update = (id: string, patch: Partial<ContentBlock>) => onChange((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  const move = (id: string, by: number) => onChange((prev) => {
    const i = prev.findIndex((b) => b.id === id), j = i + by;
    if (i < 0 || j < 0 || j >= prev.length) return prev;
    const next = prev.slice();
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });
  const remove = (id: string) => onChange((prev) => prev.filter((b) => b.id !== id));
  const add = (type: ContentBlockType, style?: 'bullet' | 'check') => onChange((prev) => [...prev, newBlock(type, style)]);

  return (
    <div className="cb-editor">
      {blocks.length === 0 && (
        <p className="small muted">
          Build the page customers see when they open this product: sections, photos, lists, a video, testimonials.
          Without one, they see the description above.
        </p>
      )}
      {blocks.map((b, i) => (
        <div className="cb-block" key={b.id}>
          <div className="cb-block-head">
            <span className="cb-block-kind">{blockLabel(b)}</span>
            <div className="cb-block-tools">
              <button type="button" onClick={() => move(b.id, -1)} disabled={i === 0} aria-label="Move up">↑</button>
              <button type="button" onClick={() => move(b.id, 1)} disabled={i === blocks.length - 1} aria-label="Move down">↓</button>
              <button type="button" onClick={() => remove(b.id)} aria-label="Remove">✕</button>
            </div>
          </div>
          <BlockFields userId={userId} block={b} onChange={(patch) => update(b.id, patch)}
            onAppend={(added) => onChange((prev) => prev.map((x) => (x.id === b.id ? { ...x, urls: [...(x.urls ?? []), ...added] } : x)))} />
        </div>
      ))}
      <div className="cb-add">
        <span className="small muted">Add</span>
        {BLOCK_KINDS.map((k) => (
          <button type="button" key={k.label} className="cb-add-btn" onClick={() => add(k.type, k.style)}>{k.label}</button>
        ))}
      </div>
    </div>
  );
}

function BlockFields({ userId, block: b, onChange, onAppend }: {
  userId: string; block: ContentBlock; onChange: (p: Partial<ContentBlock>) => void; onAppend: (urls: string[]) => void;
}) {
  switch (b.type) {
    case 'text':
      return <FormattedText rows={4} value={b.text ?? ''} onChange={(text) => onChange({ text })} placeholder="Write a paragraph. A blank line starts a new one." />;
    case 'heading':
      return <Input value={b.text ?? ''} onChange={(e) => onChange({ text: e.target.value })} placeholder="What’s included" />;
    case 'list':
      return (
        <>
          <Select value={b.style ?? 'bullet'} onChange={(e) => onChange({ style: e.target.value as 'bullet' | 'check' })}>
            <option value="bullet">Bullets</option>
            <option value="check">Checkmarks ✔</option>
          </Select>
          <FormattedText rows={5} value={(b.items ?? []).join('\n')} onChange={(t) => onChange({ items: t.split('\n') })} placeholder={'One item per line\nAnother item'} />
        </>
      );
    case 'image':
      return (
        <>
          <PhotoUpload userId={userId} urls={b.url ? [b.url] : []} single onChange={(urls) => onChange({ url: urls[0] })} />
          <Input value={b.caption ?? ''} onChange={(e) => onChange({ caption: e.target.value })} placeholder="Caption (optional)" />
        </>
      );
    case 'gallery':
      return <PhotoUpload userId={userId} urls={b.urls ?? []} onChange={(urls) => onChange({ urls })} onAdded={(added) => onAppend(added)}
        hint="Several photos in a column — great for testimonials or results." />;
    case 'video':
      return (
        <>
          <Input value={b.url ?? ''} onChange={(e) => onChange({ url: e.target.value })} placeholder="YouTube or Vimeo link, or a link to a video file" />
          {b.url && <p className="small muted">{videoEmbedURL(b.url) ? 'Plays right on the page.' : 'Plays as a video file — make sure the link ends in .mp4 or .mov.'}</p>}
        </>
      );
    case 'callout':
      return (
        <>
          <Input value={b.title ?? ''} onChange={(e) => onChange({ title: e.target.value })} placeholder="Title (optional) — e.g. Hi, I’m Sheryl" />
          <FormattedText rows={4} value={b.text ?? ''} onChange={(text) => onChange({ text })} placeholder="A coloured panel for your story, a sale or a bonus." />
        </>
      );
    case 'note':
      return <Textarea rows={2} value={b.text ?? ''} onChange={(e) => onChange({ text: e.target.value })} placeholder="Due to the nature of digital products, there are no refunds." />;
    case 'divider':
      return <p className="small muted">A thin line between sections.</p>;
    default:
      return null;
  }
}

/** A textarea with Bold / Italic buttons that wrap the selection in ** or _. */
function FormattedText({ value, onChange, rows, placeholder }: { value: string; onChange: (v: string) => void; rows: number; placeholder?: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const wrap = (mark: string) => {
    const el = ref.current;
    if (!el) return;
    const { selectionStart: s, selectionEnd: e } = el;
    const picked = value.slice(s, e) || (mark === '**' ? 'bold text' : 'italic text');
    const next = value.slice(0, s) + mark + picked + mark + value.slice(e);
    onChange(next);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(s + mark.length, s + mark.length + picked.length); });
  };
  return (
    <div className="cb-text">
      <div className="cb-text-tools">
        <button type="button" onClick={() => wrap('**')} title="Bold"><b>B</b></button>
        <button type="button" onClick={() => wrap('_')} title="Italic"><i>I</i></button>
      </div>
      <textarea ref={ref} className="input" rows={rows} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  );
}

function PhotoUpload({ userId, urls, onChange, onAdded, single, hint }: {
  userId: string; urls: string[]; onChange: (urls: string[]) => void; onAdded?: (added: string[]) => void; single?: boolean; hint?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function pick(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true); setErr(null);
    try {
      const picked = Array.from(files).slice(0, single ? 1 : 20);
      const uploaded: string[] = [];
      for (const f of picked) uploaded.push(await uploadContentImage(userId, f));
      if (single || !onAdded) onChange(single ? uploaded : [...urls, ...uploaded]);
      else onAdded(uploaded);
    } catch (x: any) {
      setErr(x?.message ?? 'Couldn’t upload that photo.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="cb-photos">
      {urls.length > 0 && (
        <div className={single ? 'cb-photo-one' : 'cb-photo-grid'}>
          {urls.map((u, i) => (
            <div className="cb-photo" key={u + i}>
              <img src={u} alt="" />
              <button type="button" onClick={() => onChange(urls.filter((_, j) => j !== i))} aria-label="Remove photo">✕</button>
            </div>
          ))}
        </div>
      )}
      <label className="cb-photo-add">
        <input type="file" accept="image/*" multiple={!single} hidden onChange={(e) => { pick(e.target.files); e.target.value = ''; }} />
        <Button type="button" variant="secondary" className="btn-sm" onClick={(e) => ((e.currentTarget.parentElement as HTMLLabelElement).querySelector('input') as HTMLInputElement).click()}>
          {busy ? 'Uploading…' : single ? (urls.length ? 'Replace photo' : 'Add photo') : 'Add photos'}
        </Button>
      </label>
      {hint && <p className="small muted">{hint}</p>}
      {err && <p className="small warn-text">{err}</p>}
    </div>
  );
}

/** The blocks as customers see them (the storefront draws the same). */
export function ContentBlocksPreview({ blocks }: { blocks: ContentBlock[] }) {
  return <div className="cb-preview" dangerouslySetInnerHTML={{ __html: blocks.map(blockHTML).join('') }} />;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function inline(t = ''): string {
  return esc(t)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(>])_([^_]+)_(?=[\s).,!?:;<]|$)/g, '$1<em>$2</em>')
    .replace(/\n/g, '<br>');
}
const paras = (t = '') => t.split(/\n\s*\n/).map((p) => (p.trim() ? `<p>${inline(p.trim())}</p>` : '')).join('');
function blockHTML(b: ContentBlock): string {
  switch (b.type) {
    case 'text': return paras(b.text);
    case 'heading': return b.text ? `<h4>${inline(b.text)}</h4>` : '';
    case 'list': return `<ul class="${b.style === 'check' ? 'check' : ''}">${(b.items ?? []).filter((i) => i.trim()).map((i) => `<li>${inline(i)}</li>`).join('')}</ul>`;
    case 'image': return b.url ? `<img src="${esc(b.url)}" alt="" />${b.caption ? `<p class="cap">${inline(b.caption)}</p>` : ''}` : '';
    case 'gallery': return (b.urls ?? []).map((u) => `<img src="${esc(u)}" alt="" />`).join('');
    case 'video': {
      if (!b.url) return '';
      const embed = videoEmbedURL(b.url);
      return embed ? `<iframe src="${esc(embed)}" allowfullscreen></iframe>` : `<video src="${esc(b.url)}" controls playsinline preload="metadata"></video>`;
    }
    case 'callout': return `<div class="callout">${b.title ? `<h4>${inline(b.title)}</h4>` : ''}${paras(b.text)}</div>`;
    case 'note': return b.text ? `<p class="note">${inline(b.text)}</p>` : '';
    case 'divider': return '<hr />';
    default: return '';
  }
}
