import { useEffect, useRef, useState } from 'react';
import { Spinner } from '../../components/ui';
import { IPhoneFrame } from '../../components/IPhoneFrame';

/**
 * The real public storefront page in preview mode (?preview=1), fed the
 * draft through window.__bakeriRenderPreview — the same mechanism the iOS
 * builder uses, so the preview is the actual site, not a copy.
 *
 * Tap-to-edit: the page reports taps through
 * window.webkit.messageHandlers.bakeriBridge (the iOS WKWebView bridge).
 * The page is same-origin with the app (bakeriapp.com/baker vs /app), so
 * we install that object on the iframe's window ourselves — no change to
 * the live storefront page needed.
 */
export function PreviewFrame({ src, payload, onSelect, device }: {
  src: string;
  payload: unknown;
  onSelect: (blockType: string) => void;
  device: 'phone' | 'desktop';
}) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  function push() {
    const w = ref.current?.contentWindow as any;
    if (!w || typeof w.__bakeriRenderPreview !== 'function') return;
    try {
      // Plain JSON copy — the iframe's realm must not hold references into ours.
      w.__bakeriRenderPreview(JSON.parse(JSON.stringify(payload)));
    } catch (e) {
      console.error('[Bakeri builder] preview render failed', e);
    }
  }

  function onLoad() {
    const w = ref.current?.contentWindow as any;
    if (!w) return;
    try {
      w.webkit = {
        messageHandlers: {
          bakeriBridge: {
            postMessage: (m: any) => {
              if (m?.type === 'select' && typeof m.blockType === 'string') onSelectRef.current(m.blockType);
            },
          },
        },
      };
      // Keep scrolling inside the preview — without this, reaching its top or
      // bottom hands the gesture to the builder page and the whole UI lurches.
      const st = w.document.createElement('style');
      st.textContent = 'html, body { overscroll-behavior: contain; }';
      w.document.head.appendChild(st);
    } catch {
      // Cross-origin (shouldn't happen on bakeriapp.com) — preview still renders, taps just don't select.
    }
    setReady(true);
    push();
  }

  // Re-render shortly after each edit (same ~debounce as iOS).
  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(push, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payload, ready]);

  useEffect(() => setReady(false), [src]);

  return (
    <div className={`preview-stage ${device}`}>
      {!ready && <div className="preview-loading"><Spinner label="Loading preview…" /></div>}
      {device === 'phone'
        ? <IPhoneFrame><iframe key={src} ref={ref} src={src} title="Storefront preview" onLoad={onLoad} className="preview-frame" /></IPhoneFrame>
        : <iframe key={src} ref={ref} src={src} title="Storefront preview" onLoad={onLoad} className="preview-frame" />}
    </div>
  );
}
