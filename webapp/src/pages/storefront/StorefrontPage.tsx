import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useUserId } from '../../auth/AuthProvider';
import { Button, ConfirmModal, ErrorBanner, Spinner, useLoad, useToast } from '../../components/ui';
import {
  changedSections, clearLocalDraft, loadLocalDraft, loadStorefront, previewPayload, publishStorefront, saveLocalDraft,
  type BlockType, type StorefrontData, type StorefrontDraft, type V2CardType,
} from '../../lib/storefront';
import { PreviewFrame } from './PreviewFrame';
import {
  AboutEditor, FAQEditor, HoursEditor, LayoutEditor, LinksEditor, ListingsInfo, MailingEditor, PoliciesEditor,
  ProfileEditor, ThemeEditor, type EditorProps,
} from './Editors';
import { CardSettings, CardsEditor, DesignEditor } from './V2Editors';

type Panel =
  | 'home' | 'profile' | 'theme' | 'layout' | 'links' | 'about' | 'faq' | 'policies' | 'hours' | 'mailing'
  | 'menu' | 'physical' | 'digital' | 'form' | 'design' | 'cards' | `card:${V2CardType}`;

const V1_SECTIONS: { panel: Panel; label: string; sub: string }[] = [
  { panel: 'profile', label: 'Profile', sub: 'Logo, header photo, name, bio, social links' },
  { panel: 'theme', label: 'Theme', sub: 'Colours and background pattern' },
  { panel: 'layout', label: 'Sections', sub: 'Order and visibility' },
  { panel: 'links', label: 'Links', sub: 'Buttons and link cards' },
  { panel: 'about', label: 'About', sub: 'Your story and portrait' },
  { panel: 'faq', label: 'FAQ', sub: 'Questions and answers' },
  { panel: 'policies', label: 'Store policies', sub: 'What customers should know' },
  { panel: 'hours', label: 'Pickup hours', sub: 'When customers can collect' },
  { panel: 'mailing', label: 'Mailing list', sub: 'Email signup and free download' },
];

const V2_SECTIONS: { panel: Panel; label: string; sub: string }[] = [
  { panel: 'design', label: 'Design', sub: 'Colours, font, corners, background' },
  { panel: 'profile', label: 'Profile card', sub: 'Logo, header photo, name, bio, social links' },
  { panel: 'theme', label: 'Theme', sub: 'Base colours and pattern' },
  { panel: 'cards', label: 'Cards', sub: 'Order, visibility, titles, menu buttons' },
  { panel: 'links', label: 'Links', sub: 'Buttons and link cards' },
  { panel: 'about', label: 'About', sub: 'Your story and portrait' },
  { panel: 'faq', label: 'FAQ', sub: 'Questions and answers' },
  { panel: 'policies', label: 'Store policies', sub: 'What customers should know' },
  { panel: 'hours', label: 'Pickup hours', sub: 'When customers can collect' },
  { panel: 'mailing', label: 'Mailing list', sub: 'Email signup settings' },
];

/** Where a tap in the preview should land in the editor. */
function panelForTap(blockType: string, v2: boolean): Panel {
  if (blockType === 'identity') return 'profile';
  if (blockType === 'design') return 'design';
  if (v2 && ['leadMagnet', 'menu', 'products', 'links', 'about', 'info', 'emailCapture'].includes(blockType)) return `card:${blockType as V2CardType}`;
  const map: Record<string, Panel> = {
    menu: 'menu', physical: 'physical', digital: 'digital', form: 'form', links: 'links', about: 'about',
    faq: 'faq', policies: 'policies', hours: 'hours', emailCapture: 'mailing', leadMagnet: 'mailing',
  };
  return map[blockType] ?? 'home';
}

function readPref(key: string, fallback: string) {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}
function writePref(key: string, v: string) {
  try { localStorage.setItem(key, v); } catch { /* ignore */ }
}

export function StorefrontPage() {
  const userId = useUserId();
  const { data, loading, error, reload } = useLoad(() => loadStorefront(userId), [userId]);
  if (loading && !data) return <div className="page"><Spinner label="Loading your storefront…" /></div>;
  if (error || !data) return <div className="page"><ErrorBanner message={error ?? 'Couldn’t load your storefront.'} onRetry={reload} /></div>;
  return <Builder key={data.updatedAt} data={data} userId={userId} reload={reload} />;
}

