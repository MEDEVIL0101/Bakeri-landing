// BakeriIntakeForm — the custom-order intake form engine, shared between
// baker/custom-order.html (a click-through page for one custom listing) and
// baker/index.html (when profiles.storefront_listing_id makes a listing's
// form the ENTIRE storefront — see 20260910000001/2's migrations). One copy
// of the field renderers, the date-picker, photo upload, product selector,
// conditional fields, validation, and the submit-custom-order-inquiry call —
// duplicating this across two live pages was the alternative, and a
// quote-capturing form is exactly the kind of thing that shouldn't drift
// into two different behaviors by accident.
//
// This module owns ONLY the form itself — not the surrounding page chrome
// (header, About, hours, etc.). The host page fetches its own profile data
// and renders its own header; it just hands this module a container element
// and the ids needed to fetch the form's fields.
//
// Usage:
//   <script src="theme.js"></script>            (optional, for theme colors)
//   <script src="intake-form.js"></script>
//   <script>
//     window.BakeriIntakeForm.mount({
//       container: document.getElementById('card'),
//       supabaseUrl: SUPABASE_URL,
//       anonKey: ANON_KEY,
//       bakerId: '...', itemId: '...', formId: '...',
//       itemName: 'Custom Sugar Cookies',
//       standalone: true   // false when embedded in a fuller storefront —
//                           // skips the "Custom Order Request" heading and
//                           // document.title (the host page owns both)
//     });
//   </script>

