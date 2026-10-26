import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { IPhoneFrame } from '../../components/IPhoneFrame';
import { SortableList } from '../../components/Sortable';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useUserId } from '../../auth/AuthProvider';
import { Button, ConfirmModal, ErrorBanner, Input, Modal, Select, Spinner, Textarea, useLoad, useToast } from '../../components/ui';
import {
  FIELD_TYPES, blankField, deleteForm, fieldTypeLabel, getForm, isAnswerField, isTriggerType, saveForm, starterFields, swiftUUID,
  type FieldType, type FormField, type ProductOption,
} from '../../lib/forms';
import { listMenuItems, type MenuItemFull } from '../../lib/menu';
import { formatMoney, newId, parseNumber } from '../../lib/format';
import { FormPreview } from './FormPreview';
import type { ImportedForm } from '../../lib/formImport';

export function FormBuilderPage() {
  const { id } = useParams();
  const userId = useUserId();
  const existing = useLoad(() => (id ? getForm(id) : Promise.resolve(null)), [id]);
  const menu = useLoad(() => listMenuItems(userId), [userId]);
  // A Google Form / JotForm import (FormsPage) opens here as an unsaved new form.
  const imported = (useLocation().state as { imported?: ImportedForm } | null)?.imported;
  if (id && existing.loading) return <div className="page"><Spinner /></div>;
  if (id && !existing.data) return <div className="page"><ErrorBanner message={existing.error ?? 'Form not found.'} /></div>;
  return <Builder key={id ?? 'new'} initial={existing.data ?? null} imported={id ? undefined : imported} menu={menu.data ?? []} userId={userId} />;
}

function Builder({ initial, imported, menu, userId }: { initial: { id: string; title: string; description: string; fields: FormField[] } | null; imported?: ImportedForm; menu: MenuItemFull[]; userId: string }) {
  const navigate = useNavigate();
  const toast = useToast();
  const [formId] = useState(() => initial?.id ?? newId());
  const [title, setTitle] = useState(initial?.title ?? imported?.title ?? '');
  const [description, setDescription] = useState(initial?.description ?? imported?.description ?? '');
  const [fields, setFields] = useState<FormField[]>(() => initial?.fields ?? imported?.fields ?? starterFields());
  const [selected, setSelected] = useState<string | null>(null);
  const [adding, setAdding] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const baseline = useRef(JSON.stringify({ title: initial?.title ?? '', description: initial?.description ?? '', fields: initial?.fields ?? starterFields() }));
  const dirty = JSON.stringify({ title, description, fields }) !== baseline.current || !initial;

  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  const update = (fid: string, p: Partial<FormField>) => setFields((fs) => fs.map((f) => (f.id === fid ? { ...f, ...p } : f)));

  function insert(type: FieldType, at: number) {
    const f = blankField(type);
    setFields((fs) => [...fs.slice(0, at), f, ...fs.slice(at)]);
    setSelected(f.id);
    setAdding(null);
  }

  async function save() {
    if (!title.trim()) { setErr('Give your form a name.'); return; }
    const blank = fields.find((f) => f.field_type !== 'heading' && !f.label.trim());
    if (blank) { setSelected(blank.id); setErr('Every question needs a label.'); return; }
    setBusy(true); setErr(null);
    try {
      await saveForm(userId, { id: formId, title, description, fields });
      baseline.current = JSON.stringify({ title, description, fields });
      toast('Form saved');
      navigate('/forms');
    } catch (e: any) { setErr(e.message); setBusy(false); }
  }

  return (
    <div className="page page-wide">
      <div className="page-header">
        <div className="grow">
          <Link to="/forms" className="back-link">Order forms</Link>
          <input className="title-input" value={title} placeholder="Name your form, e.g. Wedding Cake Request" onChange={(e) => setTitle(e.target.value)} aria-label="Form name" />
        </div>
        <div className="page-actions">
          {initial && <Button variant="ghost" onClick={() => setConfirmDelete(true)}>Delete</Button>}
          <Button loading={busy} onClick={save} disabled={!dirty && !!initial}>{initial ? (dirty ? 'Save changes' : 'Saved') : 'Save form'}</Button>
        </div>
      </div>
      {err && <ErrorBanner message={err} />}

      <div className="form-builder">
        <div className="fb-fields">
          <div className="fb-fixed">
            <div className="row-title">Description</div>
            <p className="small muted">Shown at the top of your form, before the customer’s details — a welcome message, booking window, policies.</p>
            <Textarea rows={3} value={description} placeholder="Optional" onChange={(e) => setDescription(e.target.value)} aria-label="Form description" />
          </div>
          <div className="fb-fixed">
            <div className="row-title">Customer details</div>
            <p className="small muted">Every customer gives their name, email, and phone before your questions — the same for every vendor, so they’re not editable here.</p>
          </div>

          <AddBar onClick={() => setAdding(0)} />
          <SortableList items={fields} keyOf={(f) => f.id} onReorder={setFields} className="fb-list"
            renderRow={(f, handle) => {
              const i = fields.indexOf(f);
              return (
                <>
                  <FieldCard
                    field={f} index={i} all={fields} menu={menu} handle={handle}
                    open={selected === f.id}
                    onOpen={() => setSelected(selected === f.id ? null : f.id)}
                    onChange={(p) => update(f.id, p)}
                    onDuplicate={() => {
                      const copy = { ...structuredClone(f), id: newId(), product_options: f.product_options.map((p) => ({ ...p, id: swiftUUID() })) };
                      setFields((fs) => [...fs.slice(0, i + 1), copy, ...fs.slice(i + 1)]);
                      setSelected(copy.id);
                    }}
                    onDelete={() => setFields((fs) => fs.filter((x) => x.id !== f.id).map((x) => (x.condition_field_id === f.id ? { ...x, condition_field_id: null, condition_values: [] } : x)))}
                  />
                  <AddBar onClick={() => setAdding(i + 1)} />
                </>
              );
            }} />
          {!fields.length && <p className="muted center small">No questions yet — add one above.</p>}
        </div>

        <aside className="fb-preview">
          <div className="fb-preview-label">Customer view</div>
          <div className="fb-phone">
            <IPhoneFrame><FormPreview title={title} description={description} fields={fields} highlight={selected} onSelect={setSelected} /></IPhoneFrame>
          </div>
        </aside>
      </div>

      {adding !== null && (
        <Modal title="Add a question" wide onClose={() => setAdding(null)}>
          <div className="type-grid">
            {FIELD_TYPES.map((t) => (
              <button key={t.type} className="type-card" onClick={() => insert(t.type, adding)}>
                <span className="row-title">{t.label}</span>
                <span className="small muted">{t.hint}</span>
              </button>
            ))}
          </div>
        </Modal>
      )}
      {confirmDelete && initial && (
        <ConfirmModal title={`Delete “${initial.title || 'this form'}”?`} danger confirmLabel="Delete form"
          body="Listings using this form go back to the standard custom order questions. Past orders keep their answers."
          onClose={() => setConfirmDelete(false)}
          onConfirm={async () => { await deleteForm(initial.id); toast('Form deleted'); navigate('/forms'); }} />
      )}
    </div>
  );
}

