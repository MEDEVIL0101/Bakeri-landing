import { useRef } from 'react';
import type { FocusPoint } from '../lib/storefront';

const round1 = (v: number) => Math.round(Math.max(0, Math.min(100, v)) * 10) / 10;

/**
 * The whole photo, uncropped — tap or drag the subject — and live previews of
 * the three crops the storefront actually makes from it: the shop card
 * (square), the phone pop-up (square) and the desktop pop-up banner
 * (840 × 440). All three use the same focal point (object-position), exactly
 * like baker/index.html focusPosition().
 */
export function ListingPhotoFocus({ src, point, onChange }: {
  src: string; point: FocusPoint | null; onChange: (p: FocusPoint | null) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const place = (e: React.PointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    onChange({ x: round1(((e.clientX - r.left) / r.width) * 100), y: round1(((e.clientY - r.top) / r.height) * 100) });
  };
  const pos = point ? `${point.x}% ${point.y}%` : '50% 50%';
  return (
    <div className="lpf">
      <div className="focal-stage">
        <div className="focal-photo" ref={box}
          onPointerDown={(e) => { e.preventDefault(); (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); place(e); }}
          onPointerMove={(e) => { if (e.buttons) place(e); }}>
          <img src={src} alt="" draggable={false} />
          {point && <span className="focal-dot" style={{ left: `${point.x}%`, top: `${point.y}%` }} />}
        </div>
      </div>
      <p className="small muted">
        {point ? 'Drag the dot onto what matters most — every view stays centred on it.' : 'Tap what matters most in the photo (a face, the cake). Every view stays centred on it.'}
        {point && <> <button type="button" className="link-btn small" onClick={() => onChange(null)}>Reset</button></>}
      </p>
      <div className="lpf-previews" aria-label="How the photo is cropped">
        <figure><div className="lpf-crop lpf-card"><img src={src} alt="" style={{ objectPosition: pos }} /></div><figcaption>Shop card</figcaption></figure>
        <figure><div className="lpf-crop lpf-phone"><img src={src} alt="" style={{ objectPosition: pos }} /></div><figcaption>Phone pop-up</figcaption></figure>
        <figure className="lpf-wide"><div className="lpf-crop lpf-desktop"><img src={src} alt="" style={{ objectPosition: pos }} /></div><figcaption>Desktop pop-up</figcaption></figure>
      </div>
    </div>
  );
}
