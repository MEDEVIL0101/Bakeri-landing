import { callFunction, ApiError } from './api';
import { compressImage } from './menu';
import { DENSITY_SEED } from './densitySeed';

// Recipe extraction through the claude-api-proxy edge function — the same
// prompt and model as iOS RecipeAIService, plus a text-paste variant.

export interface ImportedRecipe {
  name: string;
  yield_quantity?: number;
  yield_unit?: string;
  prep_time_minutes?: number;
  bake_time_minutes?: number;
  instructions: string;
  notes: string;
  tags: string[];
  ingredients: { name: string; amount: number; unit: string; grams_per_cup: number }[];
}

const SCHEMA = `{
  "name": "string",
  "yield_quantity": number,
  "yield_unit": "servings|cookies|cupcakes|muffins|loaves|bars|brownies|cakes|pies|pieces|dozen",
  "prep_time_minutes": number,
  "bake_time_minutes": number,
  "instructions": "Step 1: ...\\nStep 2: ...\\nStep 3: ...",
  "notes": "string",
  "tags": ["string"],
  "ingredients": [{"name": "string", "amount": number, "unit": "cup|tbsp|tsp|pinch|g|kg|fl oz|ml|L|none"}]
}`;

const RULES = `Rules:
- "instructions": transcribe every step in full, one per line, separated by \\n. Do NOT number the steps — write plain text only (no "Step 1:", "1.", bullets, etc.).
- Ingredient "name" should be the base ingredient only — omit preparation words. Examples: "nutmeg" (not "freshly grated nutmeg"), "butter" (not "cold unsalted butter").
- Use the exact sugar type written in the recipe. If it says "sugar", use "sugar". Only use "brown sugar", "caster sugar", "icing sugar", etc. if the recipe explicitly says so.
- Use "pinch" as the unit when the recipe calls for a pinch of something.
- Return only the JSON object — no markdown fences, no explanation.`;

const UNITS = new Set(['cup', 'tbsp', 'tsp', 'pinch', 'g', 'kg', 'lb', 'fl oz', 'ml', 'L', 'none', 'pt', 'qt']);

async function blobToBase64(b: Blob): Promise<string> {
  const buf = new Uint8Array(await b.arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
}

export async function extractRecipe(input: { text?: string; photos?: File[] }): Promise<ImportedRecipe> {
  const content: any[] = [];
  for (const f of input.photos ?? []) {
    const jpeg = await compressImage(f, 1568, 0.8);
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: await blobToBase64(jpeg) } });
  }
  const lead = input.photos?.length
    ? 'Extract the complete recipe from the image(s) above'
    : `Extract the complete recipe from this text:\n\n"""\n${(input.text ?? '').slice(0, 20000)}\n"""\n\nReturn it`;
  content.push({ type: 'text', text: `${lead} and return ONLY valid JSON (omit any field you cannot determine):\n${SCHEMA}\n${RULES}` });

  const res = await callFunction<any>('claude-api-proxy', { model: 'claude-sonnet-4-6', max_tokens: 2048, messages: [{ role: 'user', content }] });
  const text: string | undefined = res?.content?.[0]?.text;
  if (!text) throw new ApiError('Couldn’t read a recipe from that. Try a clearer photo or paste the text.');
  let json: any;
  try { json = JSON.parse(text.replace(/```json|```/g, '').trim()); } catch { throw new ApiError('Couldn’t read a recipe from that. Try a clearer photo or paste the text.'); }
  return normalise(json);
}

function normalise(j: any): ImportedRecipe {
  const densities = new Map(DENSITY_SEED.map(([n, g]) => [n.toLowerCase(), g]));
  return {
    name: String(j.name ?? ''),
    yield_quantity: typeof j.yield_quantity === 'number' ? j.yield_quantity : undefined,
    yield_unit: typeof j.yield_unit === 'string' ? j.yield_unit : undefined,
    prep_time_minutes: typeof j.prep_time_minutes === 'number' ? Math.round(j.prep_time_minutes) : undefined,
    bake_time_minutes: typeof j.bake_time_minutes === 'number' ? Math.round(j.bake_time_minutes) : undefined,
    instructions: String(j.instructions ?? '').split('\n').map((l) => l.trim().replace(/^([Ss]tep\s+)?\d+\s*[:\-.)]\s*/, '')).filter(Boolean).join('\n'),
    notes: String(j.notes ?? ''),
    tags: Array.isArray(j.tags) ? j.tags.map(String) : [],
    ingredients: (Array.isArray(j.ingredients) ? j.ingredients : []).map((i: any) => ({
      name: String(i.name ?? ''),
      amount: Number(i.amount) || 0,
      unit: UNITS.has(i.unit) ? i.unit : 'none',
      grams_per_cup: densityFor(String(i.name ?? ''), densities),
    })).filter((i: { name: string }) => i.name.trim()),
  };
}

/** Best density match by name (exact, then contains), defaulting to 120 g/cup like iOS. */
export function densityFor(name: string, densities = new Map(DENSITY_SEED.map(([n, g]) => [n.toLowerCase(), g]))): number {
  const k = name.trim().toLowerCase();
  if (!k) return 120;
  if (densities.has(k)) return densities.get(k)!;
  // "unsalted butter" → longest seed name inside it ("butter"); otherwise
  // "sugar" → the shortest seed name containing it ("granulated sugar").
  let inside: [string, number] | null = null;
  let around: [string, number] | null = null;
  for (const [n, g] of densities) {
    if (k.includes(n) && (!inside || n.length > inside[0].length)) inside = [n, g];
    if (n.includes(k) && (!around || n.length < around[0].length)) around = [n, g];
  }
  return (inside ?? around)?.[1] ?? 120;
}
