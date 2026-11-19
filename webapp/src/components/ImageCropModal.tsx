import { useEffect, useRef, useState } from 'react';
import { Button, Modal } from './ui';

// Web counterpart of iOS LogoEditorSheet: drag to reposition, zoom with the
// slider / scroll wheel / pinch, Reset, and on Save render the visible circle
// into an 800×800 JPEG (white outside the circle, same as iOS cropToCircle).

const VIEW = 260;          // on-screen circle, px
const OUTPUT = 800;        // saved image, px (storefront shows up to ~170pt)
const MIN_SCALE = 0.3;     // same limits as iOS
const MAX_SCALE = 6;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function ImageCropModal({ src, title = 'Position logo', onCancel, onSave }: {
  /** Object/data URL of the original, full-size picked image. */
  src: string;
  title?: string;
  onCancel: () => void;
  onSave: (blob: Blob) => Promise<void> | void;
}) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; scale: number } | null>(null);

  useEffect(() => {
    const i = new Image();
    i.onload = () => setImg(i);
    i.onerror = () => setErr('Couldn’t read that image. Try a JPEG or PNG.');
    i.src = src;
  }, [src]);

  // Wheel / trackpad zoom. Registered by hand so it can preventDefault (React's
  // onWheel is passive) and the page doesn't scroll behind the modal.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setScale((s) => clamp(s * Math.exp(-e.deltaY * 0.0015), MIN_SCALE, MAX_SCALE));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [img]);

  const fill = img ? Math.max(VIEW / img.naturalWidth, VIEW / img.naturalHeight) : 1;
  const w = img ? img.naturalWidth * fill * scale : 0;
  const h = img ? img.naturalHeight * fill * scale : 0;

  const onPointerDown = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), scale };
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const cur = { x: e.clientX, y: e.clientY };
    pointers.current.set(e.pointerId, cur);
    if (pointers.current.size >= 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      setScale(clamp(pinch.current.scale * (d / pinch.current.dist), MIN_SCALE, MAX_SCALE));
    } else if (pointers.current.size === 1) {
      setOffset((o) => ({ x: o.x + cur.x - prev.x, y: o.y + cur.y - prev.y }));
    }
  };
  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
  };

  const nudge = (dx: number, dy: number) => setOffset((o) => ({ x: o.x + dx, y: o.y + dy }));

  async function save() {
    if (!img) return;
    setSaving(true); setErr(null);
    try {
      const ratio = OUTPUT / VIEW;
      const canvas = document.createElement('canvas');
      canvas.width = OUTPUT; canvas.height = OUTPUT;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, OUTPUT, OUTPUT);
      ctx.beginPath();
      ctx.arc(OUTPUT / 2, OUTPUT / 2, OUTPUT / 2, 0, Math.PI * 2);
      ctx.clip();
      ctx.imageSmoothingQuality = 'high';
      const dw = w * ratio, dh = h * ratio;
      ctx.drawImage(img, OUTPUT / 2 - dw / 2 + offset.x * ratio, OUTPUT / 2 - dh / 2 + offset.y * ratio, dw, dh);
      const blob = await new Promise<Blob>((res, rej) =>
        canvas.toBlob((b) => (b ? res(b) : rej(new Error('Couldn’t process that image.'))), 'image/jpeg', 0.82));
      await onSave(blob);
    } catch (x: any) {
      setErr(x?.message ?? 'Couldn’t save that image.');
      setSaving(false);
    }
  }

  return (
    <Modal
      title={title}
      onClose={onCancel}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel} disabled={saving}>Cancel</Button>
          <Button onClick={save} loading={saving} disabled={!img}>Save</Button>
        </>
      }
    >
      <div className="crop-wrap">
        <div
          ref={stageRef}
          className="crop-stage"
          style={{ width: VIEW, height: VIEW }}
          tabIndex={0}
          aria-label="Drag to reposition. Use the slider, scroll or pinch to zoom. Arrow keys nudge."
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onKeyDown={(e) => {
            const step = e.shiftKey ? 10 : 2;
            if (e.key === 'ArrowLeft') { e.preventDefault(); nudge(-step, 0); }
            if (e.key === 'ArrowRight') { e.preventDefault(); nudge(step, 0); }
            if (e.key === 'ArrowUp') { e.preventDefault(); nudge(0, -step); }
            if (e.key === 'ArrowDown') { e.preventDefault(); nudge(0, step); }
          }}
        >
          {img && (
            <img
              src={src}
              alt=""
              draggable={false}
              style={{
                width: w, height: h,
                transform: `translate(${VIEW / 2 - w / 2 + offset.x}px, ${VIEW / 2 - h / 2 + offset.y}px)`,
              }}
            />
          )}
        </div>
        <div className="crop-controls">
          <span className="small muted" aria-hidden>−</span>
          <input
            type="range"
            aria-label="Zoom"
            min={Math.log(MIN_SCALE)} max={Math.log(MAX_SCALE)} step={0.01}
            value={Math.log(scale)}
            onChange={(e) => setScale(Math.exp(parseFloat(e.target.value)))}
          />
          <span className="small muted" aria-hidden>+</span>
        </div>
        <button type="button" className="link-btn small" onClick={() => { setScale(1); setOffset({ x: 0, y: 0 }); }}>Reset</button>
        <p className="small muted">Drag to move · scroll or pinch to zoom</p>
        {err && <span className="field-error">{err}</span>}
      </div>
    </Modal>
  );
}
