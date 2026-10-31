import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { giveBackAiUse, limitMessage, takeAiUse } from "../_shared/aiQuota.ts";

// Google Forms / JotForm importer for the vendor web app (bakeriapp.com/app).
// The iOS app does this on-device (GoogleFormImportService /
// JotFormImportService + FormImportAI), but a browser can't fetch another
// site's form page — Google and JotForm send no CORS headers — so the web app
// sends the link here instead. Same steps as iOS: fetch the public form page,
// pull out the question data, have Claude map it to our intake-form schema.
// The prompts below are copied from the Swift services; keep them in sync.
//
// Returns Claude's raw {title, fields[]} — the web app resolves
// condition_trigger_label into real field ids itself (webapp/src/lib/
// formImport.ts), mirroring FormImportAI.parse on iOS.
//
// Signed-in vendors only, and only Google Forms / JotForm hosts are fetched,
// so this can't be used to make the server fetch arbitrary URLs.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;

const MODEL = "claude-sonnet-4-6";
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

class ImportError extends Error {}

type Source = "google" | "jotform";

const SOURCE_NAME: Record<Source, string> = { google: "Google", jotform: "JotForm" };

// MARK: - URL normalization (mirrors the Swift normalize() functions)

function normalize(source: Source, raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new ImportError(source === "google" ? "That doesn't look like a Google Form link." : "That doesn't look like a JotForm link.");
  }
  const host = url.hostname.toLowerCase();
  url.search = "";
  url.hash = "";
  if (source === "google") {
    const isGoogle = host === "docs.google.com" || host === "forms.gle";
    if (url.protocol !== "https:" || !isGoogle) throw new ImportError("That doesn't look like a Google Form link.");
    if (host === "docs.google.com") {
      let path = url.pathname;
      if (path.endsWith("/edit")) path = path.slice(0, -"edit".length) + "viewform";
      else if (!path.endsWith("/viewform")) path = (path.endsWith("/") ? path : path + "/") + "viewform";
      url.pathname = path;
    }
  } else {
    const isJot = host === "jotform.com" || host.endsWith(".jotform.com");
    if (url.protocol !== "https:" || !isJot) throw new ImportError("That doesn't look like a JotForm link.");
  }
  return url;
}

// forms.gle short links redirect to docs.google.com — follow redirects by
// hand so every hop is re-checked against the same host allow-list.
async function fetchHTML(source: Source, url: URL): Promise<string> {
  let current = url;
  for (let hop = 0; hop < 5; hop++) {
    let res: Response;
    try {
      res = await fetch(current, {
        headers: { "User-Agent": BROWSER_UA },
        redirect: "manual",
        signal: AbortSignal.timeout(60_000),
      });
    } catch {
      throw new ImportError(`${SOURCE_NAME[source]} took too long to respond. Check the link and try again.`);
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      const next = new URL(res.headers.get("location")!, current);
      const h = next.hostname.toLowerCase();
      const allowed = source === "google"
        ? h === "docs.google.com" || h === "forms.gle"
        : h === "jotform.com" || h.endsWith(".jotform.com");
      if (!allowed || next.protocol !== "https:") throw new ImportError(notPublicMessage(source));
      current = next;
      continue;
    }
    if (res.status !== 200) throw new ImportError(`Couldn't reach ${SOURCE_NAME[source]} (code ${res.status}).`);
    return await res.text();
  }
  throw new ImportError(notPublicMessage(source));
}

function notPublicMessage(source: Source): string {
  return source === "google"
    ? "Couldn't read that form. Make sure its link sharing is set to \"Anyone with the link\"."
    : "Couldn't read that form. Make sure it's publicly accessible (not password- or login-protected).";
}

// MARK: - Extraction (mirrors the Swift helpers)

