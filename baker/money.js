/*
 * Shop currency on storefront and payment pages (2026-11-14).
 * A shop charges in its vendor's own currency (US shops USD, everyone else
 * CAD). Pages label it, and a shopper can choose to see approximate prices in
 * the other currency (CAD <-> USD, daily ECB rate from storefront_currency()).
 * Display only: the charge is always in the shop's currency.
 *
 *   BakeriMoney.init(money)    money = profile.money / storefront_currency()
 *   BakeriMoney.fmt(v)         "$12.00", or "US$8.42" when showing the other currency
 *   BakeriMoney.charge(v)      what is actually charged: "$12.00 CAD"
 *   BakeriMoney.approx(v)      "≈ US$8.42" when showing the other currency, else ""
 *   BakeriMoney.code()         "CAD"
 *   BakeriMoney.switcherHTML() "Prices in CAD · Show in US$" (data-bk-cur buttons)
 *
 * Payment pages render before they know the shop, so they use the HTML forms
 * (chargeHTML / codeHTML / slotHTML) and call loadFor(bakerId): it fills the
 * shop's currency in from the storefront's cache straight away, then from
 * storefront_currency(), updating every .bk-code / .bk-approx / .bk-cur-slot.
 */
(function () {
  var KEY = 'bakeri_show_currency';
  var shop = 'cad', alt = 'usd', rate = null, show = 'cad';

  function sym(c) { return c === 'usd' ? 'US$' : 'CA$'; }
  function two(v) { return (Math.round(Number(v || 0) * 100) / 100).toFixed(2); }
  function showingAlt() { return !!rate && show === alt; }

  function init(m) {
    if (m && (m.currency === 'usd' || m.currency === 'cad')) {
      shop = m.currency;
      alt = m.alt_currency || (shop === 'usd' ? 'cad' : 'usd');
      rate = Number(m.rate) > 0 ? Number(m.rate) : null;
    }
    show = shop;
    try { if (localStorage.getItem(KEY) === alt && rate) show = alt; } catch (e) { /* private mode */ }
  }

  function cacheKey(id) { return 'bk_money_' + id; }

  function refresh() {
    document.querySelectorAll('.bk-code').forEach(function (el) { el.textContent = shop.toUpperCase(); });
    document.querySelectorAll('.bk-approx').forEach(function (el) {
      var v = Number(el.getAttribute('data-v'));
      el.textContent = showingAlt() ? '≈ ' + sym(alt) + two(v * rate) : '';
    });
    document.querySelectorAll('.bk-cur-slot').forEach(function (el) { el.innerHTML = window.BakeriMoney.switcherHTML(true); });
  }

  function loadFor(bakerId, url, key) {
    if (!bakerId) return;
    try {
      var cached = JSON.parse(sessionStorage.getItem(cacheKey(bakerId)) || 'null');
      if (cached) { init(cached); refresh(); }
    } catch (e) { /* private mode */ }
    if (!url || !key) return;
    fetch(url + '/rest/v1/rpc/storefront_currency', {
      method: 'POST', headers: { 'Content-Type': 'application/json', apikey: key },
      body: JSON.stringify({ p_baker_id: bakerId })
    }).then(function (r) { return r.json(); })
      .then(function (m) { if (m && m.currency) { remember(bakerId, m); init(m); refresh(); } })
      .catch(function () {});
  }

  function remember(bakerId, m) {
    try { if (bakerId && m) sessionStorage.setItem(cacheKey(bakerId), JSON.stringify(m)); } catch (e) { /* private mode */ }
  }

  function setShow(c) {
    try { localStorage.setItem(KEY, c); } catch (e) { /* private mode */ }
    location.reload();
  }

  // Shared look for the labels, so a page only needs the script tag.
  try {
    var st = document.createElement('style');
    st.textContent = '.bk-cur{font-size:12px;opacity:.8}' +
      '.bk-cur button{background:none;border:0;padding:0 0 0 4px;font:inherit;color:inherit;text-decoration:underline;text-underline-offset:2px;cursor:pointer}' +
      '.bk-cur-slot{margin:4px 0 10px;text-align:right}' +
      '.bk-code{font-size:.8em;font-weight:600;opacity:.75;letter-spacing:.02em}' +
      '.bk-approx{display:block;font-size:12px;font-weight:400;opacity:.7}.bk-approx:empty{display:none}';
    document.head.appendChild(st);
  } catch (e) { /* no head yet */ }

  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-bk-cur]');
    if (!b) return;
    e.preventDefault();
    setShow(b.getAttribute('data-bk-cur'));
  });

  window.BakeriMoney = {
    init: init,
    loadFor: loadFor,
    remember: remember,
    refresh: refresh,
    codeHTML: function () { return '<span class="bk-code">' + shop.toUpperCase() + '</span>'; },
    chargeHTML: function (v) {
      return '$' + two(v) + ' <span class="bk-code">' + shop.toUpperCase() + '</span>' +
        '<small class="bk-approx" data-v="' + Number(v) + '">' + (showingAlt() ? '≈ ' + sym(alt) + two(Number(v) * rate) : '') + '</small>';
    },
    slotHTML: function () { return '<div class="bk-cur-slot">' + window.BakeriMoney.switcherHTML(true) + '</div>'; },
    code: function () { return shop.toUpperCase(); },
    showingAlt: showingAlt,
    fmt: function (v) { return showingAlt() ? sym(alt) + two(Number(v) * rate) : '$' + two(v); },
    charge: function (v) { return '$' + two(v) + ' ' + shop.toUpperCase(); },
    approx: function (v) { return showingAlt() ? '≈ ' + sym(alt) + two(Number(v) * rate) : ''; },
    // payPage: payment pages keep every line in the shop's currency and only
    // add the ≈ amount under the total, so they word it that way.
    switcherHTML: function (payPage) {
      if (!rate) return '<span class="bk-cur">Prices in ' + shop.toUpperCase() + '</span>';
      if (payPage && showingAlt()) {
        return '<span class="bk-cur">You’ll pay in ' + shop.toUpperCase() + '. The ' + alt.toUpperCase() + ' amount is approximate. <button type="button" data-bk-cur="' + shop + '">Hide</button></span>';
      }
      return showingAlt()
        ? '<span class="bk-cur">Approximate prices in ' + alt.toUpperCase() + '. You’ll pay in ' + shop.toUpperCase() + '. <button type="button" data-bk-cur="' + shop + '">Show ' + shop.toUpperCase() + '</button></span>'
        : '<span class="bk-cur">Prices in ' + shop.toUpperCase() + ' <button type="button" data-bk-cur="' + alt + '">Show in ' + sym(alt) + '</button></span>';
    }
  };
})();
