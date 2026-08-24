// In-app browsers (Instagram's bio-link browser especially) often keep a
// WebView "tab" alive across a visible close/reopen of the same link rather
// than tearing it down — reopening the link then resumes the exact page
// (e.g. mid-checkout, or a filled-out custom order form) the visitor left,
// via the browser's normal back/forward cache (bfcache), instead of a fresh
// load of the storefront. `pageshow` firing with `persisted: true` is the
// standard signal that a page came from bfcache rather than the network;
// forcing a reload there gets every visit back to a clean, current page.
// Registered once per real page load, so it's still armed after a bfcache
// restore re-shows that same JS/DOM state.
//
// Exception: a checkout page that has finished a purchase (order placed /
// downloads issued / quote paid) sets data-bakeri-no-reload="1" on <body>
// right when it renders that final success screen. Reloading a completed
// checkout throws away the in-memory success state and restarts the page
// from scratch — for a payment flow that means the buyer lands back on a
// "Continue to Payment" / "Pay" screen for an order they already paid for
// (e.g. clicking a digital download link, then pressing the browser's Back
// button). bfcache already froze the correct, already-paid DOM in place, so
// the right move there is to just leave it alone, not reload over it.
window.addEventListener('pageshow', function (event) {
  if (event.persisted && document.body.getAttribute('data-bakeri-no-reload') !== '1') {
    window.location.reload();
  }
});

