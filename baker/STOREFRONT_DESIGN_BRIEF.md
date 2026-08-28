# Bakeri Storefront — Design Brief (hand-off for Claude Design)

**Goal:** revamp the *frame / layout* of the public baker storefront at `bakeriapp.com/<slug>` for a
more beautiful, considered look — without breaking the theming system or the fact that it's a
static page fed by live data.

---

## 1. What this page is

- **One page per baker.** URL is `bakeriapp.com/<profile_slug>` (e.g. `bakeriapp.com/sweetsouthern`).
  GitHub Pages has no routing, so `404.html` redirects a bare slug to
  `baker/index.html?slug=<slug>&clean=1`, which then restores the clean URL.
- **Source file:** `baker/index.html` (~3,450 lines — one file, inline `<style>` + inline JS).
  Theming helper: `baker/theme.js`.
- **Data:** everything below the shell markup is JS-populated at runtime from one Supabase RPC
  (`get_baker_web_profile_by_slug`). The HTML in the file is just empty containers.
- **It doubles as a linktree.** A baker who sells nothing yet still uses this as their bio-link
  page, so the layout must look intentional with as little as a name + one link, or as much as
  name + 4 product types + About + FAQ + Hours + Policies.
- **Every section self-hides when empty** (`.hidden`). Any redesign must degrade gracefully as
  sections drop out — dividers are drawn with `.section-band + .section-band` so they always land
  on a *visible* seam.

### Live examples to open / screenshot
| URL | Notes |
|---|---|
| https://bakeriapp.com/sweetsouthern | Sprinkle theme (hot-pink accent), header photo, Menu (4 items) + Digital Downloads + About |
| https://bakeriapp.com/baker/index.html?slug=sweetsouthern | same page, direct (no clean-URL rewrite) |

Open in both light and dark mode, and at mobile (375) + desktop (≥1200) widths.

---

## 2. Current page anatomy (top → bottom)

Everything lives in **one opaque, `max-width: 1200px`, centered column** (`#page-shell`,
`display:flex; flex-direction:column`). A fixed, `z-index:-1` pattern layer (theme.js) sits behind
it — on desktop it only shows in the side margins; on mobile the column is full-bleed so no pattern
shows. `#page-shell` is a flex column specifically so the header bar and hero can swap order between
breakpoints (`order`) instead of being duplicated nodes.

| # | Element | Role | Mobile | Desktop (≥860px) |
|---|---|---|---|---|
| 1 | `#announcement-banner` | promo strip (free-shipping threshold etc.) | `order:-2`, full-width accent bar | same |
| 2 | `#site-header-bar` | chrome bar | hamburger + Share + Cart icons, **above** hero | nav tabs only, centered, **below** hero (hero gets `order:-1`) |
| 3 | `#mobile-nav-drawer` | section nav as stacked list | opens under hamburger | `display:none` |
| 4 | `#profile-hero` | identity | header photo as full-bleed bg behind avatar+name+meta-pill+bio+social icons; 20% scrim + text-shadow for legibility | same; Share/Cart float top-right over photo (`#site-header-desktop`) |
| 5 | `#feed-heading` ("Menu") | band heading | | |
| 6 | `#filter-strip` | availability chips (All / Ready Now / Pre-order / Custom) + category chips | horizontal scroll, centered | wraps |
| 7 | `#feed` | **Menu** — product cards | 2-col grid | `repeat(auto-fit, minmax(180px,1fr))`, single-card capped at 320px |
| 8 | `#digital-feed` | **Digital Downloads** — plain rows (thumb + name + price + `+`), not cards | | |
| 9 | `#physical-feed` | **Ships to You** — one `.category-block` (heading + product grid) per category | | |
| 10 | `#links-feed` | linktree sections — stacked `.link-row`s (circle icon + label + arrow). Sits *before* About. | | |
| 11 | `#pb-about` | **About the Baker** — portrait floats left (magazine pull-image), text wraps | portrait 42% | portrait 25% |
| 12 | `#faq-col` | **FAQ** — accordion rows | | |
| 13 | `#pb-policies` | **Store Policies** — paragraph | | |
| 14 | `#hours-card` | **Store Hours** — day/time rows, `max-width:320px` | | |
| 15 | `#site-footer` | contact + `© <year> <baker> · bakeriapp.com · Privacy` | | |
| — | `#action-bar` | fixed bottom "View Cart" pill — only shows with items in cart | fixed | `display:none`, replaced by header Cart button |
| — | Sheets | `#item-scrim` (product detail), `#cart-scrim` (cart/checkout, slides from right on desktop), `#desc-scrim` (full description) | bottom sheet | centered / side drawer |

**Product card (`.p-card`)** — mirrors the iOS app's Market card exactly: square photo with an
overlaid kind badge (Ready Now / Pre-order / Custom, colored `--ready`/`--preorder`/`--custom`),
then name, then meta line ("3 available today" / "Ordering closed"), a hairline divider, then a
price + add-button row (`from $24.00` style prefix when variants). Add button is a 32px accent
circle that becomes a qty stepper.

