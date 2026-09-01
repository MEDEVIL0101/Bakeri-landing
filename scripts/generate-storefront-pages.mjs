#!/usr/bin/env node
// Pre-generates a real, crawlable HTML page for every baker storefront at
// bakeriapp.com/<slug>.
//
// Why: GitHub Pages has no server-side routing, so bakeriapp.com/<slug> only
// "works" via a client-side JS redirect served under an HTTP 404 (see
// 404.html). Search engines, link-preview bots, and Stripe Connect onboarding
// all see the 404 and generic meta tags — no SEO, no share thumbnails, and
// Stripe rejects the URL as unreachable.
//
// This writes <slug>/index.html for each baker: a real HTTP 200 with per-baker
// <title>, description, Open Graph / Twitter Card tags, canonical URL, and
// JSON-LD Bakery schema, plus a static summary of the storefront (name, bio,
// location, product names/prices) for crawlers to index. A prominent link
// leads to the full interactive store at /baker/?slug=<slug>. No redirect —
// the clean URL keeps its own indexable content.
//
// Run: node scripts/generate-storefront-pages.mjs
// Needs .env (repo root) with SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
// Wired to a scheduled GitHub Action (.github/workflows/storefront-pages.yml)
// so new bakers get a page within a day; also runs on web deploys.

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SITE_ORIGIN = "https://bakeriapp.com";
const GENERATED_MARKER = "<!-- bakeri:generated-storefront -->";
const DEFAULT_OG_IMAGE = `${SITE_ORIGIN}/1024.png`;

// ── env ──────────────────────────────────────────────────────────────────────
function loadEnv() {
  const env = { ...process.env };
  try {
    for (const line of readFileSync(join(ROOT, ".env"), "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
    }
  } catch { /* .env optional when vars come from CI */ }
  return env;
}
const env = loadEnv();
const SUPABASE_URL = env.SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const STORAGE = `${SUPABASE_URL}/storage/v1/object/public`;

// ── helpers ──────────────────────────────────────────────────────────────────
const esc = (v) =>
  String(v ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const attr = (v) => esc(v).replace(/\n/g, " ");

function truncate(s, n) {
  s = String(s ?? "").replace(/\s+/g, " ").trim();
  return s.length <= n ? s : s.slice(0, n - 1).replace(/\s+\S*$/, "") + "…";
}

async function urlExists(url) {
  try {
    const r = await fetch(url, { method: "HEAD" });
    return r.ok;
  } catch { return false; }
}

async function pickOgImage(bakerId, updatedAt) {
  const idU = String(bakerId).toUpperCase();
  // Same cache-bust as baker/index.html's assetURL — storefront images sit at
  // fixed Storage paths, so pin the OG tag to the profile's publish timestamp
  // rather than letting scrapers hold a stale thumbnail.
  const stamp = updatedAt ? Date.parse(updatedAt) : 0;
  const v = stamp ? `?v=${stamp}` : "";
  const header = `${STORAGE}/storefront-headers/${idU}/header.jpg`;
  const logo = `${STORAGE}/business-logos/${idU}/logo.jpg`;
  if (await urlExists(header)) return header + v;
  if (await urlExists(logo)) return logo + v;
  return DEFAULT_OG_IMAGE;
}

// ── data ─────────────────────────────────────────────────────────────────────
async function fetchSlugs() {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?select=id,profile_slug&profile_slug=not.is.null&order=profile_slug`,
    { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } },
  );
  if (!r.ok) throw new Error(`profiles fetch failed: ${r.status} ${await r.text()}`);
  return (await r.json()).map((p) => String(p.profile_slug).trim().toLowerCase()).filter(Boolean);
}

async function fetchProfile(slug) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_baker_web_profile_by_slug`, {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ p_slug: slug }),
  });
  if (!r.ok) throw new Error(`rpc failed for ${slug}: ${r.status}`);
  const data = await r.json();
  return data && data.profile ? data : null;
}

