// Bundled copy the edge function actually sends. Deliberately mirrors
// send-guest-quote-email's inline HTML (plain white background, tan info
// box, black pill button, "copy this link" fallback) almost line-for-line —
// a guest sees the quote email first, then this one for a deposit/balance
// invoice, and the two used to look like they came from different apps (see
// 2026-08-07 balance-invoice styling fix). This is a plain HTML fragment,
// not a full document, matching that file's approach — no separate
// hero/footer chrome to keep in sync with it.

export const INVOICE_EMAIL_TEMPLATE = `
  <div style="font-family:-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#241712;">
    <h2 style="margin:0 0 8px;">{{heading}}</h2>
    <p style="line-height:1.5;">{{greeting}}</p>
    <p style="line-height:1.5;color:#6B5F54;">
      {{baker_name}} has sent you {{invoice_phrase}}.
    </p>
    <div style="margin:18px 0;padding:14px 16px;background:#F7F2E9;border-radius:10px;">
      <div style="font-size:11.5px;font-weight:700;letter-spacing:.02em;color:#A89B8C;text-transform:uppercase;margin-bottom:6px;">For</div>
      <div style="font-size:13.5px;">{{items_list}}</div>
      {{due_date_line}}
    </div>
    <table style="width:100%;border-collapse:collapse;font-size:13.5px;margin-top:16px;">
      <tr>
        <td style="padding:10px 0 0;font-weight:700;">Total</td>
        <td style="padding:10px 0 0;text-align:right;font-weight:700;">{{amount}}</td>
      </tr>
    </table>
    <div style="text-align:center;margin:28px 0;">
      <a href="{{pay_url}}" style="display:inline-block;background:#241712;color:#fff;text-decoration:none;padding:14px 28px;border-radius:10px;font-weight:600;">
        Pay {{amount}}
      </a>
    </div>
    <p style="color:#A89B8C;font-size:12px;line-height:1.5;">
      Or copy this link into your browser: {{pay_url}}
    </p>
    <p style="color:#A89B8C;font-size:11.5px;line-height:1.5;margin-top:20px;border-top:1px solid #E4D9C8;padding-top:16px;">
      This invoice is provided directly by {{baker_name}}, who is solely
      responsible for preparing and fulfilling your order. If you have any
      questions about it, reach out to {{baker_name}} directly.
    </p>
  </div>
`;