function extractGoogleBlob(html: string): string | null {
  const marker = "FB_PUBLIC_LOAD_DATA_ = ";
  const start = html.indexOf(marker);
  if (start < 0) return null;
  const after = html.slice(start + marker.length);
  const end = after.indexOf(";</script>");
  if (end < 0) return null;
  const blob = after.slice(0, end);
  return blob.trim() ? blob.slice(0, 200_000) : null;
}

function extractJotFieldTypeMap(html: string): string | null {
  const marker = "paymentExtrasOnTheFly(";
  const start = html.indexOf(marker);
  if (start < 0) return null;
  const after = html.slice(start + marker.length);
  const end = after.indexOf(");");
  if (end < 0) return null;
  const blob = after.slice(0, end);
  return blob.trim() ? blob.slice(0, 50_000) : null;
}

function stripScriptsAndStyles(html: string): string {
  let result = html;
  for (const tag of ["script", "style", "svg", "noscript"]) {
    result = result.replace(new RegExp(`<${tag}[\\s\\S]*?</${tag}>`, "gi"), "");
    const dangling = result.search(new RegExp(`<${tag}`, "i"));
    if (dangling >= 0) result = result.slice(0, dangling);
  }
  result = result.replace(/<!--[\s\S]*?-->/g, "");
  const danglingComment = result.indexOf("<!--");
  if (danglingComment >= 0) result = result.slice(0, danglingComment);
  result = result.replace(/>[ \t\r\n]+</g, "><");
  return result.slice(0, 300_000);
}

// MARK: - Prompts (copied from GoogleFormImportService / JotFormImportService)

const GOOGLE_PROMPT = "Below is the raw `FB_PUBLIC_LOAD_DATA_` array Google Forms embeds in a public form's page source — an undocumented, unlabelled array-of-arrays structure describing the form's title and every question. Read it and convert it into this JSON shape ONLY:\n\n{\n  \"title\": \"string\",\n  \"fields\": [\n    {\n      \"type\": \"heading|short_text|long_text|number|single_choice|multi_choice|date|time|photo|notice|agreement\",\n      \"label\": \"string\",\n      \"help_text\": \"string or null\",\n      \"required\": boolean,\n      \"options\": [\"string\"],\n      \"condition_trigger_label\": \"string or null\",\n      \"condition_values\": [\"string\"]\n    }\n  ]\n}\n\nRules:\n- Preserve question order exactly as it appears in the source form.\n- A section title / description-only block (no answer collected) becomes \"heading\" with the section's title as \"label\" (required must be false).\n- Google \"Short answer\" -> short_text. \"Paragraph\" -> long_text.\n- \"Multiple choice\" and \"Dropdown\" (pick exactly one) -> single_choice. \"Checkboxes\" (pick any number) -> multi_choice. Put the choice text in \"options\" (omit for other types).\n- \"Linear scale\" -> single_choice with each point turned into a string option (e.g. \"1\", \"2\", \"3\" — include the low/high labels in \"label\" if present, e.g. \"How excited are you? (1 = Not at all, 5 = Very)\").\n- A checkbox/multiple-choice GRID (rows x columns) has no single-field equivalent — emit one single_choice or multi_choice field per ROW, labelled \"<grid title>: <row label>\", with the column labels as \"options\".\n- \"Date\" -> date. \"Time\" -> time (an actual time-of-day picker — never date or short_text, even if the source question is titled something like \"Pickup Time\"). \"File upload\" -> photo.\n- Number-only short-answer questions (validated as a number in the source) -> number.\n- OMIT any question whose only purpose is collecting the respondent's own name, email address, or phone number (e.g. \"Your Name\", \"Full Name\", \"First/Last Name\", \"Email\", \"Contact Email\", \"Phone Number\", \"Best number to reach you\") — every order on this platform already asks for that once, unconditionally, right before this form's own questions, so importing them again would ask the buyer twice. This does NOT apply to someone else's contact info (e.g. \"Recipient's name\" on a gift order, \"Who is this for\") — only the respondent's own identity/contact details are omitted.\n- Also skip Google's own \"Email\" auto-collection question if the form owner didn't add it as a visible question (i.e. it's Forms' built-in respondent-email setting, not a question in the items array) — same reasoning as above.\n- A long paragraph of policy, terms, cancellation, or disclaimer text with NOTHING to answer -> notice (not heading — heading is for short section titles only; notice is for text meant to actually be read in full, however long).\n- A checkbox question with EXACTLY ONE option that reads like a consent/agreement phrase (e.g. \"I agree to the terms above\", \"I understand and accept the cancellation policy\") -> agreement, using that option's text as \"label\" instead of putting it in \"options\" (agreement fields never have an \"options\" array).\n- CONDITIONAL SECTIONS: forms selling multiple kinds of items commonly start with a single/multi-choice question like \"What would you like to order?\" (options: e.g. \"Cookies\", \"Cake\", \"Cupcakes\"), followed by a run of fields for EACH of those options in turn — often introduced by its own heading (e.g. a \"Cookies\" heading, then cookie-specific questions, then a \"Cake\" heading, then cake-specific questions). Whenever you recognize this pattern, set \"condition_trigger_label\" on EVERY field that belongs to one of those per-item sections (the section's own heading included) to the EXACT \"label\" text of that earlier selector question, and \"condition_values\" to the ONE option text (from the selector's own \"options\") that section corresponds to — e.g. every field under the \"Cookies\" heading gets \"condition_trigger_label\": \"What would you like to order?\" and \"condition_values\": [\"Cookies\"]. This makes the buyer only see (and only get required to answer) the section for whatever they actually picked — without it, they'd be forced to fill in every section for every item type regardless of what they're ordering. Leave both fields null/omitted for anything that isn't part of a per-item-type section like this.\n- Return ONLY the JSON object — no markdown fences, no explanation.\n\n";

