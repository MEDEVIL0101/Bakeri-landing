import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/** iPhone 18 Pro: 6.3" 1206×2622 @3x → a 402×874 pt screen (same CSS viewport as Safari on the device). */
const SCREEN_W = 402;
const SCREEN_H = 874;
const BEZEL = 12;
const DEVICE_W = SCREEN_W + BEZEL * 2;
const DEVICE_H = SCREEN_H + BEZEL * 2;

/**
 * A true-proportion iPhone 18 Pro drawn in CSS. The screen always renders at
 * the real 402pt width (so the content lays out exactly as on the phone) and
 * the whole device is scaled down to fit its container — never squashed.
 */
export function IPhoneFrame({ children }: { children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => {
      const { width, height } = el.getBoundingClientRect();
      if (width && height) setScale(Math.min(width / DEVICE_W, height / DEVICE_H, 1));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div className="iphone-fit" ref={box}>
      <div className="iphone-slot" style={{ width: DEVICE_W * scale, height: DEVICE_H * scale }}>
        <div className="iphone" style={{ width: DEVICE_W, height: DEVICE_H, transform: `scale(${scale})`, visibility: scale ? 'visible' : 'hidden' }}>
          <span className="iphone-btn action" /><span className="iphone-btn vol-up" /><span className="iphone-btn vol-down" />
          <span className="iphone-btn power" /><span className="iphone-btn camera" />
          <div className="iphone-screen" style={{ width: SCREEN_W, height: SCREEN_H }}>
            <div className="iphone-status" aria-hidden>
              <span className="iphone-time">9:41</span>
              <span className="iphone-island" />
              <span className="iphone-icons">
                <svg viewBox="0 0 18 12" width="18" height="12"><rect x="0" y="8" width="3" height="4" rx="1" /><rect x="5" y="5.5" width="3" height="6.5" rx="1" /><rect x="10" y="3" width="3" height="9" rx="1" /><rect x="15" y="0" width="3" height="12" rx="1" /></svg>
                <svg viewBox="0 0 16 12" width="16" height="12"><path d="M8 11.5 5.6 9a3.4 3.4 0 0 1 4.8 0zM3.4 6.8a6.5 6.5 0 0 1 9.2 0l-1.4 1.4a4.5 4.5 0 0 0-6.4 0zM1.2 4.6a9.6 9.6 0 0 1 13.6 0l-1.4 1.4a7.6 7.6 0 0 0-10.8 0z" /></svg>
                <svg viewBox="0 0 27 13" width="27" height="13"><rect x=".5" y=".5" width="23" height="12" rx="3.8" fill="none" stroke="currentColor" opacity=".4" /><rect x="2" y="2" width="20" height="9" rx="2.4" /><path d="M25 4.5v4a2 2 0 0 0 0-4z" opacity=".45" /></svg>
              </span>
            </div>
            <div className="iphone-content">{children}</div>
            <span className="iphone-home" aria-hidden />
          </div>
        </div>
      </div>
    </div>
  );
}
