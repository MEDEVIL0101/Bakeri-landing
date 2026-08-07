// Bundled copy the edge function actually sends — mirrors the visual style
// of send-vendor-ack-email/template.ts for brand consistency.

export const INVOICE_EMAIL_TEMPLATE = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Invoice from {{baker_name}} — Bakerï</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      background-color: #f3ecdd;
      font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
      color: #2c2530;
      -webkit-font-smoothing: antialiased;
    }

    .wrapper { max-width: 600px; margin: 0 auto; padding: 40px 20px; }

    .header {
      text-align: center;
      padding: 36px 40px 32px;
      background-color: #fffeec;
      border-radius: 8px 8px 0 0;
      border-bottom: 1px solid #ece3d5;
    }
    .wordmark { font-size: 24px; font-weight: 800; letter-spacing: -0.01em; color: #14110e; }
    .wordmark span { color: #e15b81; }

    .hero { background-color: #e15b81; padding: 44px 48px; text-align: left; }
    .hero-badge {
      display: inline-block; background-color: rgba(255,255,255,0.2); color: #ffffff;
      font-size: 10px; font-weight: 700; letter-spacing: 0.2em; text-transform: uppercase;
      padding: 5px 14px; border-radius: 999px; margin-bottom: 18px;
    }
    .hero h1 { font-size: 30px; font-weight: 800; line-height: 1.25; letter-spacing: -0.01em; color: #ffffff; }

    .body { background-color: #ffffff; padding: 48px 48px 40px; }
    p { font-size: 16px; line-height: 1.8; color: #5e5560; margin-bottom: 20px; }
    p strong { color: #2c2530; }

    .summary { background-color: #ffe2e9; border-left: 3px solid #e15b81; border-radius: 0 10px 10px 0; padding: 20px 24px; margin: 28px 0; }
    .summary .amount { font-size: 34px; font-weight: 800; color: #2c2530; margin-bottom: 4px; }
    .summary p { margin: 0; font-size: 14px; color: #5e5560; }
    .summary p + p { margin-top: 4px; }

    .cta-section { text-align: center; margin: 36px 0; padding: 36px 32px; background-color: #c9466c; border-radius: 16px; }
    .cta-section h2 { font-size: 20px; font-weight: 800; letter-spacing: -0.01em; color: #ffffff; margin-bottom: 8px; }
    .cta-section p { font-size: 15px; color: rgba(255,255,255,0.8); margin-bottom: 24px; }
    .cta-button {
      display: inline-block; background-color: #5ce1e6; color: #14110e !important; text-decoration: none;
      font-size: 14px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase;
      padding: 15px 34px; border-radius: 999px;
    }
    .cta-note { font-size: 12px; color: rgba(255,255,255,0.6); margin-top: 14px; margin-bottom: 0; line-height: 1.6; }

    .footer { background-color: #14110e; border-radius: 0 0 8px 8px; padding: 28px 48px; text-align: center; }
    .footer p { font-size: 12px; color: rgba(255,255,255,0.4); margin-bottom: 6px; line-height: 1.6; }
    .footer p:last-child { margin-bottom: 0; }
    .footer a { color: #e79bb0; text-decoration: none; }

    @media (max-width: 480px) {
      .hero { padding: 36px 28px; }
      .body { padding: 36px 28px 32px; }
      .hero h1 { font-size: 24px; }
      .cta-section { padding: 28px 20px; }
      .footer { padding: 24px 28px; }
    }
  </style>
</head>
<body>
  <div class="wrapper">

    <div class="header">
      <div class="wordmark">Baker<span>ï</span></div>
    </div>

    <div class="hero">
      <div class="hero-badge">Invoice</div>
      <h1>{{baker_name}} sent you an invoice{{customer_greeting}}</h1>
    </div>

    <div class="body">
      <p>You can pay this invoice securely online — no account required.</p>

      <div class="summary">
        <div class="amount">{{amount}}</div>
        <p><strong>For:</strong><br>{{items_list}}</p>
        {{due_date_line}}
      </div>

      <div class="cta-section">
        <h2>Ready to pay?</h2>
        <p>Tap below to pay {{baker_name}} through Bakerï.</p>
        <a class="cta-button" href="{{pay_url}}">Pay Invoice →</a>
        <p class="cta-note">Already have the Bakerï app? This link opens straight into it.</p>
      </div>

      <p>If you have any questions about this invoice, reach out to {{baker_name}} directly.</p>
    </div>

    <div class="footer">
      <p>Sent via <a href="https://bakeriapp.com">bakeriapp.com</a> on behalf of {{baker_name}}.</p>
    </div>

  </div>
</body>
</html>
`;
