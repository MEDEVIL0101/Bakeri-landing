import { supabase } from './supabase';
import { check } from './api';
import { newId, nowISO } from './format';

// Mirrors iOS IntakeFormModels.swift / IntakeFormService.swift.

export type FieldType =
  | 'heading' | 'short_text' | 'long_text' | 'number' | 'single_choice' | 'multi_choice'
  | 'date' | 'time' | 'photo' | 'product_selector' | 'notice' | 'agreement';

export const FIELD_TYPES: { type: FieldType; label: string; hint: string }[] = [
  { type: 'short_text', label: 'Short text', hint: 'A name, flavour, or one-line answer' },
  { type: 'long_text', label: 'Paragraph', hint: 'Room for details' },
  { type: 'number', label: 'Number', hint: 'Servings, quantity, tiers' },
  { type: 'single_choice', label: 'Single choice', hint: 'Pick one option' },
  { type: 'multi_choice', label: 'Multiple choice', hint: 'Pick any options' },
  { type: 'date', label: 'Date', hint: 'Event or pickup date' },
  { type: 'time', label: 'Time', hint: 'Pickup or delivery time' },
  { type: 'photo', label: 'Photo', hint: 'Inspiration pictures' },
  { type: 'product_selector', label: 'Item picker', hint: 'Priced items with quantities' },
  { type: 'heading', label: 'Section title', hint: 'Breaks the form into sections' },
  { type: 'notice', label: 'Policy / notice', hint: 'Text buyers read, no answer' },
  { type: 'agreement', label: 'Agreement checkbox', hint: 'Buyer must tick to continue' },
];

export const fieldTypeLabel = (t: FieldType) => FIELD_TYPES.find((f) => f.type === t)?.label ?? t;
export const isAnswerField = (t: FieldType) => t !== 'heading' && t !== 'notice';
export const isTriggerType = (t: FieldType) => t === 'single_choice' || t === 'multi_choice' || t === 'product_selector';

/** Swift Codable keys (camelCase) — stored as-is in intake_form_fields.product_options. */
export interface ProductOption {
  id: string;
  sourceMenuItemID?: string | null;
  name: string;
  price: number;
  maxQuantity: number;
}

export interface FormField {
  id: string;
  field_type: FieldType;
  label: string;
  help_text: string | null;
  is_required: boolean;
  options: string[];
  product_options: ProductOption[];
  condition_field_id: string | null;
  condition_values: string[];
}

export interface IntakeFormFull {
  id: string;
  title: string;
  updated_at: string;
  fields: FormField[];
}

/** Swift UUID().uuidString is uppercase; product option ids are compared as strings in conditions. */
export const swiftUUID = () => newId().toUpperCase();

export function blankField(type: FieldType): FormField {
  return {
    id: newId(), field_type: type, label: '', help_text: null, is_required: isAnswerField(type),
    options: type === 'single_choice' || type === 'multi_choice' ? ['', ''] : [],
    product_options: [], condition_field_id: null, condition_values: [],
  };
}

/** iOS defaultStarterFields — contact details are collected by the storefront itself. */
export function starterFields(): FormField[] {
  return [
    { ...blankField('date'), label: 'Delivery Date', is_required: true },
    { ...blankField('single_choice'), label: 'Time of Day', is_required: true, options: ['Morning', 'Afternoon', 'Evening'] },
  ];
}

const FIELD_COLS = 'id, form_id, position, field_type, label, help_text, is_required, options, product_options, condition_field_id, condition_values';

export async function listForms(userId: string): Promise<IntakeFormFull[]> {
  const forms = check(await supabase.from('intake_forms').select('id, title, updated_at').eq('user_id', userId).order('updated_at', { ascending: false })) as { id: string; title: string; updated_at: string }[];
  if (!forms.length) return [];
  const fields = check(await supabase.from('intake_form_fields').select(FIELD_COLS).in('form_id', forms.map((f) => f.id)).order('position')) as (FormField & { form_id: string })[];
  return forms.map((f) => ({ ...f, fields: fields.filter((x) => x.form_id === f.id).map(normalise) }));
}

export async function getForm(id: string): Promise<IntakeFormFull | null> {
  const forms = check(await supabase.from('intake_forms').select('id, title, updated_at').eq('id', id).limit(1)) as { id: string; title: string; updated_at: string }[];
  if (!forms.length) return null;
  const fields = check(await supabase.from('intake_form_fields').select(FIELD_COLS).eq('form_id', id).order('position')) as FormField[];
  return { ...forms[0], fields: fields.map(normalise) };
}

function normalise(f: any): FormField {
  return {
    id: f.id, field_type: f.field_type, label: f.label ?? '', help_text: f.help_text ?? null, is_required: !!f.is_required,
    options: f.options ?? [], product_options: f.product_options ?? [], condition_field_id: f.condition_field_id ?? null,
    condition_values: f.condition_values ?? [],
  };
}

/** Same as IntakeFormService.saveForm: upsert the form, then replace its fields. */
export async function saveForm(userId: string, form: { id: string; title: string; fields: FormField[] }): Promise<void> {
  const ts = nowISO();
  check(await supabase.from('intake_forms').upsert({ id: form.id, user_id: userId, title: form.title.trim(), updated_at: ts }, { onConflict: 'id' }));
  check(await supabase.from('intake_form_fields').delete().eq('form_id', form.id));
  const ids = new Set(form.fields.map((f) => f.id));
  if (form.fields.length) {
    check(await supabase.from('intake_form_fields').insert(form.fields.map((f, i) => ({
      id: f.id,
      form_id: form.id,
      field_type: f.field_type,
      label: f.label.trim(),
      help_text: f.help_text?.trim() || null,
      is_required: isAnswerField(f.field_type) ? f.is_required : false,
      position: i,
      options: f.field_type === 'single_choice' || f.field_type === 'multi_choice' ? f.options.map((o) => o.trim()).filter(Boolean) : [],
      product_options: f.field_type === 'product_selector' ? f.product_options.filter((p) => p.name.trim()) : [],
      // A condition pointing at a deleted field would hide this one forever.
      condition_field_id: f.condition_field_id && ids.has(f.condition_field_id) ? f.condition_field_id : null,
      condition_values: f.condition_field_id && ids.has(f.condition_field_id) ? f.condition_values : [],
    }))));
  }
}

export async function deleteForm(id: string): Promise<void> {
  check(await supabase.from('intake_forms').delete().eq('id', id));
}

/** Listings that use each form, so the vendor knows what a form is attached to. */
export async function formUsage(userId: string): Promise<Record<string, string[]>> {
  const rows = check(await supabase.from('menu_items').select('name, intake_form_id').eq('user_id', userId).is('deleted_at', null).not('intake_form_id', 'is', null)) as { name: string; intake_form_id: string }[];
  const out: Record<string, string[]> = {};
  for (const r of rows) (out[r.intake_form_id.toLowerCase()] ??= []).push(r.name);
  return out;
}
