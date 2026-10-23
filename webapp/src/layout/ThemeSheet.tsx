import { Modal } from '../components/ui';
import { PATTERNS, THEMES, THEME_DEFS, type PatternName, type ThemeName } from '../lib/theme';

const PATTERN_ICONS: Record<PatternName, string> = {
  Standard: 'M5 5h14v14H5z',
  'Polka Dot': 'M6 6h.01M12 6h.01M18 6h.01M6 12h.01M12 12h.01M18 12h.01M6 18h.01M12 18h.01M18 18h.01',
  Stripes: 'M5 19 19 5',
  Gingham: 'M4 4h16v16H4zM4 9.3h16M4 14.6h16M9.3 4v16M14.6 4v16',
  Pumpkins: 'M12 6c-4.5 0-7 2.8-7 6.5S7.5 19 12 19s7-2.8 7-6.5S16.5 6 12 6zM12 6c0-1.5.6-2.5 2-3M12 6v13',
};

const Check = () => (
  <svg className="theme-check" viewBox="0 0 24 24" width="20" height="20" aria-hidden><circle cx="12" cy="12" r="10" fill="currentColor" /><path d="m7.5 12.2 3 3 6-6.2" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
);

/** CustomizeThemeSheet: pick a colour theme and background, saved as you tap. */
export function ThemeSheet({ theme, pattern, onChange, onClose }: {
  theme: ThemeName; pattern: PatternName; onChange: (theme: ThemeName, pattern: PatternName) => void; onClose: () => void;
}) {
  return (
    <Modal title="Customize Theme" onClose={onClose}>
      <p className="small muted">Your selected theme affects your app interface and your storefront.</p>
      <div className="theme-group">
        <div className="h3">Colour Theme</div>
        {THEMES.map((t) => (
          <button key={t} type="button" className="theme-row" aria-pressed={theme === t} onClick={() => onChange(t, pattern)}>
            <span className="theme-swatches">{THEME_DEFS[t].swatches.map((c, i) => <i key={i} style={{ background: c }} />)}</span>
            <span className="grow">{t}</span>
            {theme === t && <Check />}
          </button>
        ))}
      </div>
      <div className="theme-group">
        <div className="h3">Background</div>
        {PATTERNS.map((p) => (
          <button key={p} type="button" className="theme-row" aria-pressed={pattern === p} onClick={() => onChange(theme, p)}>
            <svg className="theme-pattern-icon" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={PATTERN_ICONS[p]} /></svg>
            <span className="grow">{p}</span>
            {pattern === p && <Check />}
          </button>
        ))}
      </div>
    </Modal>
  );
}
