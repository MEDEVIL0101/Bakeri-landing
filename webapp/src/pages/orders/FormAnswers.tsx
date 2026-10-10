import { STORAGE_PUBLIC_URL } from '../../lib/supabase';
import { formatMoney } from '../../lib/format';

// Mirrors IntakeFormAnswer (Models/IntakeFormModels.swift) — Swift's
// default Codable keys, so camelCase in the jsonb.
interface Answer {
  fieldID: string;
  label: string;
  fieldType: string;
  textValue?: string | null;
  choiceValues?: string[] | null;
  photoPaths?: string[] | null;
  productSelections?: { id: string; name: string; unitPrice: number; quantity: number }[] | null;
}

function parse(raw: unknown): Answer[] {
  if (!raw) return [];
  try {
    const v = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(v) ? (v as Answer[]) : [];
  } catch {
    return [];
  }
}

function display(a: Answer): string {
  switch (a.fieldType) {
    case 'agreement': return a.choiceValues?.[0] === 'agreed' ? 'Agreed' : 'Not agreed';
    case 'date': {
      const d = a.textValue ? new Date(a.textValue) : null;
      return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString(undefined, { dateStyle: 'long' }) : a.textValue || '—';
    }
    case 'time': {
      const d = a.textValue ? new Date(a.textValue) : null;
      return d && !Number.isNaN(d.getTime()) ? d.toLocaleTimeString(undefined, { timeStyle: 'short' }) : a.textValue || '—';
    }
    case 'single_choice': return a.choiceValues?.[0] ?? '—';
    case 'multi_choice': return a.choiceValues?.length ? a.choiceValues.join(', ') : '—';
    default: return a.textValue?.trim() || '—';
  }
}

export function FormAnswers({ raw }: { raw: unknown }) {
  const answers = parse(raw).filter((a) => a.fieldType !== 'heading' && a.fieldType !== 'notice');
  if (!answers.length) return null;
  return (
    <dl className="answers">
      {answers.map((a) => (
        <div key={a.fieldID} className="answer">
          <dt>{a.label}</dt>
          <dd>
            {a.fieldType === 'photo' ? (
              a.photoPaths?.length ? (
                <div className="photo-grid">
                  {a.photoPaths.map((p) => {
                    const url = `${STORAGE_PUBLIC_URL}/form-response-photos/${p}`;
                    return <a key={p} href={url} target="_blank" rel="noreferrer"><img src={url} alt="" /></a>;
                  })}
                </div>
              ) : '—'
            ) : a.fieldType === 'product_selector' ? (
              <ul className="plain">
                {(a.productSelections ?? []).filter((s) => s.quantity > 0).map((s) => (
                  <li key={s.id}>{s.quantity} × {s.name} — {formatMoney(s.unitPrice * s.quantity)}</li>
                ))}
              </ul>
            ) : (
              <span className="prewrap">{display(a)}</span>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
