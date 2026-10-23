import { Children, createContext, Fragment, isValidElement, useContext, useEffect, useRef, useState, type ReactElement, type ReactNode, type RefObject } from 'react';
import { useLocation } from 'react-router-dom';
import { Button } from '../components/ui';

// Phone-only navigation bar, laid out like the iOS app's inline nav bar:
// leading (shop avatar, or a back button on pushed screens) · centred title ·
// trailing toolbar items. PageHeader portals its title/back/actions into these
// slots on phones; on wider screens it renders in the page as before.

export interface NavSlots { leading: HTMLElement | null; title: HTMLElement | null; trailing: HTMLElement | null }

export const NavSlotsContext = createContext<NavSlots | null>(null);

export function useNavSlots(): NavSlots | null {
  return useContext(NavSlotsContext);
}

/** Flattens fragments so `actions={<>…</>}` yields its individual buttons. */
function flatten(node: ReactNode): ReactElement[] {
  const out: ReactElement[] = [];
  Children.toArray(node).forEach((c) => {
    if (!isValidElement(c)) return;
    if (c.type === Fragment) out.push(...flatten((c.props as { children?: ReactNode }).children));
    else out.push(c);
  });
  return out;
}

function isPrimary(el: ReactElement): boolean {
  const p = el.props as { className?: string; variant?: string; 'data-icon'?: string };
  if (p['data-icon']) return true;
  if (p.className?.includes('btn-primary')) return true;
  // <Button> with no variant is primary.
  return el.type === Button && (!p.variant || p.variant === 'primary');
}

/**
 * Trailing nav-bar items, the way the iOS app lays out its toolbars: the
 * primary action stays in the bar (a ⊕ for "new"/"add", otherwise bold text
 * like Save/Edit) and everything else collapses into a ••• menu.
 *
 * Portaled buttons sit outside their page's <form> in the DOM, so a
 * type=submit button submits the form PageHeader itself is rendered in.
 */
export function NavActions({ children, anchor }: { children: ReactNode; anchor: RefObject<HTMLElement> }) {
  const items = flatten(children);
  const primary = items.filter(isPrimary);
  const rest = items.filter((el) => !isPrimary(el));
  const inline = primary.length === 0 && rest.length === 1 ? rest : primary;
  const menu = inline === rest ? [] : rest;

  const onClickCapture = (e: React.MouseEvent) => {
    const btn = (e.target as HTMLElement).closest('button');
    if (btn?.type === 'submit') {
      e.preventDefault();
      if (!btn.disabled) anchor.current?.closest('form')?.requestSubmit();
    }
  };

  return (
    <div className="nav-actions" onClickCapture={onClickCapture}>
      {menu.length > 0 && <MoreMenu>{menu}</MoreMenu>}
      {inline}
    </div>
  );
}

function MoreMenu({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname]);
  useEffect(() => {
    if (!open) return;
    const off = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', off);
    return () => document.removeEventListener('pointerdown', off);
  }, [open]);
  return (
    <div className="nav-more" ref={ref}>
      <button type="button" className="nav-icon-btn" aria-label="More actions" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></svg>
      </button>
      {open && <div className="nav-menu" role="menu" onClick={() => setTimeout(() => setOpen(false))}>{children}</div>}
    </div>
  );
}