const JOTFORM_PROMPT = "Below is the server-rendered HTML body of a public JotForm form page (its <script>/<style> tags already stripped). Each question renders as real markup: a <label> with the question text, a wrapping element carrying data-type=\"control_XXX\" identifying the field type, and — for choice questions — each option as its own visible <label> text. Read it and convert it into this JSON shape ONLY:\n\n{\n  \"title\": \"string\",\n  \"fields\": [\n    {\n      \"type\": \"heading|short_text|long_text|number|single_choice|multi_choice|date|time|photo|notice|agreement\",\n      \"label\": \"string\",\n      \"help_text\": \"string or null\",\n      \"required\": boolean,\n      \"options\": [\"string\"],\n      \"condition_trigger_label\": \"string or null\",\n      \"condition_values\": [\"string\"]\n    }\n  ]\n}\n\nJotForm control_type -> our type:\n- control_textbox, control_email (short text-style fields) -> short_text\n- control_textarea -> long_text\n- control_number, control_spinner -> number\n- control_radio, control_dropdown (pick exactly one) -> single_choice. control_checkbox (pick any number) -> multi_choice. Put each visible option's text in \"options\" (omit \"options\" for other types).\n- control_matrix (a grid of rows x columns) has no single-field equivalent — emit one single_choice or multi_choice field per ROW, labelled \"<matrix title>: <row label>\", with the column labels as \"options\".\n- control_datetime -> date. Any field clearly asking for a time of day (not a full date) -> time — an actual time-of-day picker, never date or short_text.\n- control_fileupload, control_image (as an upload prompt, not decorative image) -> photo.\n- control_head -> heading (a short section title, required must be false).\n- control_text: if it's a SHORT instructional line, -> heading. If it's a genuine paragraph of policy, terms, cancellation, storage, or disclaimer text meant to actually be read — however long — -> notice instead (required must be false either way).\n- control_widget whose widget name or visible text mentions terms, conditions, agreement, consent, waiver, or similar (a \"Terms & Conditions\" checkbox widget is the common case) -> agreement. Use a natural agreement phrase as \"label\", e.g. \"I agree to the terms and conditions above\" — derive it from the widget's own text if a specific phrase is visible, otherwise use a generic \"I agree to the terms and conditions above\". Any OTHER control_widget (one that isn't a terms/agreement checkbox) -> short_text.\n- A control_checkbox with EXACTLY ONE option that reads like a consent/agreement phrase (e.g. \"I agree to the terms above\") -> agreement instead of multi_choice, using that option's text as \"label\" (agreement fields never have an \"options\" array).\n- control_pagebreak, control_button, control_divider, purely decorative control_image, hidden fields, and JotForm's own captcha/payment/signature widgets are not real questions — skip them entirely.\n- control_fullname, control_address, control_phone, and any field whose only purpose is collecting the respondent's own name, email address, or phone number (e.g. \"Name\", \"Email\", \"Phone Number\", \"Contact Info\") -> OMIT entirely. Every order on this platform already asks for that once, unconditionally, right before this form's own questions, so importing them again would ask the buyer twice. This does NOT apply to someone else's contact info (e.g. \"Recipient's Name\" on a gift order, \"Who is this for\") — only the respondent's own identity/contact details are omitted.\n- CONDITIONAL SECTIONS: order forms selling multiple kinds of items commonly start with a single/multi-choice question like \"What would you like to order today?\" (options: e.g. \"Cookies\", \"Cake\", \"Cupcakes\", \"Cake Pops\"), followed by a run of fields for EACH of those options in turn — often introduced by its own control_head (e.g. a \"Cookies\" heading, then cookie-specific questions, then a \"Cake\" heading, then cake-specific questions). Whenever you recognize this pattern, set \"condition_trigger_label\" on EVERY field that belongs to one of those per-item sections (the section's own heading included) to the EXACT \"label\" text of that earlier selector question, and \"condition_values\" to the ONE option text (from the selector's own \"options\") that section corresponds to — e.g. every field under the \"Cookies\" heading gets \"condition_trigger_label\": \"What would you like to order today?\" and \"condition_values\": [\"Cookies\"]. This makes the buyer only see (and only get required to answer) the section for whatever they actually picked — without it, they'd be forced to fill in every section for every item type regardless of what they're ordering. Leave both fields null/omitted for anything that isn't part of a per-item-type section like this.\n- Preserve question order exactly as it appears in the source markup.\n- The form's title is usually in a heading near the top of the page (often near class=\"form-header\" or similar) — if you can't find one, use an empty string.\n- Return ONLY the JSON object — no markdown fences, no explanation.\n";

