import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth, useUserId } from '../../auth/AuthProvider';
import { Button, Card, ConfirmModal, ErrorBanner, Field, Input, PageHeader, Select, Spinner, Textarea, Toggle, useLoad, useToast } from '../../components/ui';
import {
  LISTING_KINDS, compressImage, deleteMenuItem, listIntakeForms, listMenuItems, menuImageURL, saveMenuItem, variantImageURL,
  type MenuDraft, type MenuItemFull,
} from '../../lib/menu';
import { listRecipes } from '../../lib/data';
import { formatMoney, fromLocalInput, parseNumber, toDateInput, toDateTimeInput } from '../../lib/format';
import type { ListingKind } from '../../lib/types';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const isFood = (k: ListingKind) => k === 'ready_now' || k === 'preorder' || k === 'custom';

function emptyDraft(kind: ListingKind): MenuDraft {
  return {
    name: '', item_description: '', category: '', unit: 'pieces', price: 0, is_active: true, is_listed: true,
    listing_kind: kind, available_qty_today: 0, lead_days: 2, preorder_mode: 'fixed_dates', preorder_dates: [],
    preorder_weekday: 6, preorder_cutoff: null, delivery_mode: 'default', delivery_fee: 0, accepts_buyer_note: false,
    allergens: '', lead_time_note: '', shipping_fee: 0, intake_form_id: null, recipe_ids: [], recipe_names: [],
    is_assorted_box: false, tiers: [], box_variants: [], has_variants: false, options: [],
    is_storefront_form: false, storefront_intro_title: '', storefront_intro_body: '', use_as_site_body: false,
  };
}

function draftFrom(m: MenuItemFull, profileDelivery: boolean, siteListingId: string | null | undefined): MenuDraft {
  return {
    name: m.name, item_description: m.item_description, category: m.category, unit: m.unit, price: m.default_price,
    is_active: m.is_active, is_listed: m.is_listed_in_marketplace, listing_kind: m.listing_kind,
    available_qty_today: m.available_qty_today, lead_days: m.lead_days, preorder_mode: m.preorder_schedule_mode ?? 'fixed_dates',
    preorder_dates: (m.preorder_dates ?? []).map((d) => toDateInput(d)), preorder_weekday: m.preorder_weekday ?? 6,
    preorder_cutoff: m.preorder_order_cutoff_date,
    // Delivery "default" means "follow my storefront setting" — iOS only
    // stores the resolved boolean, so infer the mode back from it.
    delivery_mode: m.is_delivery_available === profileDelivery && !m.delivery_fee ? 'default' : m.is_delivery_available ? 'on' : 'off',
    delivery_fee: m.delivery_fee, accepts_buyer_note: m.accepts_buyer_note, allergens: m.allergens,
    lead_time_note: m.lead_time_note, shipping_fee: m.shipping_fee, intake_form_id: m.intake_form_id,
    recipe_ids: m.recipe_ids?.length ? m.recipe_ids : m.recipe_id ? [m.recipe_id] : [], recipe_names: [],
    is_assorted_box: m.is_assorted_box,
    tiers: m.tiers.map((t) => ({ id: t.id, label: t.label, unit_count: t.unit_count, price: t.price })),
    box_variants: m.boxVariants.map((v) => ({ id: v.id, name: v.name, has_image: v.has_image })),
    has_variants: m.has_variants,
    options: m.listingVariants.map((o) => ({ id: o.id, label: o.label, price: o.price, stock_qty: o.stock_qty, has_image: o.has_image })),
    is_storefront_form: !!m.is_storefront_form,
    storefront_intro_title: m.storefront_intro_title ?? '',
    storefront_intro_body: m.storefront_intro_body ?? '',
    use_as_site_body: !!siteListingId && siteListingId.toLowerCase() === m.id.toLowerCase(),
  };
}

