import { useState } from 'react';
import type { FormField } from '../../lib/forms';
import { formatMoney } from '../../lib/format';

/**
 * A working, customer's-eye render of the form. Answers here are throwaway —
 * they exist so conditional questions can be tried out while building.
 */
export function FormPreview({ title, fields, highlight, onSelect }: { title: string; fields: FormField[]; highlight?: string | null; onSelect?: (id: string) => void }) {
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [qty, setQty] = useState<Record<string, number>>({});

  const visible = (f: FormField) => {
    if (!f.condition_field_id) return true;
    const trigger = fields.find((x) => x.id === f.condition_field_id);
    if (!trigger) return true;
    const picked = trigger.field_type === 'product_selector'
      ? trigger.product_options.filter((p) => (qty[p.id] ?? 0) > 0).map((p) => p.id)
      : answers[trigger.id] ?? [];
    return picked.some((v) => f.condition_values.includes(v));
  };

  const toggle = (fid: string, v: string, single: boolean) => setAnswers((a) => {
    const cur = a[fid] ?? [];
    return { ...a, [fid]: single ? [v] : cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v] };
  });

  return (
    <div className="pv">
      <div className="pv-title">{title || 'Custom order request'}</div>
      <div className="pv-section">
        <div className="pv-label">Your name <span className="pv-req">*</span></div>
        <div className="pv-input" />
        <div className="pv-label">Email <span className="pv-req">*</span></div>
        <div className="pv-input" />
        <div className="pv-label">Phone</div>
        <div className="pv-input" />
      </div>
      {fields.filter(visible).map((f) => (
        <div key={f.id} className={`pv-field ${highlight === f.id ? 'hl' : ''}`} onClick={() => onSelect?.(f.id)}>
          {f.field_type === 'heading' ? <div className="pv-heading">{f.label || 'Section title'}</div>
            : f.field_type === 'notice' ? <div className="pv-notice">{f.label || 'Notice text'}</div>
              : f.field_type === 'agreement' ? (
                <label className="pv-check"><input type="checkbox" /> <span>{f.label || 'I agree'}{f.is_required && <span className="pv-req"> *</span>}</span></label>
              ) : (
                <>
                  <div className="pv-label">{f.label || 'Untitled question'}{f.is_required && <span className="pv-req"> *</span>}</div>
                  {f.help_text && <div className="pv-help">{f.help_text}</div>}
                  {f.field_type === 'short_text' && <input className="pv-input" />}
                  {f.field_type === 'long_text' && <textarea className="pv-input" rows={3} />}
                  {f.field_type === 'number' && <input className="pv-input" type="number" />}
                  {f.field_type === 'date' && <input className="pv-input" type="date" />}
                  {f.field_type === 'time' && <input className="pv-input" type="time" />}
                  {f.field_type === 'photo' && <div className="pv-photo">+ Add photos</div>}
                  {(f.field_type === 'single_choice' || f.field_type === 'multi_choice') && (
                    <div className="pv-choices">
                      {f.options.filter((o) => o.trim()).map((o) => {
                        const on = (answers[f.id] ?? []).includes(o);
                        return (
                          <button type="button" key={o} className={`pv-choice ${on ? 'on' : ''}`} onClick={(e) => { e.stopPropagation(); toggle(f.id, o, f.field_type === 'single_choice'); }}>{o}</button>
                        );
                      })}
                    </div>
                  )}
                  {f.field_type === 'product_selector' && (
                    <div className="pv-products">
                      {f.product_options.filter((p) => p.name.trim()).map((p) => (
                        <div key={p.id} className="pv-product">
                          <span className="grow">{p.name}<span className="pv-help"> · {formatMoney(p.price)}</span></span>
                          <span className="pv-stepper" onClick={(e) => e.stopPropagation()}>
                            <button type="button" onClick={() => setQty((q) => ({ ...q, [p.id]: Math.max(0, (q[p.id] ?? 0) - 1) }))}>−</button>
                            <span>{qty[p.id] ?? 0}</span>
                            <button type="button" onClick={() => setQty((q) => ({ ...q, [p.id]: p.maxQuantity ? Math.min(p.maxQuantity, (q[p.id] ?? 0) + 1) : (q[p.id] ?? 0) + 1 }))}>+</button>
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
        </div>
      ))}
      <div className="pv-submit">Send request</div>
    </div>
  );
}