function googlePrompt(blob: string): string {
  return `${GOOGLE_PROMPT}FB_PUBLIC_LOAD_DATA_ = ${blob}`;
}

function jotformPrompt(html: string, fieldTypeMap: string | null): string {
  const mapSection = fieldTypeMap
    ? `\n\nFor cross-reference, here's a compact {qid, text, type} array JotForm's own page generates internally — some fields (especially third-party widgets like a Terms & Conditions checkbox) render through an iframe whose real content isn't in the static markup, so their "type" and visible "text" are only reliably available here:\n\n${fieldTypeMap}`
    : "";
  return `${JOTFORM_PROMPT}${mapSection}\n\n${html}`;
}

// MARK: - Claude

// Claude fills in this tool's input instead of writing free-form JSON text,
// so the reply always comes back as a parsed object — no stray prose, code
// fences or escaping slips. A long form (dippedbyjuliannaa's 41-question
// order form, 2026-10-26) used to fail as "couldn't understand" whenever the
// text reply wasn't clean JSON.
const FORM_TOOL = {
  name: "save_form",
  description: "Save the converted form: its title and every field, in order.",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string" },
      description: { type: "string" },
      fields: {
        type: "array",
        items: {
          type: "object",
          properties: {
            type: {
              type: "string",
              enum: ["heading", "short_text", "long_text", "number", "single_choice", "multi_choice", "date", "time", "photo", "notice", "agreement"],
            },
            label: { type: "string" },
            help_text: { type: ["string", "null"] },
            required: { type: "boolean" },
            options: { type: "array", items: { type: "string" } },
            condition_trigger_label: { type: ["string", "null"] },
            condition_values: { type: "array", items: { type: "string" } },
          },
          required: ["type", "label", "required"],
        },
      },
    },
    required: ["title", "description", "fields"],
  },
};

