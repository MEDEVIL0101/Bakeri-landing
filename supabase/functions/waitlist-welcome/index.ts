import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

serve(async (req) => {
  const { record } = await req.json();
  const { name, email } = record;

  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${Deno.env.get("RESEND_API_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "Bakeri <hello@bakeriapp.com>",
      to: email,
      subject: "You're on the list, Baker! 🎉",
      html: `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#FAF5EE;font-family:Georgia,'Times New Roman',serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#FAF5EE;padding:40px 16px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">
        <tr>
          <td align="center" style="padding:40px 40px 32px;background:#8B1A18;border-radius:12px 12px 0 0;">
            <img src="https://bakeriapp.com/wordmark.png" alt="Bakeri" width="160" style="display:block;margin:0 auto;filter:brightness(0) invert(1);" />
          </td>
        </tr>
        <tr>
          <td style="background:#6B1212;padding:12px 40px;text-align:center;">
            <p style="margin:0;color:#E5BB74;font-size:11px;letter-spacing:3px;text-transform:uppercase;font-family:Arial,sans-serif;">First Batch · Founding Baker</p>
          </td>
        </tr>
        <tr>
          <td style="background:#FFFFFF;padding:48px 40px 40px;border-left:1px solid #E9DAC4;border-right:1px solid #E9DAC4;">
            <h1 style="margin:0 0 8px;font-size:32px;font-style:italic;font-weight:400;color:#1A0808;line-height:1.2;">You're in, ${name.trim()}.</h1>
            <p style="margin:0 0 32px;font-size:13px;letter-spacing:2px;text-transform:uppercase;color:#C9963A;font-family:Arial,sans-serif;">Welcome to the waitlist</p>
            <p style="margin:0 0 20px;font-size:16px;line-height:1.7;color:#3A1212;font-family:Arial,sans-serif;">We're saving your spot among the first 2,500 Founding Bakers. That means early access, a free 30-day trial, and a say in shaping what Bakeri becomes.</p>
            <p style="margin:0 0 36px;font-size:16px;line-height:1.7;color:#3A1212;font-family:Arial,sans-serif;">We'll be in touch the moment the doors open. Until then — keep creating.</p>
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:36px;">
              <tr>
                <td style="border-top:1px solid #E9DAC4;"></td>
                <td style="padding:0 16px;white-space:nowrap;">
                  <img src="https://bakeriapp.com/1024.png" alt="" width="32" height="32" style="display:block;border-radius:8px;" />
                </td>
                <td style="border-top:1px solid #E9DAC4;"></td>
              </tr>
            </table>
            <p style="margin:0 0 16px;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#8C5858;font-family:Arial,sans-serif;">What to expect</p>
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr><td style="padding:12px 0;border-top:1px solid #F3EAD8;"><table cellpadding="0" cellspacing="0"><tr><td style="width:32px;vertical-align:top;font-size:16px;">📖</td><td style="font-size:15px;color:#3A1212;font-family:Arial,sans-serif;line-height:1.5;"><strong>Recipe Vault</strong> — every recipe you've ever perfected, always at hand.</td></tr></table></td></tr>
              <tr><td style="padding:12px 0;border-top:1px solid #F3EAD8;"><table cellpadding="0" cellspacing="0"><tr><td style="width:32px;vertical-align:top;font-size:16px;">📦</td><td style="font-size:15px;color:#3A1212;font-family:Arial,sans-serif;line-height:1.5;"><strong>Order Tracking</strong> — from dough to delivery in one clean view.</td></tr></table></td></tr>
              <tr><td style="padding:12px 0;border-top:1px solid #F3EAD8;border-bottom:1px solid #F3EAD8;"><table cellpadding="0" cellspacing="0"><tr><td style="width:32px;vertical-align:top;font-size:16px;">⚖️</td><td style="font-size:15px;color:#3A1212;font-family:Arial,sans-serif;line-height:1.5;"><strong>One-Tap Scaling</strong> — no more kitchen math, ever.</td></tr></table></td></tr>
            </table>
          </td>
        </tr>
        <tr>
          <td align="center" style="background:#FAF5EE;padding:36px 40px;border:1px solid #E9DAC4;border-top:none;">
            <p style="margin:0 0 20px;font-size:15px;color:#8C5858;font-family:Arial,sans-serif;">Know a baker who'd love this?</p>
            <a href="https://bakeriapp.com" style="display:inline-block;background:#8B1A18;color:#FAF5EE;font-family:Arial,sans-serif;font-size:13px;font-weight:700;letter-spacing:2px;text-transform:uppercase;text-decoration:none;padding:14px 32px;border-radius:6px;">Share Bakeri</a>
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:28px 40px;background:#FAF5EE;">
            <p style="margin:0 0 4px;font-size:12px;color:#8C5858;font-family:Arial,sans-serif;">© 2026 Bakeri App. Built for Home Bakers.</p>
            <p style="margin:0;font-size:12px;color:#C9963A;font-family:Arial,sans-serif;">hello@bakeriapp.com</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
    }),
  });

  return new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json" },
  });
});