// ── page template ────────────────────────────────────────────────────────────
function renderPage({ slug, profile, listings, ogImage }) {
  const name = (profile.business_name || profile.user_name || "This baker").trim();
  const locality = [profile.neighbourhood || profile.pickup_city, profile.pickup_province]
    .filter(Boolean).join(", ");
  const bioSource = profile.bio || profile.about_story || "";
  const description = truncate(
    bioSource || `Order handmade baked goods from ${name}${locality ? ` in ${locality}` : ""} on Bakeri.`,
    155,
  );
  const title = `${name} — Order online${locality ? ` · ${locality}` : ""}`;
  const canonical = `${SITE_ORIGIN}/${slug}`;
  const storeHref = `/baker/?slug=${encodeURIComponent(slug)}`;

  const items = (listings || [])
    .filter((l) => l && l.name)
    .slice(0, 30)
    .map((l) => {
      const price = Number(l.price) > 0 ? ` — $${Number(l.price).toFixed(2)}` : "";
      return `<li>${esc(l.name)}${price}</li>`;
    })
    .join("\n        ");

  const jsonLd = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Bakery",
    name,
    url: canonical,
    image: ogImage,
    ...(description ? { description } : {}),
    ...(locality
      ? { address: { "@type": "PostalAddress", addressLocality: profile.neighbourhood || profile.pickup_city || undefined, addressRegion: profile.pickup_province || undefined } }
      : {}),
  });

  return `<!DOCTYPE html>
${GENERATED_MARKER}
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${esc(title)}</title>
  <meta name="description" content="${attr(description)}" />
  <link rel="canonical" href="${attr(canonical)}" />

  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="Bakeri" />
  <meta property="og:title" content="${attr(name)}" />
  <meta property="og:description" content="${attr(description)}" />
  <meta property="og:url" content="${attr(canonical)}" />
  <meta property="og:image" content="${attr(ogImage)}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${attr(name)}" />
  <meta name="twitter:description" content="${attr(description)}" />
  <meta name="twitter:image" content="${attr(ogImage)}" />

  <meta name="theme-color" content="#FFFFFF" media="(prefers-color-scheme: light)" />
  <meta name="theme-color" content="#241A14" media="(prefers-color-scheme: dark)" />
  <link rel="icon" type="image/png" href="/assets/favicon.png" />
  <link rel="apple-touch-icon" href="/assets/favicon.png" />

  <script type="application/ld+json">${jsonLd}</script>

  <style>
    :root { color-scheme: light dark; }
    body { font-family: -apple-system, "SF Pro Text", system-ui, sans-serif;
           background: #F6F1E6; color: #241712; margin: 0;
           display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 32px; }
    @media (prefers-color-scheme: dark) { body { background: #1A130E; color: #F2E9DE; } }
    main { max-width: 560px; width: 100%; }
    h1 { font-size: clamp(26px, 6vw, 40px); margin: 0 0 6px; }
    .loc { color: #8a7d6d; font-size: 15px; margin: 0 0 18px; }
    p.bio { font-size: 16px; line-height: 1.6; margin: 0 0 22px; }
    a.cta { display: inline-block; background: #241712; color: #fff; text-decoration: none;
            padding: 14px 26px; border-radius: 12px; font-weight: 600; }
    @media (prefers-color-scheme: dark) { a.cta { background: #F2E9DE; color: #1A130E; } }
    h2 { font-size: 14px; text-transform: uppercase; letter-spacing: .05em; color: #8a7d6d;
         margin: 34px 0 10px; }
    ul { margin: 0; padding-left: 20px; line-height: 1.9; font-size: 15px; }
  </style>
</head>
<body>
  <main>
    <h1>${esc(name)}</h1>
    ${locality ? `<p class="loc">${esc(locality)}</p>` : ""}
    ${bioSource ? `<p class="bio">${esc(truncate(bioSource, 400))}</p>` : ""}
    <a class="cta" href="${attr(storeHref)}">View the full menu &amp; order online &rarr;</a>
    ${items ? `<h2>On the menu</h2>\n    <ul>\n        ${items}\n    </ul>` : ""}
  </main>

  <script>
    // Progressive enhancement: send real visitors straight into the interactive
    // storefront. Crawlers and link-preview bots keep the static content + meta
    // above. clean=1 makes baker/index.html restore this same clean URL.
    location.replace(${JSON.stringify(storeHref + "&clean=1")});
  </script>
</body>
</html>
`;
}

// ── main ─────────────────────────────────────────────────────────────────────
const slugs = await fetchSlugs();
console.log(`${slugs.length} slugs from DB`);

const written = [];
const failed = [];
for (const slug of slugs) {
  if (!/^[a-z0-9-]+$/.test(slug)) { failed.push(`${slug} (invalid chars)`); continue; }
  try {
    const data = await fetchProfile(slug);
    if (!data) { failed.push(`${slug} (no profile from RPC)`); continue; }
    const ogImage = await pickOgImage(data.profile.id, data.profile.updated_at);
    const html = renderPage({ slug, profile: data.profile, listings: data.listings, ogImage });
    const dir = join(ROOT, slug);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "index.html"), html);
    written.push(slug);
  } catch (e) {
    failed.push(`${slug} (${e.message})`);
  }
}

// ── prune stale generated dirs (slug renamed / baker removed) ─────────────────
const liveSet = new Set(written);
let pruned = 0;
for (const entry of readdirSync(ROOT)) {
  const idx = join(ROOT, entry, "index.html");
  if (liveSet.has(entry) || entry.startsWith(".") || entry.includes(".")) continue;
  if (!existsSync(idx) || !statSync(join(ROOT, entry)).isDirectory()) continue;
  try {
    if (readFileSync(idx, "utf8").includes(GENERATED_MARKER)) {
      rmSync(join(ROOT, entry), { recursive: true, force: true });
      pruned++;
      console.log(`pruned stale: ${entry}`);
    }
  } catch { /* not ours */ }
}

console.log(`\nwrote ${written.length}, pruned ${pruned}, failed ${failed.length}`);
if (failed.length) console.log("failed:\n  " + failed.join("\n  "));
process.exit(failed.length && !written.length ? 1 : 0);
