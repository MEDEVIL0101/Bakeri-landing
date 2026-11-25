// Storefront share card — the 1200×630 image link previews show (Messages,
// Instagram, Facebook, Slack…) for bakeriapp.com/<slug>. Drawn on request from
// the shop's live data, in the pitch-demo card style (Harvey 2026-11-25): the
// shop's photo on the left; logo, name in her heading font, bio and a
// "Shop online · Bakerï" pill on the right, in her colours.
//
// GET ?slug=<profile_slug>[&v=<publish stamp>]   (public — verify_jwt off)
// scripts/generate-storefront-pages.mjs points each page's og:image here, with
// v = the profile's updated_at so a redesign is a new image URL.
//
// Same choices as baker/next.html: colour = storefront_design.colors.accent,
// else the theme's primary; photo = background image, else the header photo,
// else a product photo; heading font = title_font, else display_font.
import { ImageResponse } from "https://deno.land/x/og_edge@0.0.6/mod.ts";
import React from "https://esm.sh/react@18.2.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const STORAGE = `${SUPABASE_URL}/storage/v1/object/public`;
const FALLBACK = "https://bakeriapp.com/1024.png";

// baker/theme.js — light primary + background per theme.
const THEMES: Record<string, [string, string]> = {
  Classic: ["#1C1C1E", "#FAF6EE"], Macaron: ["#D966B0", "#FDFAF0"], Birthday: ["#5AAEE0", "#FFF4F8"],
  Tart: ["#7E8435", "#F8F4EC"], Sprinkle: ["#F72967", "#F7F2FC"], Ember: ["#AE0001", "#FBF1E9"],
  Sage: ["#2A623D", "#F2F6F1"], Blueberry: ["#222F5B", "#EEF1F8"], Honey: ["#ECB939", "#FBF5E7"],
  Fall: ["#BF3E0F", "#FDF1E7"],
};
// baker/next.html DISPLAY_FONTS — Google font name → weight the page uses.
const FONT_WEIGHTS: Record<string, number> = {
  "Archivo": 800, "Shrikhand": 400, "Cormorant Garamond": 700, "Fraunces": 700, "Playfair Display": 700,
  "DM Serif Display": 400, "Abril Fatface": 400, "Lilita One": 400, "Pacifico": 400, "Baloo 2": 800,
  "EB Garamond": 500, "Libre Baskerville": 400, "Bodoni Moda": 600, "Lora": 600, "Yeseva One": 400,
  "Gloock": 400, "Montserrat": 700, "Poppins": 700, "Josefin Sans": 600, "Quicksand": 700, "Fredoka": 600,
  "Chewy": 400, "Righteous": 400, "Bungee": 400, "Cherry Bomb One": 400,
};