// Ports AppTheme.swift + BackgroundPattern (BakeriApp.swift) to the public web
// pages, so a baker's page picks up the same theme they've already chosen
// in-app (profiles.selected_theme / profiles.background_pattern). No new
// settings surface here — this only renders an existing preference.
(function (global) {
  'use strict';

  // Mirrors AppTheme.swift's per-case light/dark hex pairs exactly.
  var THEMES = {
    'Classic': {
      primary:   { light: '#1C1C1E', dark: '#8E8E93' },
      secondary: { light: '#A89B8C', dark: '#968880' },
      bg:        { light: '#FAF6EE', dark: '#1A130F' },
      gold:      { light: '#C49A6C', dark: '#A07840' },
      buttonFg:  { light: '#FFFFFF', dark: '#1C1C1E' },
      swatches: ['#1C1C1E', '#A89B8C', '#D9E3E2'],
      pumpkinTint: { light: '#C49A6C', dark: '#A07840' }
    },
    'Macaron': {
      primary:   { light: '#D966B0', dark: '#E87CC0' },
      secondary: { light: '#F698DB', dark: '#B05898' },
      bg:        { light: '#FDFAF0', dark: '#1C1018' },
      gold:      { light: '#C8D87A', dark: '#90A840' },
      buttonFg:  { light: '#2A2020', dark: '#2A2020' },
      swatches: ['#FFE485', '#F698DB', '#E1EEAF']
    },
    'Birthday': {
      primary:   { light: '#5AAEE0', dark: '#70C0F0' },
      secondary: { light: '#FFD058', dark: '#D4A030' },
      bg:        { light: '#FFF4F8', dark: '#0E1620' },
      gold:      { light: '#FFD058', dark: '#D4A030' },
      buttonFg:  { light: '#2A2020', dark: '#2A2020' },
      swatches: ['#FFD3E4', '#92D1FF', '#FFD058']
    },
    'Tart': {
      primary:   { light: '#7E8435', dark: '#9AAA3C' },
      secondary: { light: '#FFD1D9', dark: '#A84058' },
      bg:        { light: '#F8F4EC', dark: '#141608' },
      gold:      { light: '#FF5E32', dark: '#CC4820' },
      buttonFg:  { light: '#FFFFFF', dark: '#FFFFFF' },
      swatches: ['#7E8435', '#FFD1D9', '#FF5E32']
    },
    'Sprinkle': {
      primary:   { light: '#F72967', dark: '#F04478' },
      secondary: { light: '#46C6D7', dark: '#2A98AA' },
      bg:        { light: '#F7F2FC', dark: '#160A1E' },
      gold:      { light: '#BCACDD', dark: '#8870C0' },
      buttonFg:  { light: '#FFFFFF', dark: '#FFFFFF' },
      swatches: ['#F72967', '#46C6D7', '#BCACDD']
    },
    // Experimental palette, added 2026-08-22 — mirrors AppTheme.swift's
    // ember/sage/blueberry/honey cases exactly (same hex pairs). `bold: true`
    // opts these four into the bolder Stripes/Gingham treatment in
    // patternBackground() below (mirrors AppTheme.usesBoldPatterns) — every
    // other theme's patterns are unchanged.
    'Ember': {
      primary:   { light: '#AE0001', dark: '#E5484D' },
      secondary: { light: '#D3A625', dark: '#EEBA30' },
      bg:        { light: '#FBF1E9', dark: '#1F0F0D' },
      gold:      { light: '#C9A227', dark: '#E0BB55' },
      buttonFg:  { light: '#FFFFFF', dark: '#FFFFFF' },
      swatches: ['#740001', '#EEBA30', '#D3A625'],
      bold: true
    },
    'Sage': {
      primary:   { light: '#2A623D', dark: '#4F9468' },
      secondary: { light: '#5D5D5D', dark: '#AAAAAA' },
      bg:        { light: '#F2F6F1', dark: '#10160F' },
      gold:      { light: '#A8935C', dark: '#C7B27E' },
      buttonFg:  { light: '#FFFFFF', dark: '#FFFFFF' },
      swatches: ['#1A472A', '#2A623D', '#AAAAAA'],
      bold: true
    },
    'Blueberry': {
      primary:   { light: '#222F5B', dark: '#5872B8' },
      secondary: { light: '#BEBEBE', dark: '#D6D6D6' },
      bg:        { light: '#EEF1F8', dark: '#0B1020' },
      gold:      { light: '#946B2D', dark: '#C79149' },
      buttonFg:  { light: '#FFFFFF', dark: '#FFFFFF' },
      swatches: ['#0E1A40', '#222F5B', '#946B2D'],
      bold: true,
      // Gold read as a plain "dark creme" with no blue in it — swapped for
      // the same hex as this theme's dark-mode primary (#5872B8): light
      // enough not to crush the pattern under multiply, but still reads
      // unmistakably as blueberry-blue.
      pumpkinTint: { light: '#5872B8', dark: '#5872B8' }
    },
    'Honey': {
      primary:   { light: '#ECB939', dark: '#F0C75E' },
      secondary: { light: '#726255', dark: '#90806E' },
      bg:        { light: '#FBF5E7', dark: '#1D1712' },
      gold:      { light: '#C99A3D', dark: '#E0B85A' },
      buttonFg:  { light: '#2A2020', dark: '#2A2020' },
      swatches: ['#ECB939', '#726255', '#372E29'],
      bold: true
    },
    // Fifth bold-header theme — mirrors AppTheme.swift's .fall case exactly.
    // legacyGingham: bold everywhere else (dark header, bold Stripes/Polka
    // Dot/Pumpkins), but keeps the same pale image-tile Gingham the five
    // original themes use instead of the two-colour woven check the other
    // four bold themes get for that one pattern specifically.
    'Fall': {
      primary:   { light: '#BF3E0F', dark: '#F25C05' },
      secondary: { light: '#D95A11', dark: '#F25C05' },
      bg:        { light: '#FDF1E7', dark: '#1F0D08' },
      gold:      { light: '#D95A11', dark: '#F25C05' },
      buttonFg:  { light: '#FFFFFF', dark: '#FFFFFF' },
      swatches: ['#A63117', '#F25C05', '#D95A11'],
      bold: true,
      legacyGingham: true
    }
  };

  function isDarkMode() {
    return typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  function hexToRgba(hex, alpha) {
    var h = hex.replace('#', '');
    var r = parseInt(h.substring(0, 2), 16);
    var g = parseInt(h.substring(2, 4), 16);
    var b = parseInt(h.substring(4, 6), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
  }

  // Builds the CSS for a full-page pattern layer, mirroring
  // AppBackgroundPattern's stripes/polkaDot/gingham logic closely enough to
  // read as "the same theme" without reproducing the exact Canvas math.
  function patternBackground(pattern, theme, dark) {
    // Kept deliberately quiet on web — a full-bleed page background this
    // busy pulls focus off the products themselves, more than it does at
    // in-app scale where UI chrome (nav bars, cards) breaks it up more.
    var stripeOpacity = dark ? 0.025 : 0.035;
    var dotOpacity = dark ? 0.05 : 0.07;
    var stripeColor = theme.primary[dark ? 'dark' : 'light'];
    // Experimental (2026-08-22): the four bold-header themes (theme.bold)
    // alternate two full-strength palette colours for Stripes/Gingham
    // instead of one pale tint against the base background — mirrors
    // AppTheme.usesBoldPatterns/AppBackgroundPattern on the native side.
    var boldOpacity = dark ? 0.55 : 0.65;

    if (pattern === 'Stripes') {
      if (theme.bold) {
        var bw = 24;
        var bandA = hexToRgba(theme.swatches[0], boldOpacity);
        var bandB = hexToRgba(theme.swatches[1], boldOpacity);
        return {
          backgroundImage: 'repeating-linear-gradient(90deg, ' + bandA + ' 0px, ' + bandA + ' ' + bw + 'px, ' + bandB + ' ' + bw + 'px, ' + bandB + ' ' + (bw * 2) + 'px)'
        };
      }
      var band = hexToRgba(stripeColor, stripeOpacity);
      return {
        backgroundImage: 'repeating-linear-gradient(90deg, ' + band + ' 0px, ' + band + ' 24px, transparent 24px, transparent 48px)'
      };
    }
    if (pattern === 'Polka Dot') {
      // Two staggered rows per repeat tile — a real brick/polka-dot grid,
      // colour cycling through the theme's three swatches per row and
      // shifting the starting colour on the second row. Mirrors
      // AppBackgroundPattern's Canvas algorithm (native: staggered grid,
      // one non-overlapping dot per cell, colour cycles by position). The
      // previous version stacked one overlapping radial-gradient layer per
      // colour at nearly the same spot within one small tile — dense,
      // smeared-together blobs along a diagonal, not separated dots, which
      // read as "some other pattern" rather than polka dots.
      var swatches = theme.swatches;
      var spacing = 52, r = 12, half = spacing / 2;
      var tileW = spacing * 3, tileH = spacing * 2;
      var row1 = [0, 1, 2].map(function (i) {
        var x = half + i * spacing;
        var color = hexToRgba(swatches[i % swatches.length], dotOpacity);
        return 'radial-gradient(circle ' + r + 'px at ' + x + 'px ' + half + 'px, ' + color + ' 99%, transparent 100%)';
      });
      var row2 = [0, 1, 2].map(function (i) {
        var x = i * spacing;
        var color = hexToRgba(swatches[(i + 1) % swatches.length], dotOpacity);
        return 'radial-gradient(circle ' + r + 'px at ' + x + 'px ' + (half + spacing) + 'px, ' + color + ' 99%, transparent 100%)';
      });
      return {
        backgroundImage: row1.concat(row2).join(', '),
        backgroundSize: tileW + 'px ' + tileH + 'px'
      };
    }
    // Pumpkins is handled separately in apply() — it needs a two-layer
    // grayscale-then-multiply duotone (real artwork, not a CSS-drawn
    // shape), which a single flat background-image/color object here can't
    // express. See buildPumpkinLayer below.
    if (pattern === 'Gingham') {
      if (theme.bold && !theme.legacyGingham) {
        // A genuine two-colour woven check — horizontal bands of one
        // palette colour, vertical bands of another, both translucent so
        // CSS alpha-composites their overlap into a third, deeper blended
        // tone (mirrors AppBackgroundPattern's Canvas version). Every other
        // theme keeps the fixed gingham-background.jpg tile below.
        var gw = 22;
        var colorA = hexToRgba(theme.swatches[0], boldOpacity);
        var colorB = hexToRgba(theme.swatches[1], boldOpacity);
        return {
          backgroundImage:
            'repeating-linear-gradient(to bottom, ' + colorA + ' 0px, ' + colorA + ' ' + gw + 'px, transparent ' + gw + 'px, transparent ' + (gw * 2) + 'px), ' +
            'repeating-linear-gradient(to right, ' + colorB + ' 0px, ' + colorB + ' ' + gw + 'px, transparent ' + gw + 'px, transparent ' + (gw * 2) + 'px)'
        };
      }
      return {
        backgroundImage: 'url(assets/gingham-background.jpg)',
        backgroundRepeat: 'repeat',
        opacity: dark ? '0.03' : '0.05'
      };
    }
    return null; // Standard — no pattern
  }

  // Pumpkins needs two stacked layers, not one flat background object:
  // CSS composites background-image + background-color (via
  // background-blend-mode) on an element BEFORE any filter on that same
  // element runs, so a single-element grayscale-then-multiply isn't
  // possible — the filter would strip the colour back out after blending.
  // Layer 1 (the real artwork, tiled) gets grayscale(1) on its own;
  // layer 2 (a flat theme colour) sits on top with mix-blend-mode:
  // multiply, blending against layer 1's already-grayscaled pixels.
  // Mirrors AppBackgroundPattern's SwiftUI .saturation(0) + .blendMode
  // (.multiply) construction exactly.
  function buildPumpkinLayer(theme, dark, themeName) {
    var wrap = document.createElement('div');
    wrap.id = 'theme-pattern-layer';
    wrap.style.position = 'fixed';
    wrap.style.inset = '0';
    wrap.style.zIndex = '-1';
    wrap.style.pointerEvents = 'none';
    wrap.style.opacity = dark ? '0.4' : '0.5';

    var art = document.createElement('div');
    art.style.position = 'absolute';
    art.style.inset = '0';
    art.style.backgroundImage = 'url(assets/pumpkin-background.jpg)';
    art.style.backgroundRepeat = 'repeat';
    wrap.appendChild(art);

    // Fall's palette is drawn from this artwork's own colours, so it shows
    // the real photographed colours unfiltered rather than the grayscale +
    // multiply duotone every other theme gets.
    if (themeName === 'Fall') return wrap;
    art.style.filter = 'grayscale(1)';

    // Mirrors AppTheme.pumpkinTintColor: Blueberry's swatches[0] (navy) and
    // Classic's light-mode primary (near-black) multiply the grayscaled
    // artwork down to near-illegible, so those two use `pumpkinTint`
    // (== their `gold` accent) instead. Every other theme keeps the same
    // header/stripe colour as before.
    var tint = document.createElement('div');
    tint.style.position = 'absolute';
    tint.style.inset = '0';
    tint.style.backgroundColor = theme.pumpkinTint
      ? theme.pumpkinTint[dark ? 'dark' : 'light']
      : (theme.bold ? theme.swatches[0] : theme.primary[dark ? 'dark' : 'light']);
    tint.style.mixBlendMode = 'multiply';
    wrap.appendChild(tint);
    return wrap;
  }

  // Applies theme + pattern from a fetched web-profile RPC response onto the
  // current page. Safe to call with a missing/unknown theme — falls back to
  // Classic so the page never renders unstyled.
  function apply(profile, opts) {
    var themeName = (profile && profile.selected_theme) || 'Classic';
    var theme = THEMES[themeName] || THEMES['Classic'];
    var pattern = (profile && profile.background_pattern) || 'Standard';
    var dark = isDarkMode();
    var mode = dark ? 'dark' : 'light';

    var root = document.documentElement.style;
    root.setProperty('--theme-primary', theme.primary[mode]);
    root.setProperty('--theme-secondary', theme.secondary[mode]);
    root.setProperty('--theme-bg', theme.bg[mode]);
    root.setProperty('--theme-gold', theme.gold[mode]);
    root.setProperty('--theme-button-fg', theme.buttonFg[mode]);

    var existing = document.getElementById('theme-pattern-layer');
    if (existing) existing.remove();

    // The storefront (baker/index.html) renders the pattern inside a
    // contained cover band instead of tiling the full page — a full-bleed
    // repeating texture behind every section read as noise, not brand.
    // Callers that want that (checkout/custom-order/pay-quote, which have
    // no cover band of their own) get the old full-page layer unchanged.
    if (opts && opts.suppressPatternLayer) return;

    if (pattern === 'Pumpkins') {
      document.body.insertBefore(buildPumpkinLayer(theme, dark, themeName), document.body.firstChild);
      return;
    }

    var css = patternBackground(pattern, theme, dark);
    if (css) {
      var layer = document.createElement('div');
      layer.id = 'theme-pattern-layer';
      layer.style.position = 'fixed';
      layer.style.inset = '0';
      layer.style.zIndex = '-1';
      layer.style.pointerEvents = 'none';
      Object.keys(css).forEach(function (key) { layer.style[key] = css[key]; });
      document.body.insertBefore(layer, document.body.firstChild);
    }
  }

  global.BakeriTheme = { THEMES: THEMES, apply: apply, patternBackground: patternBackground, isDarkMode: isDarkMode };
})(window);