---

## 3. Design token system (must be preserved)

The page reads as "the same product as the iOS app." Two layers of tokens:

### a) Baker-adaptive (set at runtime by `theme.js` from the baker's in-app theme choice)
```
--theme-primary / --accent / --accent-fg   → CTA, badges, active chips, cart bar
--theme-secondary                          → avatar bg, hero gradient fallback
--theme-bg / --bg                          → page column background (tinted per theme)
--theme-gold                               → minor accent
```
There are **13 themes** (Classic, Macaron, Birthday, Tart, Sprinkle, Ember, Sage, Blueberry, Honey,
Fall, …) each with a light + dark hex set, plus **background patterns** (Standard, Stripes, Polka
Dot, Gingham, Pumpkins). All defined in `baker/theme.js` — it's a direct port of the app's
`AppTheme.swift`. **Do not invent new colors for chrome** — anything themable must come from these
vars so all 13 themes keep working.

### b) Fixed tokens (never vary per baker — from `BakeriTheme.swift`'s profile redesign)
```
--surface   #FFFFFF  (dark #241A14)   section backgrounds, header bar
--ink       #241712  (dark #F6F1E6)   headings / primary text
--bio       #4A3E33  (dark #E4D9C8)   body copy
--muted     #948577                   secondary text, meta lines
--chip-text #7A6C5D                   pill text
--line      rgba(36,23,18,.08)        hairline dividers
--line-soft rgba(36,23,18,.06)
status:  --ready #3FA672 · --preorder #C79A3D · --custom #A66A5B
         --digital #5F92E6 · --physical #7A8C5C · --error #C0392B
```

### Type / shape / depth (current)
- Font: **system only** — `-apple-system, "SF Pro Text", system-ui, sans-serif`. No web fonts.
  (Design foundation note: mirror the app's real tokens — plain SF Pro, capsule/pill shapes, no
  invented display headings or banners.)
- Sizes: shop name 22px/700 · section h2 16px/700 · card name 13.5px/700 · body 13.5–14.5px ·
  meta 11.5–12px · pills 13px/600.
- Radius: cards 16px · sheets 24px (top only) · pills/buttons `9999px` · inputs 12px · link rows 16px.
- Shadow: cards `0 2px 5px rgba(36,23,18,.08)` · circle buttons a soft double shadow ·
  desktop column `0 8px 40px rgba(20,15,10,.14)` to lift it off the pattern.
- Buttons: `.btn-primary` 50px accent pill · `.btn-outline` 48px, `1.5px` line border.
- **Breakpoint: 860px** (single one). Desktop column stays 1200px max.

---

## 4. Hard constraints for any redesign

1. **Static + JS-populated.** No build step, no framework. Redesign is HTML structure + CSS in the
   one inline `<style>`. Containers get filled by existing JS (keep the `id`s, or the JS renderers
   listed in §2 must be updated in lockstep).
2. **Theme-var driven.** Every themable surface uses `--accent` / `--bg` / `--theme-*`. Test the
   result against at least Classic (near-black accent, cream bg), Sprinkle (hot pink), and a dark
   bold theme (e.g. Blueberry) — a design that only looks good in one accent is a regression.
3. **Graceful section collapse.** Must look finished with only {name + 1 link}, and with the full
   stack. No section may assume another is present.
4. **Legibility over header photo.** Baker photos are arbitrary and busy; the current answer is a
   light 20% scrim + per-element text-shadow (a heavier blanket scrim was rejected for dulling the
   photo). Keep something equivalent.
5. **Same-as-app feel.** No new display typeface, no decorative section banners, no invented brand
   iconography. Pills and hairlines, not heavy cards-in-cards.
6. **Mobile is the primary surface** (most traffic is Instagram bio-link, in-app browser). Desktop
   is the centered column + margin pattern.
7. Cart / checkout / detail **sheets** and the fixed bottom cart bar are functional plumbing —
   restyle freely but keep the interaction model.

---

## 5. What to hand Claude Design

1. **This file.**
2. **`baker/index.html`** — the current frame (structure + all CSS).
3. **`baker/theme.js`** — the 13-theme / 5-pattern token system.
4. **Screenshots** of `bakeriapp.com/sweetsouthern`: mobile + desktop, light + dark, scrolled to
   show hero, product grid, digital rows, About, footer.
5. *(optional)* the iOS app's `BakeriTheme.swift` and `BakerPublicProfileView` for the "same
   product" reference.

## 6. The redesign ask (fill in before sending)

> _e.g. "Rework the hero — the avatar-on-photo-with-scrim look is generic; want something that feels
> like a real bakery shopfront. Tighten the jump from hero straight into a chip bar. Give Menu vs
> Digital vs Ships-to-You a clearer visual rhythm. Keep everything else."_

_Add your specific direction here so Claude Design reframes rather than restyles at random._
