// Bakeri website analytics — first-party, no third-party service.
// Sends page views, CTA clicks, sign-up form submits and scroll depth to
// log_site_event() (migration 20261031000001_site_analytics); the Bakeri
// Admin app's Website screen reads them. No cookies: a random id in
// localStorage, and the server swaps in a daily hash for EU/UK visitors.
// Links/buttons can name themselves with data-track="label".
(function () {
  try {
    var URL_ = 'https://aqhebjxaynvtvurwedrl.supabase.co/rest/v1/rpc/log_site_event';
    var KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFxaGVianhheW52dHZ1cndlZHJsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4MTgwOTMsImV4cCI6MjA5MTM5NDA5M30.XgkgwDM5nyrmoJtNNNRDiBQePcBFGew13TbK76y_aOI';
    if (navigator.webdriver || /[?&]notrack=1/.test(location.search)) return;

    function store(kind, key, make) {
      try { var s = window[kind]; var v = s.getItem(key); if (!v) { v = make(); s.setItem(key, v); } return v; }
      catch (e) { return make(); }
    }
    function uuid() {
      if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        var r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16);
      });
    }
    var visitor = store('localStorage', 'bk_vid', uuid);
    var session = store('sessionStorage', 'bk_sid', uuid);

    // First-touch attribution for the session: UTM tags, referrer, ?ref= code.
    var q = new URLSearchParams(location.search);
    var attr;
    try { attr = JSON.parse(sessionStorage.getItem('bk_attr') || 'null'); } catch (e) { attr = null; }
    if (!attr) {
      attr = {
        referrer: document.referrer || '',
        source: q.get('utm_source') || '', medium: q.get('utm_medium') || '',
        campaign: q.get('utm_campaign') || '', ref: q.get('ref') || ''
      };
      try { sessionStorage.setItem('bk_attr', JSON.stringify(attr)); } catch (e) {}
    } else if (q.get('ref') && !attr.ref) {
      attr.ref = q.get('ref');
      try { sessionStorage.setItem('bk_attr', JSON.stringify(attr)); } catch (e) {}
    }

    function send(event, ref) {
      try {
        var body = JSON.stringify({
          p_event: event, p_path: location.pathname, p_ref: ref == null ? null : String(ref),
          p_referrer: attr.referrer || null, p_source: attr.source || null, p_medium: attr.medium || null,
          p_campaign: attr.campaign || null, p_ref_code: attr.ref || null,
          p_session: session, p_visitor: visitor
        });
        fetch(URL_, {
          method: 'POST', keepalive: true, body: body,
          headers: { 'Content-Type': 'application/json', apikey: KEY, Authorization: 'Bearer ' + KEY }
        }).catch(function () {});
      } catch (e) {}
    }
    window.bakeriTrack = send;

    send('page_view');

    document.addEventListener('click', function (e) {
      var a = e.target && e.target.closest && e.target.closest('a,button');
      if (!a) return;
      var label = a.getAttribute('data-track');
      var href = a.getAttribute('href') || '';
      var isCta = label || a.classList.contains('btn') || /\/app\/(signup|login|refer)/.test(href);
      if (!isCta) return;
      if (!label) label = (a.textContent || '').replace(/\s+/g, ' ').replace(/[→›»]/g, '').trim().slice(0, 60);
      send('cta_click', label);
    }, true);

    document.addEventListener('submit', function (e) {
      var f = e.target;
      if (f && f.querySelector && f.querySelector('input[type=email]')) send('signup_form', f.id || 'email');
    }, true);

    var marks = [25, 50, 75, 100], hit = {};
    function onScroll() {
      var h = document.documentElement.scrollHeight - innerHeight;
      var pct = h <= 0 ? 100 : Math.round(scrollY / h * 100);
      for (var i = 0; i < marks.length; i++) {
        if (pct >= marks[i] && !hit[marks[i]]) { hit[marks[i]] = 1; send('scroll_depth', marks[i]); }
      }
    }
    addEventListener('scroll', onScroll, { passive: true });
  } catch (e) {}
})();
