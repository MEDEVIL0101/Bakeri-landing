import { useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';

/**
 * A vertical list reordered by dragging each row's handle. Pointer events
 * (not HTML5 drag-and-drop) so it works the same with a mouse and with a
 * finger on iOS; arrow keys on a focused handle move the row too.
 */
export function SortableList<T>({ items, keyOf, onReorder, renderRow, className }: {
  items: T[];
  keyOf: (item: T) => string;
  onReorder: (next: T[]) => void;
  renderRow: (item: T, handle: ReactNode) => ReactNode;
  className?: string;
}) {
  const listRef = useRef<HTMLUListElement>(null);
  const drag = useRef<{ from: number; startY: number; mids: number[]; tops: number[]; heights: number[] } | null>(null);
  const [state, setState] = useState<{ from: number; to: number; dy: number } | null>(null);

  function move(from: number, to: number) {
    if (to < 0 || to >= items.length || to === from) return;
    const next = [...items];
    const [it] = next.splice(from, 1);
    next.splice(to, 0, it);
    onReorder(next);
  }

  function onPointerDown(i: number, e: PointerEvent<HTMLButtonElement>) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const rows = Array.from(listRef.current?.children ?? []) as HTMLElement[];
    const rects = rows.map((r) => r.getBoundingClientRect());
    drag.current = { from: i, startY: e.clientY, mids: rects.map((r) => r.top + r.height / 2), tops: rects.map((r) => r.top), heights: rects.map((r) => r.height) };
    setState({ from: i, to: i, dy: 0 });
  }

  function onPointerMove(e: PointerEvent<HTMLButtonElement>) {
    const d = drag.current;
    if (!d) return;
    const dy = e.clientY - d.startY;
    const center = d.mids[d.from] + dy;
    let to = d.from;
    while (to < d.mids.length - 1 && center > d.mids[to + 1]) to++;
    while (to > 0 && center < d.mids[to - 1]) to--;
    setState({ from: d.from, to, dy });
  }

  function onPointerUp() {
    const s = state;
    drag.current = null;
    setState(null);
    if (s) move(s.from, s.to);
  }

  function shiftFor(i: number): number {
    const d = drag.current;
    if (!state || !d || i === state.from) return 0;
    const gap = d.tops.length > 1 ? d.tops[1] - d.tops[0] - d.heights[0] : 0;
    const h = d.heights[state.from] + gap;
    if (state.from < state.to && i > state.from && i <= state.to) return -h;
    if (state.from > state.to && i < state.from && i >= state.to) return h;
    return 0;
  }

  return (
    <ul ref={listRef} className={`sortable ${className ?? ''} ${state ? 'is-sorting' : ''}`}>
      {items.map((item, i) => {
        const dragging = state?.from === i;
        const handle = (
          <button type="button" className="drag-handle" aria-label="Drag to reorder (or use arrow keys)"
            onPointerDown={(e) => onPointerDown(i, e)} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
            onKeyDown={(e: KeyboardEvent) => {
              if (e.key === 'ArrowUp') { e.preventDefault(); move(i, i - 1); }
              if (e.key === 'ArrowDown') { e.preventDefault(); move(i, i + 1); }
            }}>
            <svg viewBox="0 0 12 18" width="12" height="18" aria-hidden><g fill="currentColor"><circle cx="3" cy="3" r="1.6" /><circle cx="9" cy="3" r="1.6" /><circle cx="3" cy="9" r="1.6" /><circle cx="9" cy="9" r="1.6" /><circle cx="3" cy="15" r="1.6" /><circle cx="9" cy="15" r="1.6" /></g></svg>
          </button>
        );
        return (
          <li key={keyOf(item)} className={dragging ? 'is-dragging' : ''}
            style={{ transform: `translateY(${dragging ? state!.dy : shiftFor(i)}px)` }}>
            {renderRow(item, handle)}
          </li>
        );
      })}
    </ul>
  );
}
