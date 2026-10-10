import type { ReactNode } from 'react';
import { SortableList } from '../../components/Sortable';
import {
  BLOCK_LABELS, V2_CARDS, ensureDesign, v2DefaultTitle, type BlockType, type LayoutBlock, type V2Block,
} from '../../lib/storefront';
import type { EditorProps } from './Editors';

const V1_SUBS: Record<BlockType, string> = {
  menu: 'Your food listings', physical: 'Products you ship', digital: 'Downloads', links: 'Buttons and link cards',
  about: 'Your story and portrait', faq: 'Questions and answers', policies: 'What customers should know',
  hours: 'When customers can collect', emailCapture: 'Email signup',
};
const V1_PANEL: Record<BlockType, string> = {
  menu: 'menu', physical: 'physical', digital: 'digital', links: 'links', about: 'about',
  faq: 'faq', policies: 'policies', hours: 'hours', emailCapture: 'mailing',
};
/** changedSections() names, so a row can show its unpublished-changes dot. */
const V1_CHANGE: Partial<Record<BlockType, string>> = {
  links: 'Links', about: 'About', faq: 'FAQ', policies: 'Policies', hours: 'Pickup hours', emailCapture: 'Mailing list',
};

/**
 * The builder's home screen: the page's blocks in the exact order the live
 * site renders them (profile pinned first), draggable and switchable, with
 * look-and-feel settings kept apart since they aren't blocks on the page.
 */
export function HomeSections({ v2, props, changes, open }: {
  v2: boolean;
  props: EditorProps;
  changes: string[];
  open: (panel: string) => void;
}) {
  const { draft, set, data } = props;
  const dot = (name?: string) => (name && changes.includes(name) ? <span className="dot-dirty" aria-label="unpublished changes" /> : null);

  let blocks: ReactNode;
  if (v2) {
    const design = ensureDesign(draft);
    const list = design.blocks ?? [];
    const setBlocks = (next: V2Block[]) => set({ storefront_design: { ...design, blocks: next } });
    blocks = (
      <SortableList items={list} keyOf={(b) => b.type} onReorder={setBlocks} className="site-blocks"
        renderRow={(b, handle) => (
          <BlockRow handle={handle} hidden={!!b.hidden}
            title={b.title || v2DefaultTitle(b.type, data.firstName)}
            sub={V2_CARDS.find((c) => c.type === b.type)?.label ?? ''}
            onOpen={() => open(`card:${b.type}`)}
            onToggle={(show) => setBlocks(list.map((x) => (x.type === b.type ? { ...x, hidden: !show } : x)))} />
        )} />
    );
  } else {
    const list = draft.storefront_block_layout;
    const setLayout = (next: LayoutBlock[]) => set({ storefront_block_layout: next });
    const hasCapture = list.some((b) => b.type === 'emailCapture');
    blocks = (
      <>
        <SortableList items={list} keyOf={(b) => b.type} onReorder={setLayout} className="site-blocks"
          renderRow={(b, handle) => (
            <BlockRow handle={handle} hidden={b.hidden} title={<>{BLOCK_LABELS[b.type]}{dot(V1_CHANGE[b.type])}</>}
              sub={V1_SUBS[b.type]}
              onOpen={() => open(V1_PANEL[b.type])}
              onToggle={(show) => setLayout(list.map((x) => (x.type === b.type ? { ...x, hidden: !show } : x)))} />
          )} />
        {!hasCapture && (
          <button type="button" className="add-block" onClick={() => { setLayout([...list, { type: 'emailCapture', hidden: false }]); open('mailing'); }}>
            + Add a mailing list signup
          </button>
        )}
      </>
    );
  }

  return (
    <div className="home-sections">
      <div className="home-group">
        <h3 className="home-group-title">Your page, top to bottom</h3>
        <button type="button" className="block-row pinned" onClick={() => open('profile')}>
          <span className="pin" aria-hidden>
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="3" y="7" width="10" height="7" rx="1.5" /><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" /></svg>
          </span>
          <span className="grow">
            <span className="row-title">{v2 ? 'Profile card' : 'Profile'}{dot('Profile')}</span>
            <span className="row-sub">Always at the top · logo, name, bio, social links</span>
          </span>
          <Chevron />
        </button>
        {blocks}
      </div>

      <div className="home-group">
        <h3 className="home-group-title">Look &amp; feel</h3>
        {v2 && (
          <button type="button" className="block-row" onClick={() => open('design')}>
            <span className="grow"><span className="row-title">Design{dot('New design')}</span><span className="row-sub">Colours, font, corners, background photo</span></span>
            <Chevron />
          </button>
        )}
        <button type="button" className="block-row" onClick={() => open('theme')}>
          <span className="grow"><span className="row-title">Theme{dot('Theme')}</span><span className="row-sub">{v2 ? 'Base colours and pattern' : 'Colours and background pattern'}</span></span>
          <Chevron />
        </button>
      </div>
    </div>
  );
}

function BlockRow({ handle, title, sub, hidden, onOpen, onToggle }: {
  handle: ReactNode; title: ReactNode; sub: string; hidden: boolean; onOpen: () => void; onToggle: (show: boolean) => void;
}) {
  return (
    <div className={`block-row ${hidden ? 'is-hidden' : ''}`}>
      {handle}
      <button type="button" className="grow block-open" onClick={onOpen}>
        <span className="row-title">{title}</span>
        <span className="row-sub">{hidden ? 'Hidden from your page' : sub}</span>
      </button>
      <input type="checkbox" className="switch" aria-label={hidden ? 'Show on page' : 'Hide from page'} checked={!hidden}
        onChange={(e) => onToggle(e.target.checked)} />
    </div>
  );
}

function Chevron() {
  return <svg className="chev" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden><path d="m6 3 5 5-5 5" /></svg>;
}
