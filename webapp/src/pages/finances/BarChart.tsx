import { useState } from 'react';

interface Series { key: string; label: string; color: string }

/** Lightweight grouped bar chart (no chart library) with hover read-outs. */
export function BarChart<T extends { label: string } & Record<string, number | string>>({
  data, series, format,
}: { data: T[]; series: Series[]; format: (n: number) => string }) {
  const [hover, setHover] = useState<number | null>(null);
  const values = data.flatMap((d) => series.map((s) => Number(d[s.key]) || 0));
  const max = Math.max(1, ...values);
  const min = Math.min(0, ...values);
  const span = max - min || 1;
  const ticks = niceTicks(min, max);
  const zeroPct = ((0 - min) / span) * 100;

  return (
    <div className="chart" onMouseLeave={() => setHover(null)}>
      <div className="chart-axis">
        {ticks.map((t) => <span key={t} style={{ bottom: `${((t - min) / span) * 100}%` }}>{format(t)}</span>)}
      </div>
      <div className="chart-plot">
        {ticks.map((t) => <div key={t} className="chart-grid" style={{ bottom: `${((t - min) / span) * 100}%` }} />)}
        <div className="chart-bars" style={{ gridTemplateColumns: `repeat(${data.length}, minmax(0, 1fr))` }}>
          {data.map((d, i) => (
            <div key={i} className={`chart-col ${hover === i ? 'hover' : ''}`} onMouseEnter={() => setHover(i)}>
              <div className="chart-group">
                {series.map((s) => {
                  const v = Number(d[s.key]) || 0;
                  const h = (Math.abs(v) / span) * 100;
                  return (
                    <div key={s.key} className="chart-bar" style={{
                      background: s.color, height: `${h}%`,
                      bottom: v >= 0 ? `${zeroPct}%` : `${zeroPct - h}%`,
                    }} />
                  );
                })}
              </div>
              <span className="chart-label">{d.label}</span>
              {hover === i && (
                <div className="chart-tip">
                  <strong>{d.label}</strong>
                  {series.map((s) => <span key={s.key}><i style={{ background: s.color }} />{s.label}: {format(Number(d[s.key]) || 0)}</span>)}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function niceTicks(min: number, max: number): number[] {
  const range = max - min || 1;
  const raw = range / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => range / s <= 5) ?? raw;
  const out: number[] = [];
  for (let t = Math.ceil(min / step) * step; t <= max + 1e-9; t += step) out.push(Math.round(t * 100) / 100);
  return out;
}