export function MenuItemEditorPage() {
  const { id } = useParams();
  const userId = useUserId();
  const { profile, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const items = useLoad(() => listMenuItems(userId), [userId]);
  const forms = useLoad(() => listIntakeForms(userId), [userId]);
  const recipes = useLoad(() => listRecipes(userId), [userId]);
  const existing = useMemo(() => items.data?.find((m) => m.id === id), [items.data, id]);

  const [draft, setDraft] = useState<MenuDraft | null>(null);
  const [image, setImage] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [digitalFile, setDigitalFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [newDate, setNewDate] = useState('');

  useEffect(() => {
    if (id && existing && !draft) setDraft(draftFrom(existing, !!profile?.delivery_enabled, profile?.storefront_listing_id));
  }, [id, existing, draft, profile?.delivery_enabled, profile?.storefront_listing_id]);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const categories = useMemo(() => [...new Set((items.data ?? []).map((m) => m.category).filter(Boolean))].sort(), [items.data]);

  if (items.loading) return <div className="page"><Spinner /></div>;
  if (id && !existing) return <div className="page"><ErrorBanner message="Listing not found." /></div>;

  // New listing: pick a type first (iOS NewListingTypeGate).
  if (!draft) {
    return (
      <div className="page">
        <PageHeader back={<Link to="/menu" className="back-link">← Menu</Link>} title="What are you listing?" />
        <div className="kind-grid">
          {LISTING_KINDS.map((k) => (
            <button key={k.kind} className="kind-card" onClick={() => setDraft(emptyDraft(k.kind))}>
              <span className="kind-icon" aria-hidden>{KIND_ICONS[k.kind]}</span>
              <span className="kind-title">{k.label}</span>
              <span className="muted small">{k.description}</span>
            </button>
          ))}
          <button className="kind-card kind-card-wide" onClick={() => setDraft({ ...emptyDraft('custom'), is_storefront_form: true, use_as_site_body: true })}>
            <span className="kind-icon" aria-hidden>{KIND_ICONS.form}</span>
            <span className="kind-title">Custom Order Form (replaces storefront)</span>
            <span className="muted small">Ideal for vendors who prefer a catering-style order form: your storefront becomes your header, About, and one request form.</span>
          </button>
        </div>
      </div>
    );
  }

  const d = draft;
  const set = <K extends keyof MenuDraft>(k: K, v: MenuDraft[K]) => setDraft({ ...d, [k]: v });
  const kind = d.listing_kind;
  const priced = !d.is_assorted_box && !d.has_variants;
  const formListing = kind === 'custom' && d.is_storefront_form;

  async function pickImage(file: File | undefined) {
    if (!file) return;
    try {
      const blob = await compressImage(file);
      setImage(blob);
      setPreview(URL.createObjectURL(blob));
    } catch (e: any) { setError(e.message); }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!d.name.trim()) { setError('Give this listing a name.'); return; }
    if (formListing && d.use_as_site_body && !d.intake_form_id) {
      setError('Pick the order form customers will fill in, or turn off “Set as storefront”.');
      return;
    }
    if (d.is_listed && kind === 'custom' && !d.intake_form_id) {
      setError('A custom listing needs an order form before it can be listed. Pick one, or turn off “Show on my storefront” to save it as a draft.');
      return;
    }
    if (d.is_listed && kind === 'digital' && !digitalFile && !existing?.digital_file_path) {
      setError('Upload the file customers will download, or save this as a draft.');
      return;
    }
    if (d.is_listed && !d.has_variants && (kind === 'ready_now' || kind === 'physical') && d.available_qty_today < 1) {
      setError(`Add at least 1 in stock to list this as ${kind === 'ready_now' ? 'Ready Now' : 'a shipped item'}, or turn off “List on storefront” to save it as a draft.`);
      return;
    }
    if (priced && d.price <= 0 && kind !== 'custom' && d.is_listed) {
      setError('Add a price.');
      return;
    }
    setBusy(true); setError(null);
    try {
      const names = (recipes.data ?? []).filter((r) => d.recipe_ids.includes(r.id)).map((r) => r.name);
      const toSave = formListing ? { ...d, is_listed: d.use_as_site_body } : d;
      const res = await saveMenuItem(userId, { ...toSave, recipe_names: names }, profile, existing, items.data ?? [], image, digitalFile);
      if (formListing) await refreshProfile();
      toast(res.unlistedForNoFulfillment
        ? 'Saved as a draft — add a pickup address in Settings → Shop settings to list food items.'
        : res.hidOthers ? `Saved — your storefront now shows just this form (${res.hidOthers} other listing${res.hidOthers === 1 ? '' : 's'} hidden).` : 'Listing saved', res.unlistedForNoFulfillment ? 'error' : 'ok');
      navigate('/menu');
    } catch (err: any) {
      setError(err.message);
      setBusy(false);
    }
  }

  const imgSrc = preview ?? (existing?.has_image ? menuImageURL(existing) : null);
  const kindLabel = LISTING_KINDS.find((k) => k.kind === kind)?.label ?? '';
  const previewPrice = d.is_assorted_box ? Math.min(...d.tiers.filter((t) => t.price > 0).map((t) => t.price), Infinity)
    : d.has_variants ? Math.min(...d.options.filter((o) => o.price > 0).map((o) => o.price), Infinity) : d.price;

  const header = (
    <PageHeader
      back={<Link to="/menu" className="back-link">← Menu & Listings</Link>}
      title={id ? d.name || 'Edit listing' : formListing ? 'New custom order form' : `New ${kindLabel.toLowerCase()} listing`}
      subtitle={<span className="kind-pill">{formListing ? 'Custom order form' : kindLabel}</span>}
      actions={<>
        {id && <Button type="button" variant="ghost" onClick={() => setConfirmDelete(true)}>Delete</Button>}
        <Button type="submit" loading={busy}>Save</Button>
      </>}
    />
  );

  const deleteModal = confirmDelete && existing && (
    <ConfirmModal title={`Delete “${existing.name}”?`} body="It’s removed from your storefront and from Bakeri on all your devices. Past orders keep their details." confirmLabel="Delete listing" danger
      onClose={() => setConfirmDelete(false)}
      onConfirm={async () => { await deleteMenuItem(existing); toast('Listing deleted'); navigate('/menu'); }} />
  );

  // A Custom Order Form collapses to name + intro + form (iOS siteBodySections).
  if (formListing) {
    return (
      <form className="page" onSubmit={submit}>
        {header}
        {error && <ErrorBanner message={error} />}
        <div className="detail-grid">
          <div className="stack-lg">
            <Card title="Form">
              <Field label="Name" hint="For your own reference — customers see the intro and form below."><Input required value={d.name} onChange={(e) => set('name', e.target.value)} placeholder="Custom order request" /></Field>
              <Field label="Order form">
                <div className="btn-row">
                  <Select className="grow" value={d.intake_form_id ?? ''} onChange={(e) => set('intake_form_id', e.target.value || null)}>
                    <option value="">Choose a form…</option>
                    {(forms.data ?? []).map((f) => <option key={f.id} value={f.id}>{f.title || 'Untitled form'}</option>)}
                  </Select>
                  {d.intake_form_id && <Link className="btn btn-ghost" to={`/forms/${d.intake_form_id}`}>Edit form</Link>}
                  <Link className="btn btn-secondary" to="/forms/new">New form</Link>
                </div>
              </Field>
            </Card>
            <Card title="Storefront intro">
              <Field label="Title (optional)"><Input value={d.storefront_intro_title} onChange={(e) => set('storefront_intro_title', e.target.value)} placeholder="Let’s make something special" /></Field>
              <Field label="Text shown above the form (optional)"><Textarea rows={4} value={d.storefront_intro_body} onChange={(e) => set('storefront_intro_body', e.target.value)} placeholder="Fill this out at least 2 weeks before your event date." /></Field>
            </Card>
            <p className="small muted">This is a Custom Order Form — price, availability, allergens and fulfillment don’t apply. It’s either your whole storefront or hidden; there’s nothing in between.</p>
          </div>
          <div className="stack-lg">
            <Card title="Storefront">
              <Toggle checked={d.use_as_site_body} onChange={(v) => setDraft({ ...d, use_as_site_body: v, is_listed: v })}
                label="Set as storefront"
                hint={d.use_as_site_body ? 'Your storefront shows only this form — other listings are hidden.' : 'Hidden — turn on to make this your whole storefront.'} />
            </Card>
          </div>
        </div>
        {deleteModal}
      </form>
    );
  }

  return (
    <form className="page" onSubmit={submit}>
      {header}
      {error && <ErrorBanner message={error} />}

      <div className="detail-grid">
        <div className="stack-lg">
          <Card title="Details">
            <Field label="Name"><Input required value={d.name} onChange={(e) => set('name', e.target.value)} placeholder={kind === 'digital' ? 'Holiday cookie decorating guide' : 'Brown butter chocolate chip cookies'} /></Field>
            <Field label="Description"><Textarea rows={4} value={d.item_description} onChange={(e) => set('item_description', e.target.value)} placeholder="What makes it special, what’s included, how it’s packaged…" /></Field>
            <div className="grid-2">
              <Field label="Category">
                <Input list="cats" value={d.category} onChange={(e) => set('category', e.target.value)} placeholder="Cookies, Cakes…" />
                <datalist id="cats">{categories.map((c) => <option key={c} value={c} />)}</datalist>
              </Field>
              {priced && (
                <Field label={kind === 'custom' ? 'Starting price' : 'Price'}>
                  <div className="money-input"><span>$</span><Input type="number" min="0" step="0.01" value={d.price || ''} placeholder="0.00" onChange={(e) => set('price', parseNumber(e.target.value))} /></div>
                </Field>
              )}
            </div>
            {isFood(kind) && (
              <Field label="Allergens (optional)"><Input value={d.allergens} onChange={(e) => set('allergens', e.target.value)} placeholder="Wheat, eggs, dairy" /></Field>
            )}
            {isFood(kind) && kind !== 'preorder' && kind !== 'custom' && (
              <Field label="Lead time (optional)"><Input value={d.lead_time_note} onChange={(e) => set('lead_time_note', e.target.value)} placeholder="Order by Thursday for weekend pickup" /></Field>
            )}
          </Card>

          {kind === 'ready_now' && !d.has_variants && (
            <Card title="Availability">
              <Field label="Available today" hint="Sells out and hides automatically at 0.">
                <Stepper value={d.available_qty_today} onChange={(v) => set('available_qty_today', v)} />
              </Field>
              {d.is_listed && d.available_qty_today < 1 && <p className="small warn-text">Add at least 1 to post as Ready Now.</p>}
            </Card>
          )}

          {kind === 'preorder' && (
            <Card title="Pre-order schedule">
              <Field label="When is it ready?">
                <div className="seg">
                  <button type="button" className={d.preorder_mode === 'fixed_dates' ? 'active' : ''} onClick={() => set('preorder_mode', 'fixed_dates')}>Specific dates</button>
                  <button type="button" className={d.preorder_mode === 'weekday' ? 'active' : ''} onClick={() => set('preorder_mode', 'weekday')}>Every week</button>
                  <button type="button" className={d.preorder_mode === 'lead_time' ? 'active' : ''} onClick={() => set('preorder_mode', 'lead_time')}>Days after ordering</button>
                </div>
              </Field>
              {d.preorder_mode === 'fixed_dates' && (
                <>
                  <div className="chips">
                    {[...d.preorder_dates].sort().map((dt) => (
                      <span key={dt} className="chip">
                        {new Date(`${dt}T12:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
                        <button type="button" aria-label="Remove date" onClick={() => set('preorder_dates', d.preorder_dates.filter((x) => x !== dt))}>×</button>
                      </span>
                    ))}
                    {!d.preorder_dates.length && <span className="small muted">No dates yet.</span>}
                  </div>
                  <div className="btn-row">
                    <Input type="date" value={newDate} min={toDateInput(new Date().toISOString())} onChange={(e) => setNewDate(e.target.value)} />
                    <Button type="button" variant="secondary" disabled={!newDate} onClick={() => { if (!d.preorder_dates.includes(newDate)) set('preorder_dates', [...d.preorder_dates, newDate]); setNewDate(''); }}>Add date</Button>
                  </div>
                </>
              )}
              {d.preorder_mode === 'weekday' && (
                <div className="grid-2">
                  <Field label="Ready every">
                    <Select value={d.preorder_weekday} onChange={(e) => set('preorder_weekday', Number(e.target.value))}>
                      {WEEKDAYS.map((w, i) => <option key={w} value={i + 1}>{w}</option>)}
                    </Select>
                  </Field>
                  <Field label="Order-by cutoff">
                    <Input type="datetime-local" value={toDateTimeInput(d.preorder_cutoff)} onChange={(e) => set('preorder_cutoff', e.target.value ? fromLocalInput(e.target.value) : null)} />
                  </Field>
                </div>
              )}
              {d.preorder_mode === 'lead_time' && (
                <Field label="Ready in" hint="Days after the customer orders."><Stepper value={d.lead_days} min={1} max={30} suffix="days" onChange={(v) => set('lead_days', v)} /></Field>
              )}
              {!d.has_variants && (
                <Field label="Available" hint="Total orders accepted for this run. 0 means no limit.">
                  <Stepper value={d.available_qty_today} onChange={(v) => set('available_qty_today', v)} />
                </Field>
              )}
              <Field label="Lead time note (optional)"><Input value={d.lead_time_note} onChange={(e) => set('lead_time_note', e.target.value)} placeholder="Order by Wednesday for Saturday pickup" /></Field>
            </Card>
          )}

          {kind === 'custom' && (
            <Card title="Custom order request">
              <Field label="Order form" hint={forms.data?.length ? 'Customers fill this in to request a quote.' : 'You don’t have any order forms yet.'}>
                <div className="btn-row">
                  <Select className="grow" value={d.intake_form_id ?? ''} onChange={(e) => set('intake_form_id', e.target.value || null)}>
                    <option value="">Choose a form…</option>
                    {(forms.data ?? []).map((f) => <option key={f.id} value={f.id}>{f.title || 'Untitled form'}</option>)}
                  </Select>
                  <Link className="btn btn-secondary" to="/forms/new">New form</Link>
                </div>
              </Field>
              <Field label="Notice needed"><Stepper value={d.lead_days} min={0} max={90} suffix="days" onChange={(v) => set('lead_days', v)} /></Field>
              <Field label="Lead time note (optional)"><Input value={d.lead_time_note} onChange={(e) => set('lead_time_note', e.target.value)} placeholder="Book at least 2 weeks ahead" /></Field>
            </Card>
          )}

          {kind === 'physical' && (
            <Card title="Shipping & stock">
              <div className="grid-2">
                {!d.has_variants && (
                  <Field label="In stock"><Stepper value={d.available_qty_today} onChange={(v) => set('available_qty_today', v)} /></Field>
                )}
                <Field label="Ships in" hint="Days to pack and ship."><Stepper value={d.lead_days} min={1} max={30} suffix="days" onChange={(v) => set('lead_days', v)} /></Field>
                <Field label="Shipping fee" hint="Added to the order at checkout.">
                  <div className="money-input"><span>$</span><Input type="number" min="0" step="0.01" value={d.shipping_fee || ''} placeholder="0.00" onChange={(e) => set('shipping_fee', parseNumber(e.target.value))} /></div>
                </Field>
              </div>
              {d.is_listed && !d.has_variants && d.available_qty_today < 1 && <p className="small warn-text">Add at least 1 to post as Physical.</p>}
              <p className="small muted">Combined-shipping discounts are in <Link to="/shop-settings">Shop settings</Link>.</p>
            </Card>
          )}

          {kind === 'digital' && (
            <Card title="Download file">
              <label className="file-drop">
                <input type="file" hidden onChange={(e) => setDigitalFile(e.target.files?.[0] ?? null)} />
                {digitalFile ? <><strong>{digitalFile.name}</strong><span className="small muted">{Math.round(digitalFile.size / 1024)} KB · click to replace</span></>
                  : existing?.digital_file_path ? <><strong>File attached</strong><span className="small muted">Click to upload a new one</span></>
                    : <><strong>Upload the file customers download</strong><span className="small muted">PDF, PNG, ZIP… up to 100 MB</span></>}
              </label>
            </Card>
          )}

          {(kind === 'physical' || kind === 'digital') && (
            <Card title="Options">
              <Toggle checked={d.has_variants} onChange={(v) => set('has_variants', v)} label="This has options (size, colour…)" hint="Each option has its own price and can have its own photo." />
              {d.has_variants && (
                <RowsEditor
                  rows={d.options}
                  onChange={(rows) => set('options', rows)}
                  blank={{ label: '', price: 0, stock_qty: 0 }}
                  addLabel="Add option"
                  render={(o, upd) => (
                    <>
                      <VariantPhoto userId={userId} itemId={existing?.id} row={o} onPick={(image) => upd({ image })} />
                      <Input className="grow" placeholder="Option" value={o.label} onChange={(e) => upd({ label: e.target.value })} />
                      <Input className="w-num" type="number" min="0" step="0.01" placeholder="Price" value={o.price || ''} onChange={(e) => upd({ price: parseNumber(e.target.value) })} />
                      {kind === 'physical' && <Input className="w-num" type="number" min="0" placeholder="Stock" value={o.stock_qty} onChange={(e) => upd({ stock_qty: Math.floor(parseNumber(e.target.value)) })} />}
                    </>
                  )}
                />
              )}
            </Card>
          )}

          {isFood(kind) && kind !== 'custom' && (
            <Card title="Box of assorted items">
              <Toggle checked={d.is_assorted_box} onChange={(v) => set('is_assorted_box', v)} label="Sold as a box the customer fills" hint="e.g. a dozen cookies in mixed flavours. Each box size has its own price." />
              {d.is_assorted_box && (
                <>
                  <h3 className="h3">Box sizes</h3>
                  <RowsEditor
                    rows={d.tiers}
                    onChange={(rows) => set('tiers', rows)}
                    blank={{ label: '', unit_count: 6, price: 0 }}
                    addLabel="Add size"
                    render={(t, upd) => (
                      <>
                        <Input className="grow" placeholder="Half dozen" value={t.label} onChange={(e) => upd({ label: e.target.value })} />
                        <Input className="w-num" type="number" min="1" placeholder="Pieces" value={t.unit_count} onChange={(e) => upd({ unit_count: Math.floor(parseNumber(e.target.value)) })} />
                        <Input className="w-num" type="number" min="0" step="0.01" placeholder="Price" value={t.price || ''} onChange={(e) => upd({ price: parseNumber(e.target.value) })} />
                      </>
                    )}
                  />
                  <h3 className="h3">Flavours</h3>
                  <RowsEditor
                    rows={d.box_variants}
                    onChange={(rows) => set('box_variants', rows)}
                    blank={{ name: '' }}
                    addLabel="Add flavour"
                    render={(v, upd) => (
                      <>
                        <VariantPhoto userId={userId} itemId={existing?.id} row={v} onPick={(image) => upd({ image })} />
                        <Input className="grow" placeholder="Chocolate chip" value={v.name} onChange={(e) => upd({ name: e.target.value })} />
                      </>
                    )}
                  />
                </>
              )}
            </Card>
          )}

          {isFood(kind) && (recipes.data?.length ?? 0) > 0 && (
            <Card title="Linked recipes" actions={<span className="small muted">Used for ingredient costs</span>}>
              <div className="check-list">
                {recipes.data!.map((r) => (
                  <label key={r.id} className="check">
                    <input type="checkbox" checked={d.recipe_ids.includes(r.id)}
                      onChange={(e) => set('recipe_ids', e.target.checked ? [...d.recipe_ids, r.id] : d.recipe_ids.filter((x) => x !== r.id))} />
                    {r.name}
                  </label>
                ))}
              </div>
            </Card>
          )}
        </div>

        <div className="stack-lg sticky-col">
          <Card title="Photo">
            <label className="photo-drop"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); pickImage(e.dataTransfer.files?.[0]); }}>
              {imgSrc ? <img src={imgSrc} alt="" /> : <span className="photo-empty"><strong>Add a photo</strong><span className="small muted">Click or drop an image here</span></span>}
              <input type="file" accept="image/*" hidden onChange={(e) => pickImage(e.target.files?.[0])} />
            </label>
            {imgSrc && <p className="small muted">Click or drop to replace.</p>}
          </Card>

          <Card title="How customers see it">
            <div className="listing-preview">
              <div className="lp-img">{imgSrc ? <img src={imgSrc} alt="" /> : <span>{(d.name || '?')[0]}</span>}</div>
              <div className="lp-body">
                <div className="lp-name">{d.name || 'Your listing'}</div>
                {d.item_description && <div className="lp-desc">{d.item_description}</div>}
                <div className="lp-meta">
                  <span className="lp-price">{kind === 'custom' ? (d.price > 0 ? `From ${formatMoney(d.price)}` : 'Request a quote') : Number.isFinite(previewPrice) && previewPrice > 0 ? `${d.is_assorted_box || d.has_variants ? 'From ' : ''}${formatMoney(previewPrice)}` : '—'}</span>
                  <span className="lp-kind">{kind === 'ready_now' ? `${d.available_qty_today} ready` : kind === 'preorder' ? 'Pre-order' : kind === 'physical' ? 'Ships to you' : kind === 'digital' ? 'Instant download' : 'Custom'}</span>
                </div>
              </div>
            </div>
          </Card>

          <Card title="Visibility">
            <Toggle checked={d.is_listed} onChange={(v) => set('is_listed', v)} label="List on storefront" hint={d.is_listed ? 'Customers can see and order this.' : 'Off saves it as a draft.'} />
            {isFood(kind) && <Toggle checked={d.accepts_buyer_note} onChange={(v) => set('accepts_buyer_note', v)} label="Allow buyer message" hint="Customers can add a note when they order." />}
            {isFood(kind) && !profile?.pickup_address?.trim() && (
              <p className="small warn-text">Add a pickup address in <Link to="/shop-settings">Shop settings</Link> before food listings can go live.</p>
            )}
          </Card>
        </div>
      </div>
      {deleteModal}
    </form>
  );
}

function RowsEditor<T extends { id?: string }>({
  rows, onChange, blank, render, addLabel,
}: { rows: T[]; onChange: (rows: T[]) => void; blank: T; render: (row: T, update: (p: Partial<T>) => void) => ReactNode; addLabel: string }) {
  return (
    <div className="rows-editor">
      {rows.map((r, i) => (
        <div key={r.id ?? `new-${i}`} className="item-edit-row">
          {render(r, (p) => onChange(rows.map((x, j) => (j === i ? { ...x, ...p } : x))))}
          <button type="button" className="icon-btn" aria-label="Remove" onClick={() => onChange(rows.filter((_, j) => j !== i))}>×</button>
        </div>
      ))}
      <Button type="button" variant="secondary" onClick={() => onChange([...rows, { ...blank }])}>{addLabel}</Button>
    </div>
  );
}


function Stepper({ value, onChange, min = 0, max = 9999, suffix }: { value: number; onChange: (v: number) => void; min?: number; max?: number; suffix?: string }) {
  const clamp = (v: number) => Math.min(max, Math.max(min, Math.floor(v) || 0));
  return (
    <div className="stepper">
      <button type="button" aria-label="Decrease" onClick={() => onChange(clamp(value - 1))} disabled={value <= min}>−</button>
      <input type="number" value={value} min={min} max={max} onChange={(e) => onChange(clamp(Number(e.target.value)))} />
      <button type="button" aria-label="Increase" onClick={() => onChange(clamp(value + 1))} disabled={value >= max}>+</button>
      {suffix && <span className="muted small">{suffix}</span>}
    </div>
  );
}

/** Small photo picker for an option / flavour row. */
function VariantPhoto({ userId, itemId, row, onPick }: { userId: string; itemId?: string; row: { id?: string; has_image?: boolean; image?: Blob | null }; onPick: (b: Blob) => void }) {
  const [local, setLocal] = useState<string | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => () => { if (local) URL.revokeObjectURL(local); }, [local]);
  const src = local ?? (row.has_image && row.id && itemId && !err ? variantImageURL(userId, itemId, { id: row.id }) : null);
  return (
    <label className="variant-photo" title="Add a photo for this option">
      {src ? <img src={src} alt="" onError={() => setErr(true)} /> : <span aria-hidden>＋</span>}
      <input type="file" accept="image/*" hidden onChange={async (e) => {
        const f = e.target.files?.[0];
        if (!f) return;
        try { const b = await compressImage(f); onPick(b); setLocal(URL.createObjectURL(b)); } catch { /* unreadable image */ }
      }} />
    </label>
  );
}

const ic = (d: string) => <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>;
const KIND_ICONS: Record<string, ReactNode> = {
  ready_now: ic('M12 3v3M5.6 5.6l2.1 2.1M3 12h3M18.4 5.6l-2.1 2.1M21 12h-3M7 17a5 5 0 0 1 10 0M3 21h18'),
  preorder: ic('M4 5h16v15H4zM4 10h16M8 3v4M16 3v4M9 15l2 2 4-4'),
  custom: ic('M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z'),
  physical: ic('M21 8 12 3 3 8v8l9 5 9-5zM3 8l9 5 9-5M12 13v8'),
  digital: ic('M12 3v12M7 10l5 5 5-5M5 21h14'),
  form: ic('M9 4h6a1 1 0 0 1 1 1v1H8V5a1 1 0 0 1 1-1zM8 6H6a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1h-2M9 12h6M9 16h4'),
};
