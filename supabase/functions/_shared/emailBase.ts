// Bakerï's base email style (Harvey 2026-11-11): the look of the founder
// update email "A note from Harvey at Bakerï" (2026-11-02). Every new
// Bakerï email should build on bakeriEmailHtml instead of hand-rolling HTML.
//
//   Page #f3ecdd · wordmark on top (assets/site-v3/bakeri-wordmark.png, 152px)
//   White card, 20px radius, 6px colour bar #B24FE8 / #00BCD4 / #E91E63
//   Body 16px/1.7 Helvetica Neue, text #3d353f, headings + emphasis #14110e
//   Eyebrow 12px caps #8a3fc0 · muted/footnotes #8a7f88
//   Primary button: black (#14110e) pill, white 15px bold; secondary: 2px black outline pill
//   Sign-off: "Warmly, Harvey / Co-founder, Bakerï" or "The Bakerï team"
// Reference render: emails/base-style.html (repo root).

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const FONT = "'Helvetica Neue',Helvetica,Arial,sans-serif";

/**
 * paragraphs: already-escaped HTML strings.
 * signoff: "harvey" signs as Harvey, co-founder; otherwise "The Bakerï team".
 */
export function bakeriEmailHtml(opts: {
  eyebrow?: string;
  heading?: string;
  greeting?: string;
  paragraphs: string[];
  button?: { label: string; url: string };
  footnote?: string;
  preheader?: string;
  signoff?: "harvey" | "team";
}): string {
  const ps = opts.paragraphs.map((p) => `<p style="margin:0 0 20px;">${p}</p>`).join("\n");
  const heading = opts.heading
    ? `<h1 class="h1" style="margin:0 0 20px;font-size:28px;line-height:1.25;font-weight:800;color:#14110e;">${escapeHtml(opts.heading)}</h1>`
    : "";
  const greeting = opts.greeting ? `<p style="margin:0 0 20px;">${opts.greeting}</p>` : "";
  const btn = opts.button
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" style="padding:8px 0 28px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" style="background-color:#14110e;border-radius:999px;">
<a href="${escapeHtml(opts.button.url)}" style="display:inline-block;padding:15px 34px;font-family:${FONT};font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:999px;">${escapeHtml(opts.button.label)}</a>
</td></tr></table></td></tr></table>`
    : "";
  const foot = opts.footnote
    ? `<p style="margin:0 0 24px;font-size:13.5px;line-height:1.65;color:#8a7f88;">${opts.footnote}</p>`
    : "";
  const sign = opts.signoff === "harvey"
    ? `<p style="margin:0;">Warmly,</p>
<p style="margin:2px 0 0;font-size:16px;font-weight:700;color:#14110e;">Harvey</p>
<p style="margin:0 0 40px;font-size:14px;color:#8a7f88;">Co-founder, Bakerï</p>`
    : `<p style="margin:0 0 40px;font-weight:700;color:#14110e;">The Bakerï team</p>`;
  const pre = opts.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(opts.preheader)}</div>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="x-apple-disable-message-reformatting" />
<style>@media (max-width: 520px) { .px { padding-left: 24px !important; padding-right: 24px !important; } .h1 { font-size: 24px !important; } }</style>
</head>
<body style="margin:0;padding:0;background-color:#f3ecdd;">
${pre}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f3ecdd;">
<tr><td align="center" style="padding:32px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">
<tr><td align="center" style="padding:8px 0 24px;">
<a href="https://bakeriapp.com" style="text-decoration:none;"><img src="https://bakeriapp.com/assets/site-v3/bakeri-wordmark.png" width="152" height="38" alt="Bakerï" style="display:block;width:152px;height:auto;border:0;" /></a>
</td></tr>
<tr><td style="background-color:#ffffff;border-radius:20px;overflow:hidden;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td height="6" style="height:6px;line-height:6px;font-size:0;background-color:#B24FE8;width:34%;">&nbsp;</td>
<td height="6" style="height:6px;line-height:6px;font-size:0;background-color:#00BCD4;width:33%;">&nbsp;</td>
<td height="6" style="height:6px;line-height:6px;font-size:0;background-color:#E91E63;width:33%;">&nbsp;</td>
</tr></table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td class="px" style="padding:40px 48px 8px;font-family:${FONT};color:#3d353f;font-size:16px;line-height:1.7;">
${opts.eyebrow ? `<p style="margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#8a3fc0;">${escapeHtml(opts.eyebrow)}</p>` : ""}
${heading}
${greeting}
${ps}
${btn}
${foot}
${sign}
</td></tr></table>
</td></tr>
<tr><td align="center" style="padding:24px 24px 8px;font-family:${FONT};font-size:12px;line-height:1.7;color:#8a7f88;">
Bakerï · <a href="https://bakeriapp.com" style="color:#8a7f88;">bakeriapp.com</a><br />
Find us at <a href="https://instagram.com/joinbakeri" style="color:#8a7f88;">@joinbakeri</a> on Instagram.
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

