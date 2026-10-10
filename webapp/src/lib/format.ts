export function newId(): string {
  return crypto.randomUUID();
}

/**
 * Storage object paths use Swift's uuidString, which is UPPERCASE — the iOS
 * app and the public storefront both build paths that way, so the web app
 * must too or it reads/writes a different object.
 */
export function up(id: string): string {
  return id.toUpperCase();
}

/** ISO8601 without milliseconds — what Swift's ISO8601DateFormatter parses. */
export function isoNoMillis(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function nowISO(): string {
  return new Date().toISOString();
}

/**
 * updated_at for a write to a row we already have. orders has a server
 * trigger that silently drops a write whose updated_at is older than the
 * stored one, so a browser clock running behind would lose edits — never
 * send a value older than what we last read.
 */
export function bumpedTimestamp(previous?: string | null): string {
  const now = Date.now();
  const prev = previous ? Date.parse(previous) : 0;
  return new Date(Math.max(now, prev + 1)).toISOString();
}

const money = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', currencyDisplay: 'narrowSymbol' });
export function formatMoney(n: number | null | undefined): string {
  return money.format(n ?? 0);
}

export function formatDate(iso: string | null | undefined, opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' }): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, opts);
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** yyyy-mm-dd in local time, for <input type="date">. */
export function toDateInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** yyyy-mm-ddThh:mm in local time, for <input type="datetime-local">. */
export function toDateTimeInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${toDateInput(iso)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Local date/datetime input value → ISO string. */
export function fromLocalInput(value: string): string {
  if (!value) return '';
  // A bare date means local midnight, not UTC midnight.
  const d = value.length === 10 ? new Date(`${value}T00:00`) : new Date(value);
  return d.toISOString();
}

export function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function parseNumber(s: string): number {
  const n = Number(String(s).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : 0;
}

export function csvEscape(v: unknown): string {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function downloadText(filename: string, text: string, type = 'text/csv') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const EVENT_COLORS: Record<string, string> = {
  red: '#D16969', orange: '#F08C3D', gold: '#D9AB42', green: '#3DBD70', teal: '#2EADA6',
  blue: '#5E91E6', purple: '#943DD1', pink: '#F066AD', brown: '#8C5E42', indigo: '#5E5CD6',
};
