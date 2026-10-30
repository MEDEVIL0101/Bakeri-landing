// Storefront tip picker — shared by checkout.html (menu pickup payment),
// pay-quote.html (a quote paid in full) and pay/index.html (a storefront
// order's final invoice). 10% / 15% / 20% / Custom / No tip, worked out on
// baseCents; any tip is capped at maxCents (the amount being charged), same as the server
// (_shared/fees.ts parseTipCents). The vendor keeps 100% of it.
//
//   BakeriTipPicker.mount(container, {
//     baseCents,                       // what the percentages are of
//     maxCents,                        // cap for any tip (default baseCents)
//     shopName, state,                 // state: { choice, cents } to restore
//     onChange: function (state) {}    // { choice: 'none'|10|15|20|'custom', cents }
//   });
(function () {
  var PERCENTS = [10, 15, 20];

  var CSS =
    '.tip-block{margin-top:14px}' +
    '.tip-block [hidden]{display:none}' +
    '.tip-block .tip-title{font-size:13px;font-weight:700;color:var(--ink)}' +
    '.tip-block .tip-sub{font-size:12px;color:var(--muted);margin-top:2px}' +
    '.tip-chips{display:grid;grid-template-columns:repeat(5,1fr);gap:6px;margin-top:8px}' +
    '.tip-chip{min-height:44px;padding:4px 2px;border-radius:10px;border:1.5px solid var(--line);background:var(--surface,#fff);color:var(--ink);font-weight:700;font-size:13px;cursor:pointer;line-height:1.15;font-family:inherit}' +
    '.tip-chip small{display:block;font-weight:500;font-size:11px;color:var(--muted)}' +
    '.tip-chip.on{border-color:var(--accent,var(--ink));background:var(--accent,var(--ink));color:var(--accent-fg,#fff)}' +
    '.tip-chip.on small{color:inherit;opacity:.85}' +
    '.tip-custom{display:flex;align-items:center;gap:6px;margin-top:8px;color:var(--ink)}' +
    '.tip-custom input{flex:1;min-width:0;height:42px;border-radius:10px;border:1.5px solid var(--line);background:var(--surface,#fff);color:var(--ink);padding:0 12px;font-size:14px;font-family:inherit}';

  function injectStyles() {
    if (document.getElementById('bakeri-tip-picker-css')) return;
    var style = document.createElement('style');
    style.id = 'bakeri-tip-picker-css';
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function money(cents) { return '$' + (cents / 100).toFixed(2); }

  function mount(container, opts) {
    injectStyles();
    var base = Math.max(0, Math.round(opts.baseCents || 0));
    var max = opts.maxCents != null ? Math.max(0, Math.round(opts.maxCents)) : base;
    function pct(p) { return Math.min(Math.round(base * p / 100), max); }
    var state = opts.state || { choice: 'none', cents: 0 };
    var shop = String(opts.shopName || '').trim();

    function chip(key, label, sub) {
      return '<button type="button" class="tip-chip' + (state.choice === key ? ' on' : '') + '" data-tip="' + key + '">' +
        label + (sub ? '<small>' + sub + '</small>' : '') + '</button>';
    }
    container.innerHTML =
      '<div class="tip-block">' +
        '<div class="tip-title">Add a tip' + (shop ? ' for ' + escapeHtml(shop) : '') + '?</div>' +
        '<div class="tip-sub">Optional — 100% goes to them.</div>' +
        '<div class="tip-chips">' +
          PERCENTS.map(function (p) { return chip(p, p + '%', money(pct(p))); }).join('') +
          chip('custom', 'Custom', '') + chip('none', 'No tip', '') +
        '</div>' +
        '<div class="tip-custom"' + (state.choice === 'custom' ? '' : ' hidden') + '>' +
          '<span>$</span><input type="text" inputmode="decimal" placeholder="0.00" autocomplete="off" aria-label="Custom tip amount"' +
          (state.choice === 'custom' && state.cents > 0 ? ' value="' + (state.cents / 100).toFixed(2) + '"' : '') + ' />' +
        '</div>' +
      '</div>';

    var custom = container.querySelector('.tip-custom');
    var input = custom.querySelector('input');

    function set(choice, cents) {
      state = { choice: choice, cents: cents };
      if (opts.onChange) opts.onChange(state);
    }
    function readCustom() {
      var v = parseFloat(String(input.value).replace(/[^0-9.]/g, ''));
      set('custom', isFinite(v) && v > 0 ? Math.min(Math.round(v * 100), max) : 0);
    }

    Array.prototype.forEach.call(container.querySelectorAll('.tip-chip'), function (btn) {
      btn.addEventListener('click', function () {
        var key = btn.dataset.tip;
        var choice = (key === 'none' || key === 'custom') ? key : Number(key);
        Array.prototype.forEach.call(container.querySelectorAll('.tip-chip'), function (b) { b.classList.toggle('on', b === btn); });
        custom.hidden = choice !== 'custom';
        if (choice === 'custom') { input.focus(); readCustom(); }
        else set(choice, choice === 'none' ? 0 : pct(choice));
      });
    });
    input.addEventListener('input', readCustom);
  }

  window.BakeriTipPicker = { mount: mount };
})();
