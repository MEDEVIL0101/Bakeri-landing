import { callFunction } from './api';
import { newId } from './format';
import { FIELD_TYPES, isTriggerType, type FieldType, type FormField } from './forms';

// Google Forms / JotForm import — the import-external-form edge function
// fetches the public form page and has Claude convert it (a browser can't
// fetch those pages itself). This file turns Claude's JSON into builder
// fields, mirroring iOS FormImportAI.parse.

export type ImportSource = 'google' | 'jotform';

export const IMPORT_SOURCES: Record<ImportSource, { name: string; placeholder: string; description: string }> = {
  google: {
    name: 'Google Form',
    placeholder: 'https://docs.google.com/forms/d/e/…/viewform',
    description: 'Paste the link to your Google Form. Its link sharing needs to be set to "Anyone with the link". Your questions come in ready to review — nothing is saved until you tap Save.',
  },
  jotform: {
    name: 'JotForm',
    placeholder: 'https://form.jotform.com/…',
    description: "Paste the link to your JotForm. It needs to be public (not password- or login-protected). Your questions come in ready to review — nothing is saved until you tap Save.",
  },
};

export interface ImportedForm {
  title: string;
  description: string;
  fields: FormField[];
}

const VALID_TYPES = new Set<string>(FIELD_TYPES.map((f) => f.type));

export async function importExternalForm(source: ImportSource, url: string): Promise<ImportedForm> {
  const raw = await callFunction<any>('import-external-form', { source, url });
  return parseImport(raw);
}

function parseImport(json: any): ImportedForm {
  const title = typeof json?.title === 'string' ? json.title : '';
  const description = typeof json?.description === 'string' ? json.description.trim() : '';
  const rawFields: any[] = Array.isArray(json?.fields) ? json.fields : [];

  const built: { raw: any; field: FormField }[] = [];
  for (const raw of rawFields) {
    const label = typeof raw?.label === 'string' ? raw.label.trim() : '';
    if (!label || !VALID_TYPES.has(raw?.type)) continue;
    let type = raw.type as FieldType;
    let options: string[] = Array.isArray(raw.options)
      ? raw.options.filter((o: unknown) => typeof o === 'string' && o.trim())
      : [];
    // A choice field needs 2+ options to be usable — fall back to short text.
    if ((type === 'single_choice' || type === 'multi_choice') && options.length < 2) {
      type = 'short_text';
      options = [];
    }
    if (type !== 'single_choice' && type !== 'multi_choice') options = [];
    built.push({
      raw,
      field: {
        id: newId(), field_type: type, label,
        help_text: typeof raw.help_text === 'string' && raw.help_text.trim() ? raw.help_text : null,
        is_required: raw.required === true && type !== 'heading' && type !== 'notice',
        options, product_options: [], condition_field_id: null, condition_values: [],
      },
    });
  }

  // Second pass: condition_trigger_label names an EARLIER choice field by its
  // label; only that field's own options (case-insensitive) are accepted.
  built.forEach((entry, i) => {
    const triggerLabel = typeof entry.raw.condition_trigger_label === 'string' ? entry.raw.condition_trigger_label.trim() : '';
    if (!triggerLabel) return;
    const trigger = built.slice(0, i).map((b) => b.field).reverse().find((f) =>
      isTriggerType(f.field_type) && f.field_type !== 'product_selector'
        && f.label.trim().toLowerCase() === triggerLabel.toLowerCase());
    if (!trigger) return;
    const rawValues: string[] = Array.isArray(entry.raw.condition_values) ? entry.raw.condition_values : [];
    const values = rawValues
      .map((v) => trigger.options.find((o) => typeof v === 'string' && o.toLowerCase() === v.toLowerCase()))
      .filter((v): v is string => !!v);
    if (!values.length) return;
    entry.field.condition_field_id = trigger.id;
    entry.field.condition_values = values;
  });

  return { title, description, fields: built.map((b) => b.field) };
}