function AddBar({ onClick }: { onClick: () => void }) {
  return <button type="button" className="fb-add" onClick={onClick}><span>+ Add question</span></button>;
}

function FieldCard({
  field: f, index, all, menu, handle, open, onOpen, onChange, onDuplicate, onDelete,
}: {
  field: FormField; index: number; all: FormField[]; menu: MenuItemFull[]; handle: ReactNode; open: boolean; onOpen: () => void;
  onChange: (p: Partial<FormField>) => void; onDuplicate: () => void; onDelete: () => void;
}) {
  const triggers = useMemo(() => all.slice(0, index).filter((x) => isTriggerType(x.field_type)), [all, index]);
  const trigger = triggers.find((t) => t.id === f.condition_field_id);
  const placeholder = f.field_type === 'heading' ? 'Section title' : f.field_type === 'notice' ? 'Policy or notice text'
    : f.field_type === 'agreement' ? 'e.g. I agree to the cancellation policy' : 'Question';

  return (
    <div className={`fb-card ${open ? 'open' : ''}`}>
      <div className="fb-card-head" onClick={onOpen}>
        {handle}
        <span className="type-chip">{fieldTypeLabel(f.field_type)}</span>
        <span className="grow ellipsis fb-card-label">{f.label || <span className="muted">Untitled</span>}</span>
        {f.is_required && isAnswerField(f.field_type) && <span className="req-dot" title="Required">Required</span>}
        {f.condition_field_id && <span className="small muted" title="Conditional">◐</span>}
        <span className="chev">{open ? '▾' : '▸'}</span>
      </div>
      {open && (
        <div className="fb-card-body">
          {f.field_type === 'notice'
            ? <Textarea rows={4} value={f.label} placeholder={placeholder} onChange={(e) => onChange({ label: e.target.value })} autoFocus />
            : <Input value={f.label} placeholder={placeholder} onChange={(e) => onChange({ label: e.target.value })} autoFocus />}
          {f.field_type !== 'heading' && f.field_type !== 'notice' && (
            <Input value={f.help_text ?? ''} placeholder="Help text (optional)" onChange={(e) => onChange({ help_text: e.target.value || null })} />
          )}
          {f.field_type === 'heading' && <p className="small muted">A section title only — customers don’t answer it, it just breaks up the form.</p>}
          {f.field_type === 'notice' && <p className="small muted">Shown as plain text — use it for policies, terms, or anything customers just need to read.</p>}

          {(f.field_type === 'single_choice' || f.field_type === 'multi_choice') && (
            <div className="rows-editor">
              {f.options.map((o, i) => (
                <div key={i} className="item-edit-row">
                  <span className="opt-bullet">{f.field_type === 'single_choice' ? '○' : '□'}</span>
                  <Input className="grow" value={o} placeholder={`Option ${i + 1}`} onChange={(e) => onChange({ options: f.options.map((x, j) => (j === i ? e.target.value : x)) })} />
                  <button type="button" className="icon-btn sm" aria-label="Remove option" onClick={() => onChange({ options: f.options.filter((_, j) => j !== i) })}>×</button>
                </div>
              ))}
              <div><Button type="button" variant="secondary" onClick={() => onChange({ options: [...f.options, ''] })}>Add option</Button></div>
            </div>
          )}

          {f.field_type === 'product_selector' && <ProductOptions options={f.product_options} menu={menu} onChange={(product_options) => onChange({ product_options })} />}

          {isAnswerField(f.field_type) && (
            <label className="check"><input type="checkbox" checked={f.is_required} onChange={(e) => onChange({ is_required: e.target.checked })} />
              {f.field_type === 'agreement' ? 'Customer must check this to continue' : 'Required'}</label>
          )}

          {triggers.length > 0 && (
            <div className="cond">
              <Select value={f.condition_field_id ?? ''} onChange={(e) => onChange({ condition_field_id: e.target.value || null, condition_values: [] })}>
                <option value="">Always shown</option>
                {triggers.map((t) => <option key={t.id} value={t.id}>Only if “{t.label || 'Untitled question'}” matches…</option>)}
              </Select>
              {trigger && (
                <div className="cond-values">
                  <span className="small muted">Show when the customer picks any of:</span>
                  {(trigger.field_type === 'product_selector'
                    ? trigger.product_options.map((p) => ({ value: p.id, label: p.name }))
                    : trigger.options.filter((o) => o.trim()).map((o) => ({ value: o, label: o }))
                  ).map((c) => (
                    <label key={c.value} className="check small">
                      <input type="checkbox" checked={f.condition_values.includes(c.value)}
                        onChange={(e) => onChange({ condition_values: e.target.checked ? [...f.condition_values, c.value] : f.condition_values.filter((v) => v !== c.value) })} />
                      {c.label}
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="fb-card-actions">
            <button type="button" className="link-btn small" onClick={onDuplicate}>Duplicate</button>
            <button type="button" className="link-btn small danger-text" onClick={onDelete}>Delete</button>
          </div>
        </div>
      )}
    </div>
  );
}

function ProductOptions({ options, menu, onChange }: { options: ProductOption[]; menu: MenuItemFull[]; onChange: (o: ProductOption[]) => void }) {
  const [pick, setPick] = useState('');
  const upd = (i: number, p: Partial<ProductOption>) => onChange(options.map((o, j) => (j === i ? { ...o, ...p } : o)));
  const priced = menu.filter((m) => m.listing_kind !== 'digital');
  return (
    <div className="rows-editor">
      {options.length > 0 && (
        <div className="item-edit-head small muted"><span className="grow">Item</span><span className="w-num">Price</span><span className="w-num">Max qty</span></div>
      )}
      {options.map((o, i) => (
        <div key={o.id} className="item-edit-row">
          <Input className="grow" value={o.name} placeholder="Item name" onChange={(e) => upd(i, { name: e.target.value })} />
          <Input className="w-num" type="number" min="0" step="0.01" value={o.price || ''} placeholder="0.00" onChange={(e) => upd(i, { price: parseNumber(e.target.value) })} />
          <Input className="w-num" type="number" min="0" value={o.maxQuantity || ''} placeholder="Any" onChange={(e) => upd(i, { maxQuantity: Math.max(0, Math.floor(parseNumber(e.target.value))) })} />
          <button type="button" className="icon-btn sm" aria-label="Remove item" onClick={() => onChange(options.filter((_, j) => j !== i))}>×</button>
        </div>
      ))}
      <div className="btn-row">
        <Select value={pick} onChange={(e) => {
          const m = priced.find((x) => x.id === e.target.value);
          if (m) onChange([...options, { id: swiftUUID(), sourceMenuItemID: m.id.toUpperCase(), name: m.name, price: m.marketplace_price_from > 0 ? m.marketplace_price_from : m.default_price, maxQuantity: 0 }]);
          setPick('');
        }}>
          <option value="">+ From your menu…</option>
          {priced.map((m) => <option key={m.id} value={m.id}>{m.name} — {formatMoney(m.marketplace_price_from > 0 ? m.marketplace_price_from : m.default_price)}</option>)}
        </Select>
        <Button type="button" variant="secondary" onClick={() => onChange([...options, { id: swiftUUID(), sourceMenuItemID: null, name: '', price: 0, maxQuantity: 0 }])}>Custom item</Button>
      </div>
    </div>
  );
}