async function runClaude(prompt: string): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        // Long forms (40+ questions, 150+ options, a condition on most
        // fields) need well over the old 8192.
        max_tokens: 32000,
        tools: [FORM_TOOL],
        tool_choice: { type: "tool", name: FORM_TOOL.name },
        messages: [{
          role: "user",
          content: prompt + "\n\nCall save_form with the result (omit help_text, options, condition_trigger_label and condition_values when they don't apply). " +
            "Put the form's own description — the intro text under the title (Google Forms' form description; on JotForm, the paragraph under the form header) — " +
            "verbatim in \"description\" (empty string if there is none), and don't repeat it as a notice field.",
        }],
      }),
      signal: AbortSignal.timeout(300_000),
    });
  } catch {
    throw new ImportError("This is taking longer than usual to process. Try again — if it keeps happening, this form may just be too large to import automatically.");
  }
  if (!res.ok) {
    console.error("Anthropic error:", res.status, (await res.text()).slice(0, 500));
    throw new ImportError(`Couldn't reach the import service (code ${res.status}).`);
  }
  const body = await res.json();
  if (body?.stop_reason === "max_tokens") {
    console.error("import-external-form: reply cut off at max_tokens", body?.usage);
    throw new ImportError("This form is too large to import in one go. Try splitting it, or rebuild the extra sections by hand.");
  }
  const call = (body?.content ?? []).find((c: { type?: string }) => c?.type === "tool_use");
  const input = call?.input;
  if (!input || !Array.isArray(input.fields)) {
    console.error("import-external-form: no usable tool call", body?.stop_reason, JSON.stringify(body?.content ?? []).slice(0, 500));
    throw new ImportError("Couldn't understand that form's questions. Try rebuilding it by hand instead.");
  }
  return input;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Unauthorized" }, 401);
  const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authErr } = await anonClient.auth.getUser();
  if (authErr || !user) return json({ error: "Unauthorized" }, 401);

  try {
    const body = await req.json().catch(() => ({}));
    const source = body?.source as Source;
    if (source !== "google" && source !== "jotform") return json({ error: "Unknown form source." }, 400);
    const url = normalize(source, String(body?.url ?? ""));
    const html = await fetchHTML(source, url);

    let prompt: string;
    if (source === "google") {
      const blob = extractGoogleBlob(html);
      if (!blob) throw new ImportError(notPublicMessage(source));
      prompt = googlePrompt(blob);
    } else {
      const fieldTypeMap = extractJotFieldTypeMap(html);
      const stripped = stripScriptsAndStyles(html);
      if (!stripped.trim()) throw new ImportError(notPublicMessage(source));
      prompt = jotformPrompt(stripped, fieldTypeMap);
    }

    // Daily limit, taken only once the form loaded — a failed import gives it back.
    const use = await takeAiUse(user.id, "form_import");
    if (!use.ok) return json({ error: limitMessage("form_import") }, 429);
    try {
      return json(await runClaude(prompt));
    } catch (e) {
      await giveBackAiUse(use.id);
      throw e;
    }
  } catch (err) {
    if (err instanceof ImportError) return json({ error: err.message }, 400);
    console.error("import-external-form failed:", err instanceof Error ? err.message : err);
    return json({ error: "Something went wrong importing that form. Please try again." }, 500);
  }
});
