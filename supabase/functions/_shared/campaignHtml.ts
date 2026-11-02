// Custom-HTML campaign emails (Harvey 2026-11-02): a vendor can write the
// whole email body as HTML instead of plain text + one button.
//
// Email apps don't run scripts, so the risk here isn't to Bakeri's site —
// it's broken or abusive mail going out under the vendor's name from our
// sending domain. So before sending we strip what has no place in an email
// (scripts, frames, forms, event handlers, javascript: links, refresh/base
// tags), keep ordinary email HTML (tables, inline styles, <style>, images,
// links), and always add our own unsubscribe footer and open pixel. Every
// http(s) link is routed through campaign-track for click counting; the
// tracker only redirects to the list saved on the campaign at send time.

export const MAX_HTML_LENGTH = 100_000; // Gmail clips messages over ~102 KB.

const BLOCK_TAGS = ["script", "iframe", "object", "embed", "applet", "form", "frameset", "noscript", "select", "textarea", "button", "svg", "math"];
const VOID_TAGS = ["script", "iframe", "object", "embed", "applet", "form", "frame", "frameset", "base", "meta", "link", "input", "select", "textarea", "button", "noscript", "svg", "math"];

export function sanitizeEmailHtml(html: string): string {
  let s = html;
  // Event handlers and srcdoc, in any quoting.
  s = s.replace(/\s+(?:on[a-z]+|srcdoc|formaction)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  // Script-ish URLs in href/src/background/action (data: only for images).
  s = s.replace(/\s(href|src|background|action|xlink:href)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi, (m, attr, _q, dq, sq, bare) => {
    const v = String(dq ?? sq ?? bare ?? "").replace(/&#x?[0-9a-f]+;?/gi, "").replace(/[\s\u0000-\u001f]/g, "").toLowerCase();
    const bad = v.startsWith("javascript:") || v.startsWith("vbscript:") ||
      (v.startsWith("data:") && !(attr.toLowerCase() === "src" && v.startsWith("data:image/")));
    return bad ? ` ${attr}="#"` : m;
  });
  // CSS expressions / javascript: in inline styles.
  s = s.replace(/expression\s*\(/gi, "(").replace(/url\s*\(\s*['"]?\s*javascript:[^)]*\)/gi, "none");
  // Then the elements themselves — after attributes, so a "<script" inside
  // an attribute value can't swallow the markup that follows it.
  // Whole elements with their contents.
  for (const t of BLOCK_TAGS) {
    s = s.replace(new RegExp(`<${t}\\b[\\s\\S]*?<\\/${t}\\s*>`, "gi"), "");
  }
  // Any leftover opening/closing/self-closing tags of those kinds.
  s = s.replace(new RegExp(`<\\/?(?:${VOID_TAGS.join("|")})\\b[^>]*>`, "gi"), "");
  return s;
}

const HREF_RE = /(<a\b[^>]*?\shref\s*=\s*)("([^"]*)"|'([^']*)')/gi;

function decodeHref(v: string): string {
  return v.replace(/&amp;/g, "&").trim();
}

/** Every distinct http(s) link in the email, in order of first appearance. */
export function collectLinks(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(HREF_RE)) {
    const url = decodeHref(m[3] ?? m[4] ?? "");
    if (/^https?:\/\//i.test(url) && !out.includes(url)) out.push(url);
  }
  return out;
}

/** Point each http(s) link at its tracking URL (by its index in `links`). */
export function trackLinks(html: string, links: string[], trackUrl: (index: number) => string): string {
  return html.replace(HREF_RE, (whole, pre, _q, dq, sq) => {
    const i = links.indexOf(decodeHref(dq ?? sq ?? ""));
    return i < 0 ? whole : `${pre}"${trackUrl(i).replace(/&/g, "&amp;")}"`;
  });
}

/** The vendor's HTML plus our unsubscribe footer and (optionally) the open pixel. */
export function wrapCustomHtml(html: string, unsubscribeUrl: string, openPixelUrl: string | null): string {
  const footer = `
    <div style="font-family:-apple-system,sans-serif;max-width:600px;margin:24px auto 0;padding:14px 24px 28px;border-top:1px solid #E4D9C8;">
      <p style="color:#A89B8C;font-size:11.5px;line-height:1.5;margin:0;">
        You're receiving this because you're on this baker's mailing list.
        <a href="${unsubscribeUrl}" style="color:#A89B8C;">Unsubscribe</a>
      </p>
      ${openPixelUrl ? `<img src="${openPixelUrl}" width="1" height="1" alt="" style="display:block;border:0;width:1px;height:1px;" />` : ""}
    </div>`;
  return /<\/body\s*>/i.test(html) ? html.replace(/<\/body\s*>/i, `${footer}</body>`) : `${html}${footer}`;
}