function Builder({ data, userId, reload }: { data: StorefrontData; userId: string; reload: () => void }) {
  const toast = useToast();
  const [draft, setDraft] = useState<StorefrontDraft>(() => loadLocalDraft(userId, data.updatedAt) ?? data.draft);
  const [panel, setPanel] = useState<Panel>('home');
  const [v2, setV2] = useState(() => readPref('bakeri.builder.v2', '0') === '1');
  const [device, setDevice] = useState<'phone' | 'desktop'>(() => (readPref('bakeri.builder.device', 'phone') === 'desktop' ? 'desktop' : 'phone'));
  const [confirming, setConfirming] = useState(false);
  const [discarding, setDiscarding] = useState(false);

  const set = useCallback((patch: Partial<StorefrontDraft>) => setDraft((d) => ({ ...d, ...patch })), []);
  const changes = useMemo(() => changedSections(draft, data.published), [draft, data.published]);

  useEffect(() => {
    if (changes.length) saveLocalDraft(userId, draft, data.updatedAt);
    else clearLocalDraft(userId);
  }, [draft, changes.length, userId, data.updatedAt]);

  // Warn before leaving the page with unpublished edits.
  useEffect(() => {
    if (!changes.length) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [changes.length]);

  const payload = useMemo(() => previewPayload(data, draft, userId), [data, draft, userId]);
  const src = v2 ? '/baker/next.html?preview=1&builder=2' : '/baker/index.html?preview=1';
  const props: EditorProps = { draft, set, data, userId, v2 };
  const liveURL = data.slug ? `https://bakeriapp.com/${data.slug}` : null;

  let editor: ReactNode;
  switch (panel) {
    case 'profile': editor = <ProfileEditor {...props} />; break;
    case 'theme': editor = <ThemeEditor {...props} />; break;
    case 'layout': editor = <LayoutEditor {...props} onOpen={(t: BlockType) => setPanel(panelForTap(t, false))} />; break;
    case 'links': editor = <LinksEditor {...props} />; break;
    case 'about': editor = <AboutEditor {...props} />; break;
    case 'faq': editor = <FAQEditor {...props} />; break;
    case 'policies': editor = <PoliciesEditor {...props} />; break;
    case 'hours': editor = <HoursEditor {...props} />; break;
    case 'mailing': editor = <MailingEditor {...props} />; break;
    case 'menu': case 'physical': case 'digital': case 'form': editor = <ListingsInfo kind={panel} />; break;
    case 'design': editor = <DesignEditor {...props} />; break;
    case 'cards': editor = <CardsEditor {...props} onOpen={(t) => setPanel(`card:${t}`)} />; break;
    case 'home': editor = null; break;
    default: {
      const t = panel.slice(5) as V2CardType;
      const content: Record<string, ReactNode> = {
        links: <LinksEditor {...props} />, about: <AboutEditor {...props} />, menu: <ListingsInfo kind="menu" />,
        products: <><ListingsInfo kind="physical" /></>, emailCapture: <MailingEditor {...props} />,
        info: <><PoliciesEditor {...props} /><FAQEditor {...props} /><HoursEditor {...props} /></>,
      };
      editor = <><CardSettings {...props} type={t} />{content[t]}</>;
    }
  }

  const sections = v2 ? V2_SECTIONS : V1_SECTIONS;

  return (
    <div className="builder">
      <header className="builder-bar">
        <div className="builder-title">
          <h1>Storefront</h1>
          <div className="seg" role="tablist" aria-label="Design">
            <button role="tab" aria-selected={!v2} className={!v2 ? 'active' : ''} onClick={() => { setV2(false); writePref('bakeri.builder.v2', '0'); setPanel('home'); }}>Current design</button>
            <button role="tab" aria-selected={v2} className={v2 ? 'active' : ''} onClick={() => { setV2(true); writePref('bakeri.builder.v2', '1'); setPanel('home'); }}>New design (preview)</button>
          </div>
        </div>
        <div className="btn-row">
          {liveURL && <a href={liveURL} target="_blank" rel="noreferrer" className="btn btn-ghost">View live ↗</a>}
          {changes.length > 0 && <Button variant="ghost" onClick={() => setDiscarding(true)}>Discard</Button>}
          <Button disabled={!changes.length} onClick={() => setConfirming(true)}>
            {changes.length ? `Publish changes (${changes.length})` : 'Published'}
          </Button>
        </div>
      </header>
      {v2 && (
        <div className="banner banner-info builder-note">
          The new design isn’t live yet — customers still see your current design. Design settings you publish here are saved and go live when Bakeri switches over.
        </div>
      )}

      <div className="builder-body">
        <aside className="builder-panel">
          {panel === 'home' ? (
            <>
              <p className="small muted">Click anything in the preview to edit it, or pick a section.</p>
              <ul className="section-list">
                {sections.map((s) => (
                  <li key={s.panel}>
                    <button className="section-btn" onClick={() => setPanel(s.panel)}>
                      <span className="row-title">{s.label}{changes.includes(sectionChangeName(s.panel)) ? <span className="dot-dirty" aria-label="unpublished changes" /> : null}</span>
                      <span className="row-sub">{s.sub}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <>
              <button className="back-link link-btn" onClick={() => setPanel('home')}>← All sections</button>
              <div className="stack-lg">{editor}</div>
            </>
          )}
        </aside>

        <section className="builder-preview">
          <div className="preview-toolbar">
            <div className="seg sm">
              <button className={device === 'phone' ? 'active' : ''} onClick={() => { setDevice('phone'); writePref('bakeri.builder.device', 'phone'); }}>Phone</button>
              <button className={device === 'desktop' ? 'active' : ''} onClick={() => { setDevice('desktop'); writePref('bakeri.builder.device', 'desktop'); }}>Desktop</button>
            </div>
          </div>
          <PreviewFrame src={src} payload={payload} device={device} onSelect={(bt) => setPanel(panelForTap(bt, v2))} />
        </section>
      </div>

      {confirming && (
        <ConfirmModal
          title="Publish your storefront?"
          body={`These changes go live on your storefront: ${changes.join(', ')}.`}
          confirmLabel="Publish"
          onClose={() => setConfirming(false)}
          onConfirm={async () => {
            await publishStorefront(userId, draft, data.published);
            clearLocalDraft(userId);
            toast('Published — your storefront is up to date');
            reload();
          }}
        />
      )}
      {discarding && (
        <ConfirmModal title="Discard your changes?" body="Your storefront goes back to what’s published now." confirmLabel="Discard" danger
          onClose={() => setDiscarding(false)}
          onConfirm={() => { setDraft(structuredClone(data.published)); clearLocalDraft(userId); }} />
      )}
    </div>
  );
}

function sectionChangeName(p: Panel): string {
  return ({
    profile: 'Profile', theme: 'Theme', layout: 'Layout', links: 'Links', about: 'About', faq: 'FAQ', policies: 'Policies',
    hours: 'Pickup hours', mailing: 'Mailing list', design: 'New design', cards: 'New design',
  } as Record<string, string>)[p] ?? '';
}
