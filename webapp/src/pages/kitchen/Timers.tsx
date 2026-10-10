import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Button, Card, Input } from '../../components/ui';

// Baking timers (iOS TimerStore + BakingTimerView). They live above the
// router so they keep running while the vendor moves around the app, and
// persist end times in localStorage so a reload doesn't lose them.

interface Timer { id: string; label: string; total: number; endsAt: number | null; remaining: number; done: boolean }

const KEY = 'bakeri.timers';
const load = (): Timer[] => { try { return JSON.parse(localStorage.getItem(KEY) ?? '[]'); } catch { return []; } };
const persist = (t: Timer[]) => { try { localStorage.setItem(KEY, JSON.stringify(t)); } catch { /* ignore */ } };

interface Ctx {
  timers: Timer[];
  now: number;
  add: (label: string, seconds: number) => void;
  toggle: (id: string) => void;
  reset: (id: string) => void;
  remove: (id: string) => void;
  dismiss: (id: string) => void;
}
const TimerContext = createContext<Ctx | null>(null);

export function TimerProvider({ children }: { children: ReactNode }) {
  const [timers, setTimers] = useState<Timer[]>(load);
  const [now, setNow] = useState(Date.now());
  const audio = useRef<AudioContext | null>(null);

  useEffect(() => persist(timers), [timers]);

  const chime = useCallback(() => {
    try {
      audio.current ??= new AudioContext();
      const ctx = audio.current;
      [0, 0.35, 0.7].forEach((t) => {
        const o = ctx.createOscillator(); const g = ctx.createGain();
        o.frequency.value = 880; o.connect(g); g.connect(ctx.destination);
        g.gain.setValueAtTime(0.0001, ctx.currentTime + t);
        g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.3);
        o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.32);
      });
    } catch { /* audio unavailable */ }
  }, []);

  const running = timers.some((t) => t.endsAt);
  useEffect(() => {
    if (!running) return;
    const i = setInterval(() => {
      const n = Date.now();
      setNow(n);
      setTimers((ts) => {
        let changed = false;
        const next = ts.map((t) => {
          if (t.endsAt && t.endsAt <= n) {
            changed = true;
            chime();
            try { if (Notification.permission === 'granted') new Notification('Timer done', { body: t.label || 'Your timer is done' }); } catch { /* ignore */ }
            return { ...t, endsAt: null, remaining: 0, done: true };
          }
          return t;
        });
        return changed ? next : ts;
      });
    }, 250);
    return () => clearInterval(i);
  }, [running, chime]);

  const value: Ctx = {
    timers, now,
    add: (label, seconds) => {
      try { if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission(); } catch { /* ignore */ }
      setTimers((ts) => [...ts, { id: crypto.randomUUID(), label, total: seconds, remaining: seconds, endsAt: Date.now() + seconds * 1000, done: false }]);
    },
    toggle: (id) => setTimers((ts) => ts.map((t) => (t.id !== id || t.done ? t : t.endsAt
      ? { ...t, endsAt: null, remaining: Math.max(0, Math.round((t.endsAt - Date.now()) / 1000)) }
      : { ...t, endsAt: Date.now() + t.remaining * 1000 }))),
    reset: (id) => setTimers((ts) => ts.map((t) => (t.id === id ? { ...t, endsAt: null, remaining: t.total, done: false } : t))),
    remove: (id) => setTimers((ts) => ts.filter((t) => t.id !== id)),
    dismiss: (id) => setTimers((ts) => ts.filter((t) => t.id !== id)),
  };
  return <TimerContext.Provider value={value}>{children}</TimerContext.Provider>;
}

export function useTimers() {
  const c = useContext(TimerContext);
  if (!c) throw new Error('useTimers outside TimerProvider');
  return c;
}

const left = (t: Timer, now: number) => (t.endsAt ? Math.max(0, Math.ceil((t.endsAt - now) / 1000)) : t.remaining);
export function fmtClock(s: number) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const p = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${p(m)}:${p(sec)}` : `${p(m)}:${p(sec)}`;
}

const PRESETS: [string, number][] = [['Cookies', 11], ['Cupcakes', 20], ['Brownies', 25], ['Banana bread', 60], ['Proof', 45], ['Chill dough', 30]];

export function TimersPanel() {
  const { timers, now, add, toggle, reset, remove } = useTimers();
  const [label, setLabel] = useState('');
  const [min, setMin] = useState('12');
  return (
    <div className="stack-lg">
      <Card title="New timer">
        <div className="btn-row">
          <Input className="grow" value={label} placeholder="What’s baking?" onChange={(e) => setLabel(e.target.value)} />
          <Input className="w-num" type="number" min="0" step="any" value={min} onChange={(e) => setMin(e.target.value)} aria-label="Minutes" />
          <span className="muted">min</span>
          <Button disabled={!(parseFloat(min) > 0)} onClick={() => { add(label.trim() || `${min} min timer`, Math.round(parseFloat(min) * 60)); setLabel(''); }}>Start</Button>
        </div>
        <div className="chips">
          {PRESETS.map(([l, m]) => <button key={l} className="chip chip-btn" onClick={() => add(l, m * 60)}>{l} · {m}m</button>)}
        </div>
        <p className="small muted">Timers keep running while you use the rest of Bakeri. Keep this tab open to hear the chime.</p>
      </Card>
      {timers.length > 0 && (
        <div className="timer-grid">
          {timers.map((t) => {
            const s = left(t, now);
            const pct = t.total ? 1 - s / t.total : 1;
            return (
              <div key={t.id} className={`timer ${t.done ? 'done' : ''}`}>
                <svg viewBox="0 0 120 120" className="timer-ring" aria-hidden>
                  <circle cx="60" cy="60" r="52" className="track" />
                  <circle cx="60" cy="60" r="52" className="fill" style={{ strokeDasharray: 326.7, strokeDashoffset: 326.7 * (1 - pct) }} />
                </svg>
                <div className="timer-center">
                  <span className="timer-clock">{t.done ? 'Done!' : fmtClock(s)}</span>
                  <span className="small muted ellipsis">{t.label}</span>
                </div>
                <div className="btn-row center-row">
                  {!t.done && <Button variant="secondary" onClick={() => toggle(t.id)}>{t.endsAt ? 'Pause' : 'Resume'}</Button>}
                  <Button variant="ghost" onClick={() => reset(t.id)}>Reset</Button>
                  <button className="icon-btn sm" aria-label="Remove timer" onClick={() => remove(t.id)}>×</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Floating read-out shown on every page while timers run (iOS "N timers active" bar). */
export function TimerPill() {
  const { timers, now, dismiss } = useTimers();
  if (!timers.length) return null;
  const done = timers.filter((t) => t.done);
  const next = timers.filter((t) => t.endsAt).sort((a, b) => a.endsAt! - b.endsAt!)[0];
  return (
    <div className={`timer-pill ${done.length ? 'ringing' : ''}`}>
      {done.length ? (
        <>
          <span>⏰ {done.map((d) => d.label).join(', ')} {done.length === 1 ? 'is' : 'are'} done</span>
          <button className="link-btn" onClick={() => done.forEach((d) => dismiss(d.id))}>Stop</button>
        </>
      ) : (
        <Link to="/calculator" onClick={() => { try { localStorage.setItem('bakeri.calc.mode', 'timers'); } catch { /* ignore */ } }}>
          ⏱ {next ? `${next.label} · ${fmtClock(left(next, now))}` : `${timers.length} timer${timers.length === 1 ? '' : 's'} paused`}
          {timers.length > 1 && ` (+${timers.length - 1})`}
        </Link>
      )}
    </div>
  );
}