const hex = (v: unknown) => (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v.trim()) ? v.trim() : null);
function luminance(h: string) {
  const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((x) => (x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const readableOn = (bg: string) => (luminance(bg) > 0.45 ? "#201E1D" : "#FFFFFF");
function truncate(s: string, n: number) {
  s = s.replace(/\s+/g, " ").trim();
  return s.length <= n ? s : s.slice(0, n - 1).replace(/\s+\S*$/, "") + "…";
}

const fontCache = new Map<string, ArrayBuffer | null>();
/** A Google font as TTF (satori can't read woff2; Google sends TTF to this client). */
async function googleFont(family: string, weight: number): Promise<ArrayBuffer | null> {
  const key = `${family}:${weight}`;
  if (fontCache.has(key)) return fontCache.get(key)!;
  let data: ArrayBuffer | null = null;
  try {
    const css = await (await fetch(`https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@${weight}`)).text();
    const url = css.match(/src:\s*url\(([^)]+)\)\s*format\('(?:truetype|opentype)'\)/)?.[1];
    if (url) data = await (await fetch(url)).arrayBuffer();
  } catch { data = null; }
  fontCache.set(key, data);
  return data;
}

async function exists(url: string) {
  try { return (await fetch(url, { method: "HEAD" })).ok; } catch { return false; }
}

Deno.serve(async (req) => {
  try {
    const slug = (new URL(req.url).searchParams.get("slug") || "").trim().toLowerCase();
    if (!/^[a-z0-9-]{1,80}$/.test(slug)) return Response.redirect(FALLBACK, 302);
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_baker_web_profile_by_slug`, {
      method: "POST",
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_slug: slug }),
    });
    const data = r.ok ? await r.json() : null;
    const p = data?.profile;
    if (!p) return Response.redirect(FALLBACK, 302);

    const design = (p.storefront_design && typeof p.storefront_design === "object") ? p.storefront_design : {};
    const theme = THEMES[p.selected_theme] || THEMES.Classic;
    const accent = hex(design.colors?.accent) || theme[0];
    const bg = hex(design.background?.color) || theme[1];
    const nameColor = luminance(accent) > 0.45 ? "#201E1D" : accent;
    const name = String(p.business_name || p.user_name || "Bakerï shop").trim();
    const tagline = truncate(String(p.bio || p.about_story || `Order online from ${name}.`), 120);
    const id = String(p.id).toUpperCase();
    const v = p.updated_at ? `?v=${Date.parse(p.updated_at)}` : "";

    // Photo: background image → header photo → a product photo.
    const bgImg = design.background?.mode !== "theme" && typeof design.background?.image_url === "string" &&
      /^https:\/\//.test(design.background.image_url) && !/\.webp(\?|$)/i.test(design.background.image_url)
      ? design.background.image_url : null;
    const header = `${STORAGE}/storefront-headers/${id}/header.jpg`;
    const product = (data.listings || []).find((l: { image_v?: number | null }) => l.image_v);
    const photo = bgImg || ((await exists(header)) ? header + v : null) ||
      (product ? `${STORAGE}/menu-item-images/${id}/${String(product.id).toUpperCase()}.jpg?v=${product.image_v}` : null);
    const logo = `${STORAGE}/business-logos/${id}/logo.jpg`;
    const avatar = (await exists(logo)) ? logo + v : null;

    const fontName = FONT_WEIGHTS[design.title_font] ? design.title_font : FONT_WEIGHTS[design.display_font] ? design.display_font : "Archivo";
    const [display, body, bold] = await Promise.all([
      googleFont(fontName, FONT_WEIGHTS[fontName]), googleFont("Archivo", 500), googleFont("Archivo", 800),
    ]);
    const fonts = [
      display && { name: "Display", data: display, weight: FONT_WEIGHTS[fontName], style: "normal" },
      body && { name: "Body", data: body, weight: 500, style: "normal" },
      bold && { name: "Body", data: bold, weight: 800, style: "normal" },
    ].filter(Boolean);
    const h = React.createElement;
    const nameSize = name.length > 26 ? 46 : name.length > 18 ? 52 : 58;

    const card = h("div", { style: { display: "flex", width: 1200, height: 630, background: bg } },
      photo
        ? h("img", { src: photo, width: 640, height: 630, style: { width: 640, height: 630, objectFit: "cover" } })
        : h("div", { style: { width: 640, height: 630, background: accent, display: "flex", alignItems: "center", justifyContent: "center",
            color: readableOn(accent), fontFamily: "Display", fontSize: 220 } }, name.charAt(0).toUpperCase()),
      h("div", { style: { display: "flex", flexDirection: "column", justifyContent: "center", flex: 1, padding: "0 56px", gap: 24 } },
        avatar
          ? h("img", { src: avatar, width: 132, height: 132, style: { width: 132, height: 132, borderRadius: 66, objectFit: "cover",
              border: "6px solid #FFFFFF", boxShadow: "0 6px 18px rgba(0,0,0,.12)" } })
          : h("div", { style: { width: 132, height: 132, borderRadius: 66, background: accent, color: readableOn(accent), display: "flex",
              alignItems: "center", justifyContent: "center", fontFamily: "Display", fontSize: 64, border: "6px solid #FFFFFF" } },
              name.charAt(0).toUpperCase()),
        h("div", { style: { fontFamily: "Display", fontSize: nameSize, lineHeight: 1.05, color: nameColor, display: "flex" } }, name),
        h("div", { style: { fontFamily: "Body", fontWeight: 500, fontSize: 25, lineHeight: 1.35, color: "#4A4440", display: "flex" } }, tagline),
        h("div", { style: { display: "flex", alignSelf: "flex-start", fontFamily: "Body", fontWeight: 800, fontSize: 21,
          color: readableOn(accent), background: accent, padding: "13px 24px", borderRadius: 999 } }, "Shop online · Bakerï"),
      ),
    );
    return new ImageResponse(card, {
      width: 1200, height: 630, fonts,
      headers: { "Cache-Control": "public, max-age=86400, s-maxage=604800" },
    });
  } catch (e) {
    console.error("share card:", e instanceof Error ? e.message : e);
    return Response.redirect(FALLBACK, 302);
  }
});
