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
      swatches: ['#1C1C1E', '#A89B8C', '#D9E3E2']
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

    if (pattern === 'Stripes') {
      var band = hexToRgba(stripeColor, stripeOpacity);
      return {
        backgroundImage: 'repeating-linear-gradient(90deg, ' + band + ' 0px, ' + band + ' 24px, transparent 24px, transparent 48px)'
      };
    }
    if (pattern === 'Polka Dot') {
      var swatches = theme.swatches;
      var spacing = 52, r = 12;
      var layers = swatches.map(function (hex, i) {
        var color = hexToRgba(hex, dotOpacity);
        var offsetX = (i * spacing / swatches.length) + 'px';
        return 'radial-gradient(circle ' + r + 'px at ' + offsetX + ' ' + offsetX + ', ' + color + ' 99%, transparent 100%)';
      });
      return {
        backgroundImage: layers.join(', '),
        backgroundSize: spacing + 'px ' + spacing + 'px'
      };
    }
    if (pattern === 'Gingham') {
      return {
        backgroundImage: 'url(assets/gingham-background.jpg)',
        backgroundRepeat: 'repeat',
        opacity: dark ? '0.03' : '0.05'
      };
    }
    return null; // Standard — no pattern
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