(function () {
  const RECAPTCHA_SITE_KEY = '6LcIGEgtAAAAAAYXr8zyy_jJse4xc9LgjN43otQf';
  const RECAPTCHA_ACTION   = 'submit_custom_order_inquiry';
  const MAX_PHOTOS = 5;
  const MAX_PHOTO_DIMENSION = 1200;
  const PHOTO_QUALITY = 0.75;

  const STYLE_ID = 'bakeri-intake-form-styles';
  const CSS = ''
    + '.bkform-eyebrow { font-size: 12px; font-weight: 700; color: var(--muted); }'
    + '.bkform-item-name { font-size: 22px; font-weight: 700; color: var(--ink); margin-top: 4px; }'
    + '.bkform-lede { font-size: 14px; color: var(--muted); margin-top: 8px; line-height: 1.5; }'
    + '.bkform .field-group { margin-top: 20px; }'
    + '.bkform .field-group:first-child { margin-top: 0; }'
    + '.bkform .field-label { font-size: 13.5px; font-weight: 600; color: var(--ink); margin-bottom: 6px; display: block; }'
    + '.bkform .field-help { font-size: 12px; color: var(--muted); margin-top: 4px; }'
    + '.bkform .field-required { color: var(--error); }'
    + '.bkform input[type="text"], .bkform input[type="email"], .bkform input[type="tel"], .bkform input[type="number"], .bkform input[type="date"], .bkform textarea {'
    + '  width: 100%; padding: 12px 14px; font-family: var(--sans); font-size: 15px;'
    + '  color: var(--ink); background: var(--bg); border: 1.5px solid var(--line);'
    + '  border-radius: 12px; outline: none; box-sizing: border-box;'
    + '}'
    + '.bkform textarea { resize: vertical; min-height: 88px; }'
    + '.bkform input:focus, .bkform textarea:focus { border-color: var(--ink); }'
    + '.bkform input.field-error, .bkform textarea.field-error { border-color: var(--error); }'
    + '.bkform .choice-list { display: flex; flex-direction: column; gap: 8px; }'
    + '.bkform .choice-option {'
    + '  display: flex; align-items: center; gap: 10px; padding: 12px 14px;'
    + '  background: var(--bg); border: 1.5px solid var(--line); border-radius: 12px; cursor: pointer; -webkit-tap-highlight-color: transparent;'
    + '}'
    + '.bkform .choice-option.selected { border-color: var(--ink); }'
    + '.bkform .choice-option input { margin: 0; }'
    + '.bkform .choice-option span { font-size: 14.5px; color: var(--ink); }'
    + '.bkform .photo-field { display: flex; flex-wrap: wrap; gap: 10px; }'
    + '.bkform .photo-thumb { width: 72px; height: 72px; border-radius: 14px; overflow: hidden; position: relative; background: var(--bg); }'
    + '.bkform .photo-thumb img { width: 100%; height: 100%; object-fit: cover; }'
    + '.bkform .photo-remove {'
    + '  position: absolute; top: 3px; right: 3px; width: 20px; height: 20px; border-radius: 50%;'
    + '  background: rgba(20,15,10,0.7); border: none; color: #fff; font-size: 12px; cursor: pointer;'
    + '  display: flex; align-items: center; justify-content: center;'
    + '}'
    + '.bkform .photo-add {'
    + '  width: 72px; height: 72px; border-radius: 14px; border: 1.5px dashed var(--line);'
    + '  display: flex; align-items: center; justify-content: center; cursor: pointer; color: var(--muted); font-size: 22px;'
    + '}'
    + '.bkform .product-list { display: flex; flex-direction: column; gap: 8px; }'
    + '.bkform .product-item {'
    + '  display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 12px 14px;'
    + '  background: var(--bg); border: 1.5px solid var(--line); border-radius: 12px;'
    + '}'
    + '.bkform .product-item-name { font-size: 14.5px; font-weight: 600; color: var(--ink); }'
    + '.bkform .product-item-price { font-size: 12.5px; color: var(--muted); margin-top: 2px; }'
    + '.bkform .qty-stepper { display: flex; align-items: center; gap: 12px; flex-shrink: 0; }'
    + '.bkform .qty-btn {'
    + '  width: 26px; height: 26px; border-radius: 50%; border: 1.5px solid var(--line);'
    + '  background: var(--surface, #fff); color: var(--ink); font-size: 16px; line-height: 1;'
    + '  display: flex; align-items: center; justify-content: center; cursor: pointer; -webkit-tap-highlight-color: transparent;'
    + '}'
    + '.bkform .qty-btn:disabled { opacity: 0.35; cursor: not-allowed; }'
    + '.bkform .qty-value { font-size: 14.5px; font-weight: 700; color: var(--ink); min-width: 14px; text-align: center; }'
    + '.bkform .product-subtotal { margin-top: 10px; text-align: right; font-size: 13px; font-weight: 700; color: var(--ink); }'
    + '.bkform .date-field { position: relative; }'
    + '.bkform .date-trigger {'
    + '  width: 100%; display: flex; align-items: center; justify-content: space-between;'
    + '  padding: 12px 14px; font-family: var(--sans); font-size: 15px; text-align: left;'
    + '  color: var(--muted); background: var(--bg); border: 1.5px solid var(--line);'
    + '  border-radius: 12px; cursor: pointer; -webkit-tap-highlight-color: transparent;'
    + '}'
    + '.bkform .date-trigger-text.has-value { color: var(--ink); }'
    + '.bkform .date-trigger-icon { font-size: 14px; opacity: 0.6; }'
    + '.bkform .date-calendar {'
    + '  margin-top: 8px; padding: 12px; background: var(--surface, #fff);'
    + '  border: 1.5px solid var(--line); border-radius: 14px;'
    + '}'
    + '.bkform .cal-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }'
    + '.bkform .cal-month { font-size: 14px; font-weight: 700; color: var(--ink); }'
    + '.bkform .cal-nav {'
    + '  width: 28px; height: 28px; border-radius: 50%; border: none; background: transparent;'
    + '  color: var(--ink); font-size: 17px; line-height: 1; cursor: pointer;'
    + '  display: flex; align-items: center; justify-content: center; -webkit-tap-highlight-color: transparent;'
    + '}'
    + '.bkform .cal-nav:disabled { opacity: 0.25; cursor: not-allowed; }'
    + '.bkform .cal-weekdays { display: grid; grid-template-columns: repeat(7, 1fr); margin-bottom: 4px; }'
    + '.bkform .cal-weekdays span { text-align: center; font-size: 11px; font-weight: 600; color: var(--muted); }'
    + '.bkform .cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; }'
    + '.bkform .cal-day {'
    + '  aspect-ratio: 1; border: none; border-radius: 50%; background: transparent;'
    + '  color: var(--ink); font-size: 13.5px; cursor: pointer; -webkit-tap-highlight-color: transparent;'
    + '}'
    + '.bkform .cal-day.empty { visibility: hidden; cursor: default; }'
    + '.bkform .cal-day.disabled { color: var(--muted); opacity: 0.4; cursor: not-allowed; }'
    + '.bkform .cal-day.blocked { color: var(--error); text-decoration: line-through; opacity: 0.7; background: rgba(192,57,43,0.08); }'
    + '.bkform .cal-legend { margin-top: 8px; font-size: 11px; color: var(--muted); }'
    + '.bkform .notice-text {'
    + '  font-size: 13px; color: var(--muted); line-height: 1.6; white-space: pre-line;'
    + '  padding: 14px; background: var(--bg); border: 1.5px solid var(--line); border-radius: 12px;'
    + '}'
    + '.bkform .agreement-row {'
    + '  display: flex; align-items: flex-start; gap: 10px; padding: 12px 14px;'
    + '  background: var(--bg); border: 1.5px solid var(--line); border-radius: 12px; cursor: pointer;'
    + '}'
    + '.bkform .agreement-row input[type="checkbox"] { margin-top: 2px; flex-shrink: 0; width: 17px; height: 17px; }'
    + '.bkform .agreement-row span { font-size: 14px; color: var(--ink); line-height: 1.4; }'
    + '.bkform .cond-wrap.hidden { display: none !important; }'
    + '.bkform .error-text { font-size: 12px; color: var(--error); margin-top: 6px; display: none; }'
    + '.bkform .error-text.show { display: block; }'
    + '.bkform .btn-submit {'
    + '  display: flex; align-items: center; justify-content: center;'
    + '  width: 100%; height: 52px; margin-top: 26px;'
    + '  background: var(--accent); color: var(--accent-fg);'
    + '  font-size: 15px; font-weight: 700;'
    + '  border-radius: 9999px; border: none; cursor: pointer;'
    + '}'
    + '.bkform .btn-submit:disabled { opacity: 0.5; cursor: not-allowed; }'
    + '.bkform .btn-submit:active:not(:disabled) { opacity: 0.85; }'
    + '.bkform .submit-status { margin-top: 12px; text-align: center; font-size: 13px; color: var(--error); min-height: 16px; }'
    + '.bkform .pickup-note { margin-top: 16px; text-align: center; font-size: 12px; color: var(--muted); line-height: 1.5; }'
    + '.bkform .success-state { text-align: center; padding: 30px 0; }'
    + '.bkform .success-state .icon {'
    + '  width: 54px; height: 54px; border-radius: 50%; background: #3FA672; color: #fff;'
    + '  display: flex; align-items: center; justify-content: center; font-size: 26px; margin: 0 auto;'
    + '}'
    + '.bkform .success-state h2 { font-size: 20px; font-weight: 700; color: var(--ink); margin-top: 16px; }'
    + '.bkform .success-state p { font-size: 14px; color: var(--bio, var(--muted)); margin-top: 10px; line-height: 1.6; }'
    + '.bkform .not-found { text-align: center; color: var(--muted); padding: 40px 0; }'
    + '.bkform .not-found h2 { font-size: 18px; margin-bottom: 8px; color: var(--ink); }'
    + '.grecaptcha-badge { visibility: hidden; }';

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const tag = document.createElement('style');
    tag.id = STYLE_ID;
    tag.textContent = CSS;
    document.head.appendChild(tag);
  }

  // Loaded lazily (only pages that actually mount a form pay for it), and
  // only once even if mount() is somehow called more than once.
  function ensureRecaptcha(siteKey) {
    if (document.querySelector('script[data-bkform-recaptcha]')) return;
    const tag = document.createElement('script');
    tag.src = 'https://www.google.com/recaptcha/enterprise.js?render=' + encodeURIComponent(siteKey);
    tag.setAttribute('data-bkform-recaptcha', '1');
    document.head.appendChild(tag);
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  function mount(opts) {
    const card = opts.container;
    if (!card) return;
    const SUPABASE_URL = opts.supabaseUrl;
    const ANON_KEY = opts.anonKey;
    const bakerId = opts.bakerId;
    const itemId = opts.itemId;
    const formId = opts.formId;
    const itemName = opts.itemName || 'this item';
    // Standalone = this IS the whole page (custom-order.html's click-through
    // case) — shows the "Custom Order Request" heading and sets the page
    // title. Embedded (baker/index.html's storefront takeover) leaves both
    // to the host page, which already has its own heading/title.
    const standalone = opts.standalone !== false;
    const recaptchaSiteKey = opts.recaptchaSiteKey || RECAPTCHA_SITE_KEY;
    const recaptchaAction = opts.recaptchaAction || RECAPTCHA_ACTION;

    ensureStyles();
    ensureRecaptcha(recaptchaSiteKey);
    card.classList.add('bkform');

    if (!bakerId || !itemId || !formId) {
      showNotFound('Link not found', 'This custom order link appears to be invalid.');
      return;
    }

    if (standalone) document.title = 'Request a Custom Order — ' + itemName;

    card.innerHTML = '<div class="bkform-eyebrow">Loading…</div>';

    const fieldsFetch = fetch(SUPABASE_URL + '/rest/v1/intake_form_fields?form_id=eq.' + encodeURIComponent(formId) +
          '&select=id,position,field_type,label,help_text,is_required,options,product_options,condition_field_id,condition_values&order=position.asc', {
      headers: { 'apikey': ANON_KEY, 'Authorization': 'Bearer ' + ANON_KEY }
    }).then(function (r) { return r.json(); });

    // Isolated failure — if this one request fails, the form still loads with
    // every day open, same as before this existed. Not essential like fields above.
    const unavailableFetch = fetch(SUPABASE_URL + '/rest/v1/baker_unavailable_dates?user_id=eq.' + encodeURIComponent(bakerId) +
          '&select=date', {
      headers: { 'apikey': ANON_KEY, 'Authorization': 'Bearer ' + ANON_KEY }
    }).then(function (r) { return r.json(); }).catch(function () { return []; });

    Promise.all([fieldsFetch, unavailableFetch])
    .then(function (results) {
      const fields = results[0];
      const unavailableRows = results[1];
      if (Array.isArray(unavailableRows)) {
        unavailableRows.forEach(function (row) { if (row && row.date) blockedDateKeys.add(row.date); });
      }
      if (!Array.isArray(fields) || fields.length === 0) {
        showNotFound('Form not found', 'This baker hasn\'t set up a custom order form for this item yet.');
        return;
      }
      standardContact = detectStandardContactFields(fields);
      renderForm(fields);
    })
    .catch(function () {
      showNotFound('Something went wrong', 'Could not load this form. Please try again later.');
    });

    function showNotFound(title, subtitle) {
      card.innerHTML = '<div class="not-found"><h2>' + escapeHtml(title) + '</h2><p>' + escapeHtml(subtitle) + '</p></div>';
    }

    // ── Answer state ──────────────────────────────────────────────────────
    const photoState = {}; // fieldId -> [{filename, contentType, base64, previewUrl}]
    const productQtyState = {}; // fieldId -> { optionId: quantity }
    const touched = {};
    let standardContact = null; // see detectStandardContactFields
    const blockedDateKeys = new Set(); // "yyyy-MM-dd" days the baker has marked unavailable
    const dateFieldState = {}; // fieldId -> { displayedMonth: Date }
    // Kept in memory rather than as HTML data-* attributes — a label/option
    // value containing a quote could otherwise break out of an attribute.
    const fieldsById = {}; // fieldId -> field object, for looking up a trigger's type
    const fieldConditions = {}; // fieldId -> { triggerId, values: [] }, only for fields that have one

    // Every form built in the app's builder is seeded with a real "Customer
    // Details" heading + First Name/Last Name/Email/Phone Number fields
    // (IntakeFormBuilderView.swift's defaultCustomerDetailsFields) — the exact
    // same info this page already collects above in its own fixed block. Left
    // unchecked, a customer sees both: fill in their name/email/phone once,
    // then get asked again immediately as "the form" begins. This detects that
    // standard block (by its default labels, right after the heading) and
    // hides those specific fields from the dynamic render below, feeding their
    // answers from the fixed block's own inputs at submit time instead. Any
    // field the baker renamed, removed, or reordered past a gap falls through
    // and just renders normally — this only ever hides an exact match.
    function detectStandardContactFields(fields) {
      if (!fields.length || fields[0].field_type !== 'heading' ||
          fields[0].label.trim().toLowerCase() !== 'customer details') {
        return null;
      }
      const wanted = { 'first name': 'firstName', 'last name': 'lastName', 'email': 'email', 'phone number': 'phone' };
      const matched = {};
      const matchedIds = {};
      matchedIds[fields[0].id] = true;
      for (let i = 1; i < fields.length; i++) {
        const slot = wanted[fields[i].label.trim().toLowerCase()];
        if (!slot || matched[slot]) break;
        matched[slot] = fields[i];
        matchedIds[fields[i].id] = true;
      }
      if (!matched.firstName || !matched.lastName || !matched.email || !matched.phone) return null;
      return { matched: matched, matchedIds: matchedIds };
    }

    function isHiddenStandardField(field) {
      return !!(standardContact && standardContact.matchedIds[field.id]);
    }

    function renderForm(fields) {
      let html = '';
      if (standalone) {
        html +=
          '<div class="bkform-eyebrow">Custom Order Request</div>' +
          '<div class="bkform-item-name">' + escapeHtml(itemName) + '</div>' +
          '<div class="bkform-lede">Tell the baker what you have in mind. They\'ll follow up with a quote directly.</div>';
      }

      html +=
        '<div class="field-group">' +
          '<label class="field-label">First name <span class="field-required">*</span></label>' +
          '<input type="text" id="f-first-name" data-touch="first-name" />' +
          '<div class="error-text" id="err-first-name">Please enter your first name.</div>' +
        '</div>' +
        '<div class="field-group">' +
          '<label class="field-label">Last name <span class="field-required">*</span></label>' +
          '<input type="text" id="f-last-name" data-touch="last-name" />' +
          '<div class="error-text" id="err-last-name">Please enter your last name.</div>' +
        '</div>' +
        '<div class="field-group">' +
          '<label class="field-label">Email <span class="field-required">*</span></label>' +
          '<input type="email" id="f-email" data-touch="email" />' +
          '<div class="error-text" id="err-email">Please enter a valid email address.</div>' +
        '</div>' +
        '<div class="field-group">' +
          '<label class="field-label">Confirm email <span class="field-required">*</span></label>' +
          '<input type="email" id="f-email-confirm" data-touch="email-confirm" onpaste="return false" oncopy="return false" oncut="return false" />' +
          '<div class="error-text" id="err-email-confirm">Those emails don\'t match — please check for typos.</div>' +
        '</div>' +
        '<div class="field-group">' +
          '<label class="field-label">Phone <span class="field-required">*</span></label>' +
          '<input type="tel" id="f-phone" data-touch="phone" />' +
          '<div class="error-text" id="err-phone">Please enter a valid phone number.</div>' +
        '</div>';

      fields.forEach(function (field) {
        fieldsById[field.id] = field;
        if (field.condition_field_id) {
          fieldConditions[field.id] = {
            triggerId: field.condition_field_id,
            values: Array.isArray(field.condition_values) ? field.condition_values : []
          };
        }
      });

      fields.forEach(function (field) {
        if (isHiddenStandardField(field)) return;
        html += wrapConditional(field, renderField(field));
      });

      html += '<button class="btn-submit" id="submit-btn">Send Request</button>' +
              '<div class="submit-status" id="submit-status"></div>' +
              '<div class="pickup-note">📍 Pickup details are provided once the baker confirms your order.</div>';

      card.innerHTML = html;

      ['first-name', 'last-name', 'email', 'email-confirm', 'phone'].forEach(function (key) {
        const input = document.getElementById('f-' + key);
        input.addEventListener('blur', function () { touched[key] = true; validateField(key); });
      });

      fields.forEach(function (field) {
        if (field.field_type === 'heading' || field.field_type === 'notice') return;
        if (isHiddenStandardField(field)) return;
        wireField(field);
      });

      reevaluateConditions();

      document.getElementById('submit-btn').addEventListener('click', function () {
        submit(fields);
      });
    }

    function renderField(field) {
      if (field.field_type === 'heading') {
        return '<div class="field-group"><div class="bkform-item-name" style="font-size:17px;margin-top:4px;">' + escapeHtml(field.label) + '</div></div>';
      }
      if (field.field_type === 'notice') {
        return '<div class="field-group"><div class="notice-text">' + escapeHtml(field.label) + '</div></div>';
      }
      const req = field.is_required ? ' <span class="field-required">*</span>' : '';
      const help = field.help_text ? '<div class="field-help">' + escapeHtml(field.help_text) + '</div>' : '';
      const id = 'field-' + field.id;

      if (field.field_type === 'agreement') {
        return '<div class="field-group">' +
          '<label class="agreement-row" for="' + id + '">' +
            '<input type="checkbox" id="' + id + '" />' +
            '<span>' + escapeHtml(field.label) + req + '</span>' +
          '</label>' +
          help +
          '<div class="error-text" id="err-' + id + '">You must check this box to continue.</div>' +
        '</div>';
      }

      let body = '';
      if (field.field_type === 'short_text' || field.field_type === 'number') {
        body = '<input type="' + (field.field_type === 'number' ? 'number' : 'text') + '" id="' + id + '"' +
          (field.field_type === 'short_text' ? ' maxlength="300"' : '') + ' />';
      } else if (field.field_type === 'long_text') {
        body = '<textarea id="' + id + '" maxlength="2000"></textarea>';
      } else if (field.field_type === 'date') {
        body = '<div class="date-field" id="' + id + '-field">' +
          '<button type="button" class="date-trigger" id="' + id + '-trigger">' +
            '<span class="date-trigger-text" id="' + id + '-text">Select a date</span>' +
            '<span class="date-trigger-icon">📅</span>' +
          '</button>' +
          '<input type="hidden" id="' + id + '" />' +
          '<div class="date-calendar hidden" id="' + id + '-cal"></div>' +
        '</div>';
      } else if (field.field_type === 'time') {
        body = '<input type="time" id="' + id + '" />';
      } else if (field.field_type === 'single_choice' || field.field_type === 'multi_choice') {
        const inputType = field.field_type === 'single_choice' ? 'radio' : 'checkbox';
        const options = Array.isArray(field.options) ? field.options : [];
        body = '<div class="choice-list" id="' + id + '">' +
          options.map(function (opt, i) {
            return '<label class="choice-option" data-opt="' + escapeHtml(opt) + '">' +
              '<input type="' + inputType + '" name="' + id + '" value="' + escapeHtml(opt) + '" />' +
              '<span>' + escapeHtml(opt) + '</span></label>';
          }).join('') +
        '</div>';
      } else if (field.field_type === 'photo') {
        body = '<div class="photo-field" id="' + id + '">' +
          '<label class="photo-add">+<input type="file" accept="image/*" multiple style="display:none;" /></label>' +
        '</div>';
      } else if (field.field_type === 'product_selector') {
        productQtyState[field.id] = {};
        const options = Array.isArray(field.product_options) ? field.product_options : [];
        body = '<div class="product-list" id="' + id + '">' +
          options.map(function (opt) {
            return '<div class="product-item" data-opt="' + escapeHtml(opt.id) + '">' +
              '<div><div class="product-item-name">' + escapeHtml(opt.name) + '</div>' +
              '<div class="product-item-price">$' + Number(opt.price || 0).toFixed(2) + '</div></div>' +
              '<div class="qty-stepper">' +
                '<button type="button" class="qty-btn" data-action="minus" disabled>−</button>' +
                '<span class="qty-value">0</span>' +
                '<button type="button" class="qty-btn" data-action="plus">+</button>' +
              '</div>' +
            '</div>';
          }).join('') +
        '</div><div class="product-subtotal" id="subtotal-' + id + '"></div>';
      }

      return '<div class="field-group">' +
        '<label class="field-label">' + escapeHtml(field.label) + req + '</label>' +
        body + help +
        '<div class="error-text" id="err-' + id + '">This field is required.</div>' +
      '</div>';
    }

    // ── Conditional fields ──────────────────────────────────────────────
    // A field with condition_field_id only shows once an earlier single/multi-
    // choice or item-picker field's answer includes one of condition_values —
    // e.g. a "Cookies" section that only appears once the buyer has picked
    // "Cookies" in an earlier "What would you like to order?" question.

    function wrapConditional(field, innerHtml) {
      if (!field.condition_field_id) return innerHtml;
      // Starts hidden — reevaluateConditions() (called once after wiring, and
      // again on every trigger-field change) is what reveals it.
      return '<div class="cond-wrap hidden" id="condwrap-' + field.id + '">' + innerHtml + '</div>';
    }

    function isFieldVisible(fieldId) {
      const cond = fieldConditions[fieldId];
      if (!cond || !cond.values.length) return true;
      const trigger = fieldsById[cond.triggerId];
      // Trigger field missing (deleted, or stale saved data) — fail open rather
      // than permanently hide a field the baker has no way to fix from here.
      if (!trigger) return true;

      if (trigger.field_type === 'product_selector') {
        const quantities = productQtyState[cond.triggerId] || {};
        return cond.values.some(function (optId) { return (quantities[optId] || 0) > 0; });
      }
      const container = document.getElementById('field-' + cond.triggerId);
      if (!container) return false;
      const checked = Array.from(container.querySelectorAll('input:checked')).map(function (i) { return i.value; });
      return cond.values.some(function (v) { return checked.indexOf(v) !== -1; });
    }

    function reevaluateConditions() {
      Object.keys(fieldConditions).forEach(function (fieldId) {
        const wrapper = document.getElementById('condwrap-' + fieldId);
        if (!wrapper) return;
        const visible = isFieldVisible(fieldId);
        const wasHidden = wrapper.classList.contains('hidden');
        wrapper.classList.toggle('hidden', !visible);
        // Only clear when a visible field newly becomes hidden — clearing on
        // every reevaluation would wipe an already-hidden field's state
        // (harmless) but also fire needlessly on every keystroke elsewhere.
        if (!visible && !wasHidden) clearFieldValue(fieldId);
      });
    }

    // Resets a field's own inputs/state when its section becomes hidden, so
    // flipping the trigger back and forth can't leave a stale answer behind
    // that the buyer never actually confirmed while the field was visible.
    function clearFieldValue(fieldId) {
      const field = fieldsById[fieldId];
      if (!field) return;
      const id = 'field-' + fieldId;
      touched[id] = false;
      const err = document.getElementById('err-' + id);
      if (err) err.classList.remove('show');

      if (field.field_type === 'single_choice' || field.field_type === 'multi_choice') {
        const container = document.getElementById(id);
        if (container) {
          container.querySelectorAll('input').forEach(function (i) { i.checked = false; });
          container.querySelectorAll('.choice-option').forEach(function (el) { el.classList.remove('selected'); });
        }
      } else if (field.field_type === 'photo') {
        photoState[fieldId] = [];
        renderPhotoThumbs(field);
      } else if (field.field_type === 'product_selector') {
        productQtyState[fieldId] = {};
        const container = document.getElementById(id);
        if (container) {
          container.querySelectorAll('.qty-value').forEach(function (el) { el.textContent = '0'; });
          container.querySelectorAll('[data-action="minus"]').forEach(function (btn) { btn.disabled = true; });
        }
        updateProductSubtotal(field);
      } else if (field.field_type === 'agreement' || field.field_type === 'date' || field.field_type === 'time') {
        const el = document.getElementById(id);
        if (el) { el.value = ''; if ('checked' in el) el.checked = false; }
        const textEl = document.getElementById(id + '-text');
        if (textEl) { textEl.textContent = 'Select a date'; textEl.classList.remove('has-value'); }
      } else {
        const el = document.getElementById(id);
        if (el) el.value = '';
      }
    }

    function wireField(field) {
      const id = 'field-' + field.id;
      if (field.field_type === 'single_choice' || field.field_type === 'multi_choice') {
        const container = document.getElementById(id);
        container.querySelectorAll('input').forEach(function (input) {
          input.addEventListener('change', function () {
            if (field.field_type === 'single_choice') {
              container.querySelectorAll('.choice-option').forEach(function (el) { el.classList.remove('selected'); });
            }
            input.closest('.choice-option').classList.toggle('selected', input.checked);
            touched[id] = true;
            validateCustomField(field);
            reevaluateConditions();
          });
        });
      } else if (field.field_type === 'photo') {
        photoState[field.id] = [];
        const container = document.getElementById(id);
        const fileInput = container.querySelector('input[type="file"]');
        fileInput.addEventListener('change', function (e) {
          handlePhotoFiles(field, Array.from(e.target.files || []));
          fileInput.value = '';
        });
      } else if (field.field_type === 'product_selector') {
        wireProductSelector(field);
      } else if (field.field_type === 'date') {
        wireDateField(field);
      } else if (field.field_type === 'agreement') {
        const input = document.getElementById(id);
        input.addEventListener('change', function () { touched[id] = true; validateCustomField(field); });
      } else {
        const input = document.getElementById(id);
        input.addEventListener('blur', function () { touched[id] = true; validateCustomField(field); });
      }
    }

    // ── Date field (calendar picker) ────────────────────────────────────

    function toDateKey(d) {
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }

    function wireDateField(field) {
      const id = 'field-' + field.id;
      const today = new Date(); today.setHours(0, 0, 0, 0);
      dateFieldState[field.id] = { displayedMonth: new Date(today.getFullYear(), today.getMonth(), 1) };

      document.getElementById(id + '-trigger').addEventListener('click', function (e) {
        e.stopPropagation();
        const cal = document.getElementById(id + '-cal');
        const willOpen = cal.classList.contains('hidden');
        document.querySelectorAll('.date-calendar').forEach(function (el) { el.classList.add('hidden'); });
        if (willOpen) {
          renderDateCalendar(field);
          cal.classList.remove('hidden');
        }
      });
    }

    // Closes any open calendar when clicking elsewhere on the page.
    document.addEventListener('click', function (e) {
      document.querySelectorAll('.date-field').forEach(function (wrapper) {
        if (!wrapper.contains(e.target)) {
          const cal = wrapper.querySelector('.date-calendar');
          if (cal) cal.classList.add('hidden');
        }
      });
    });

    function renderDateCalendar(field) {
      const id = 'field-' + field.id;
      const state = dateFieldState[field.id];
      const container = document.getElementById(id + '-cal');
      const month = state.displayedMonth;
      const today = new Date(); today.setHours(0, 0, 0, 0);

      const firstOfMonth = new Date(month.getFullYear(), month.getMonth(), 1);
      const startWeekday = firstOfMonth.getDay();
      const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
      const monthLabel = firstOfMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
      const canGoPrev = month.getFullYear() > today.getFullYear() ||
        (month.getFullYear() === today.getFullYear() && month.getMonth() > today.getMonth());

      let hasBlockedDay = false;
      let html = '<div class="cal-header">' +
          '<button type="button" class="cal-nav" data-dir="-1"' + (canGoPrev ? '' : ' disabled') + '>‹</button>' +
          '<span class="cal-month">' + escapeHtml(monthLabel) + '</span>' +
          '<button type="button" class="cal-nav" data-dir="1">›</button>' +
        '</div>' +
        '<div class="cal-weekdays">' + ['S', 'M', 'T', 'W', 'T', 'F', 'S'].map(function (d) { return '<span>' + d + '</span>'; }).join('') + '</div>' +
        '<div class="cal-grid">';

      for (let i = 0; i < startWeekday; i++) html += '<button type="button" class="cal-day empty" disabled></button>';
      for (let day = 1; day <= daysInMonth; day++) {
        const d = new Date(month.getFullYear(), month.getMonth(), day);
        const key = toDateKey(d);
        const past = d < today;
        const blocked = blockedDateKeys.has(key);
        if (blocked) hasBlockedDay = true;
        const disabled = past || blocked;
        html += '<button type="button" class="cal-day' + (blocked ? ' blocked' : (disabled ? ' disabled' : '')) +
          '" data-key="' + key + '"' + (disabled ? ' disabled' : '') + '>' + day + '</button>';
      }
      html += '</div>';
      if (hasBlockedDay) {
        html += '<div class="cal-legend">Crossed-out days — baker unavailable</div>';
      }

      container.innerHTML = html;

      container.querySelectorAll('.cal-nav').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
          e.stopPropagation();
          if (btn.disabled) return;
          const dir = parseInt(btn.dataset.dir, 10);
          state.displayedMonth = new Date(state.displayedMonth.getFullYear(), state.displayedMonth.getMonth() + dir, 1);
          renderDateCalendar(field);
        });
      });

      container.querySelectorAll('.cal-day:not(.empty):not(.disabled):not(.blocked)').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
          e.stopPropagation();
          selectDate(field, btn.dataset.key);
        });
      });
    }

    function selectDate(field, key) {
      const id = 'field-' + field.id;
      document.getElementById(id).value = key;
      const d = new Date(key + 'T00:00:00');
      const textEl = document.getElementById(id + '-text');
      textEl.textContent = d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
      textEl.classList.add('has-value');
      document.getElementById(id + '-cal').classList.add('hidden');
      touched[id] = true;
      validateCustomField(field);
    }

    function handlePhotoFiles(field, files) {
      const remaining = MAX_PHOTOS - photoState[field.id].length;
      files.slice(0, remaining).forEach(function (file) {
        resizeImage(file, function (base64, previewUrl) {
          photoState[field.id].push({ filename: file.name, contentType: 'image/jpeg', base64: base64, previewUrl: previewUrl });
          renderPhotoThumbs(field);
        });
      });
      touched['field-' + field.id] = true;
    }

    function renderPhotoThumbs(field) {
      const container = document.getElementById('field-' + field.id);
      const photos = photoState[field.id];
      let html = photos.map(function (p, i) {
        return '<div class="photo-thumb"><img src="' + p.previewUrl + '" /><button type="button" class="photo-remove" data-idx="' + i + '">×</button></div>';
      }).join('');
      if (photos.length < MAX_PHOTOS) {
        html += '<label class="photo-add">+<input type="file" accept="image/*" multiple style="display:none;" /></label>';
      }
      container.innerHTML = html;
      container.querySelectorAll('.photo-remove').forEach(function (btn) {
        btn.addEventListener('click', function () {
          photos.splice(parseInt(btn.dataset.idx, 10), 1);
          renderPhotoThumbs(field);
        });
      });
      const fileInput = container.querySelector('input[type="file"]');
      if (fileInput) {
        fileInput.addEventListener('change', function (e) {
          handlePhotoFiles(field, Array.from(e.target.files || []));
          fileInput.value = '';
        });
      }
      validateCustomField(field);
    }

    function wireProductSelector(field) {
      const id = 'field-' + field.id;
      const container = document.getElementById(id);
      const options = Array.isArray(field.product_options) ? field.product_options : [];
      const byId = {};
      options.forEach(function (opt) { byId[opt.id] = opt; });

      container.querySelectorAll('.product-item').forEach(function (row) {
        const optId = row.dataset.opt;
        const opt = byId[optId];
        const qtyEl = row.querySelector('.qty-value');
        const minusBtn = row.querySelector('[data-action="minus"]');
        const plusBtn = row.querySelector('[data-action="plus"]');

        function render() {
          const qty = productQtyState[field.id][optId] || 0;
          qtyEl.textContent = String(qty);
          minusBtn.disabled = qty <= 0;
          plusBtn.disabled = opt.max_quantity > 0 && qty >= opt.max_quantity;
        }

        minusBtn.addEventListener('click', function () {
          const qty = productQtyState[field.id][optId] || 0;
          if (qty <= 0) return;
          productQtyState[field.id][optId] = qty - 1;
          render();
          touched[id] = true;
          updateProductSubtotal(field);
          validateCustomField(field);
          reevaluateConditions();
        });
        plusBtn.addEventListener('click', function () {
          const qty = productQtyState[field.id][optId] || 0;
          if (opt.max_quantity > 0 && qty >= opt.max_quantity) return;
          productQtyState[field.id][optId] = qty + 1;
          render();
          touched[id] = true;
          updateProductSubtotal(field);
          validateCustomField(field);
          reevaluateConditions();
        });

        render();
      });
    }

    function updateProductSubtotal(field) {
      const options = Array.isArray(field.product_options) ? field.product_options : [];
      const quantities = productQtyState[field.id] || {};
      let subtotal = 0;
      options.forEach(function (opt) { subtotal += (Number(opt.price) || 0) * (quantities[opt.id] || 0); });
      const el = document.getElementById('subtotal-field-' + field.id);
      if (!el) return;
      el.textContent = subtotal > 0 ? 'Subtotal: $' + subtotal.toFixed(2) : '';
    }

    function resizeImage(file, cb) {
      const reader = new FileReader();
      reader.onload = function (e) {
        const img = new Image();
        img.onload = function () {
          let w = img.width, h = img.height;
          if (w > MAX_PHOTO_DIMENSION || h > MAX_PHOTO_DIMENSION) {
            const scale = MAX_PHOTO_DIMENSION / Math.max(w, h);
            w = Math.round(w * scale); h = Math.round(h * scale);
          }
          const canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          const dataUrl = canvas.toDataURL('image/jpeg', PHOTO_QUALITY);
          cb(dataUrl.split(',')[1], dataUrl);
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    }

    // ── Validation ───────────────────────────────────────────────────────
    const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
    const PHONE_RE = /^[0-9+()\-.\s]{7,20}$/;

    function validateField(key) {
      if (!touched[key]) return true;
      let ok = true;
      const el = document.getElementById('f-' + key);
      const err = document.getElementById('err-' + key);
      if (key === 'first-name' || key === 'last-name') ok = el.value.trim().length > 0;
      if (key === 'email') ok = EMAIL_RE.test(el.value.trim());
      // A single mistyped character in the domain (e.g. .ckm instead of .com)
      // still passes EMAIL_RE, so the confirmation email silently never
      // arrives. Requiring the address twice catches that class of typo.
      if (key === 'email-confirm') {
        const emailEl = document.getElementById('f-email');
        ok = el.value.trim().toLowerCase() === emailEl.value.trim().toLowerCase() && el.value.trim().length > 0;
      }
      if (key === 'phone') ok = PHONE_RE.test(el.value.trim());
      err.classList.toggle('show', !ok);
      el.classList.toggle('field-error', !ok);
      return ok;
    }

    function fieldIsBlank(field) {
      const id = 'field-' + field.id;
      if (field.field_type === 'single_choice' || field.field_type === 'multi_choice') {
        const container = document.getElementById(id);
        return container.querySelectorAll('input:checked').length === 0;
      }
      if (field.field_type === 'photo') {
        return (photoState[field.id] || []).length === 0;
      }
      if (field.field_type === 'product_selector') {
        const quantities = productQtyState[field.id] || {};
        return !Object.keys(quantities).some(function (k) { return quantities[k] > 0; });
      }
      if (field.field_type === 'agreement') {
        const el = document.getElementById(id);
        return !el || !el.checked;
      }
      const el = document.getElementById(id);
      return !el || el.value.trim() === '';
    }

    function validateCustomField(field) {
      const id = 'field-' + field.id;
      if (!touched[id]) return true;
      const ok = field.field_type === 'heading' || field.field_type === 'notice' || !field.is_required
        || !isFieldVisible(field.id) || !fieldIsBlank(field);
      const err = document.getElementById('err-' + id);
      if (err) err.classList.toggle('show', !ok);
      return ok;
    }

    function submit(fields) {
      ['first-name', 'last-name', 'email', 'email-confirm', 'phone'].forEach(function (k) { touched[k] = true; });
      fields.forEach(function (f) { if (f.field_type !== 'heading' && f.field_type !== 'notice' && !isHiddenStandardField(f) && isFieldVisible(f.id)) touched['field-' + f.id] = true; });

      let valid = true;
      ['first-name', 'last-name', 'email', 'email-confirm', 'phone'].forEach(function (k) { if (!validateField(k)) valid = false; });
      fields.forEach(function (f) { if (f.field_type !== 'heading' && f.field_type !== 'notice' && !isHiddenStandardField(f) && !validateCustomField(f)) valid = false; });

      if (!valid) return;

      const submitBtn = document.getElementById('submit-btn');
      const status = document.getElementById('submit-status');
      submitBtn.disabled = true;
      status.textContent = '';
      status.style.color = '';

      const answers = fields.filter(function (f) {
        return f.field_type !== 'heading' && f.field_type !== 'notice' && isFieldVisible(f.id);
      }).map(function (field) {
        const id = 'field-' + field.id;
        // Not rendered (see isHiddenStandardField) — its answer comes from the
        // fixed name/email/phone block above instead of a matching DOM input.
        if (standardContact) {
          if (standardContact.matched.firstName.id === field.id) {
            return { fieldID: field.id, label: field.label, fieldType: field.field_type, textValue: document.getElementById('f-first-name').value.trim() };
          }
          if (standardContact.matched.lastName.id === field.id) {
            return { fieldID: field.id, label: field.label, fieldType: field.field_type, textValue: document.getElementById('f-last-name').value.trim() };
          }
          if (standardContact.matched.email.id === field.id) {
            return { fieldID: field.id, label: field.label, fieldType: field.field_type, textValue: document.getElementById('f-email').value.trim() };
          }
          if (standardContact.matched.phone.id === field.id) {
            return { fieldID: field.id, label: field.label, fieldType: field.field_type, textValue: document.getElementById('f-phone').value.trim() };
          }
        }
        if (field.field_type === 'single_choice' || field.field_type === 'multi_choice') {
          const container = document.getElementById(id);
          const values = Array.from(container.querySelectorAll('input:checked')).map(function (i) { return i.value; });
          return { fieldID: field.id, label: field.label, fieldType: field.field_type, choiceValues: values };
        }
        if (field.field_type === 'photo') {
          const photos = (photoState[field.id] || []).map(function (p) {
            return { filename: p.filename, contentType: p.contentType, base64: p.base64 };
          });
          return { fieldID: field.id, label: field.label, fieldType: field.field_type, photos: photos };
        }
        if (field.field_type === 'product_selector') {
          const quantities = productQtyState[field.id] || {};
          // Server re-derives name/unitPrice from the field's own stored product_options
          // (see submit-custom-order-inquiry) — quantities are the only thing trusted from here.
          const selections = Object.keys(quantities)
            .filter(function (k) { return quantities[k] > 0; })
            .map(function (k) { return { id: k, quantity: quantities[k] }; });
          return { fieldID: field.id, label: field.label, fieldType: field.field_type, productSelections: selections };
        }
        if (field.field_type === 'agreement') {
          const el = document.getElementById(id);
          return { fieldID: field.id, label: field.label, fieldType: field.field_type, choiceValues: (el && el.checked) ? ['agreed'] : [] };
        }
        return { fieldID: field.id, label: field.label, fieldType: field.field_type, textValue: document.getElementById(id).value.trim() };
      });

      getRecaptchaToken(recaptchaSiteKey, recaptchaAction).then(function (token) {
        return fetch(SUPABASE_URL + '/functions/v1/submit-custom-order-inquiry', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': ANON_KEY,
            'Authorization': 'Bearer ' + ANON_KEY
          },
          body: JSON.stringify({
            baker_id: bakerId,
            menu_item_id: itemId,
            customer_name: (document.getElementById('f-first-name').value.trim() + ' ' + document.getElementById('f-last-name').value.trim()).trim(),
            customer_email: document.getElementById('f-email').value.trim(),
            customer_phone: document.getElementById('f-phone').value.trim(),
            answers: answers,
            recaptcha_token: token
          })
        });
      })
      .then(function (r) { return r.json().then(function (data) { return { ok: r.ok, data: data }; }); })
      .then(function (result) {
        if (result.ok && result.data && result.data.ok) {
          showSuccess();
        } else {
          submitBtn.disabled = false;
          status.textContent = (result.data && result.data.error) || 'Something went wrong. Please try again.';
        }
      })
      .catch(function () {
        submitBtn.disabled = false;
        status.textContent = 'Something went wrong. Please check your connection and try again.';
      });
    }

    function showSuccess() {
      card.innerHTML =
        '<div class="success-state">' +
          '<div class="icon">✓</div>' +
          '<h2>Request sent!</h2>' +
          '<p>' + escapeHtml(itemName) + ' — the baker will follow up with you by email or phone with a quote.</p>' +
        '</div>';
    }
  }

  function getRecaptchaToken(siteKey, action) {
    return new Promise(function (resolve, reject) {
      // The script tag is inserted by ensureRecaptcha() at mount() time, but
      // may still be downloading — poll briefly rather than failing the very
      // first submit attempt on a slow connection.
      const deadline = Date.now() + 8000;
      (function poll() {
        if (typeof grecaptcha !== 'undefined' && grecaptcha.enterprise) {
          grecaptcha.enterprise.ready(function () {
            grecaptcha.enterprise.execute(siteKey, { action: action }).then(resolve, reject);
          });
          return;
        }
        if (Date.now() > deadline) { reject(new Error('reCAPTCHA did not load')); return; }
        setTimeout(poll, 200);
      })();
    });
  }

  window.BakeriIntakeForm = { mount: mount };
})();
