import 'dotenv/config';
import { Resend } from 'resend';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const resend   = new Resend(process.env.RESEND_API_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const htmlTemplate = readFileSync(join(__dirname, 'beta_reminder_email.html'), 'utf8');

// ── Test mode ──────────────────────────────────────────────────────────────
const TEST_MODE = false;
const TEST_RECIPIENTS = [
  { name: 'Diana',  email: 'dia.medcalf@gmail.com' },
  { name: 'Harvey', email: 'harveycmedcalf@gmail.com' },
];

// ── Fetch recipients: invited but not yet reminded ─────────────────────────
async function fetchRecipients() {
  const [
    { data: invited,  error: e1 },
    { data: reminded, error: e2 },
  ] = await Promise.all([
    supabase.from('beta_invites_sent').select('name, email'),
    supabase.from('beta_reminders_sent').select('email'),
  ]);

  if (e1) throw new Error(`beta_invites_sent: ${e1.message}`);
  if (e2) throw new Error(`beta_reminders_sent: ${e2.message}`);

  const alreadyReminded = new Set((reminded || []).map(r => r.email.trim().toLowerCase()));

  return (invited || []).filter(({ email }) => !alreadyReminded.has(email.trim().toLowerCase()));
}

// ── Log a successful send ──────────────────────────────────────────────────
async function logSent(name, email) {
  const { error } = await supabase
    .from('beta_reminders_sent')
    .upsert({ name, email: email.trim().toLowerCase() }, { onConflict: 'email' });
  if (error) console.warn(`  ⚠ Could not log ${email}: ${error.message}`);
}

// ── Send ───────────────────────────────────────────────────────────────────
const LIST_ONLY = process.argv.includes('--list');

async function sendReminders() {
  let recipients;
  if (TEST_MODE) {
    recipients = TEST_RECIPIENTS;
  } else {
    recipients = await fetchRecipients();
  }

  if (LIST_ONLY) {
    console.log(`\nWould send to ${recipients.length} recipient${recipients.length === 1 ? '' : 's'}:\n`);
    for (const { name, email } of recipients) console.log(`  ${name || 'there'} <${email}>`);
    console.log('');
    return;
  }

  console.log(`\n${TEST_MODE ? '🧪 TEST MODE — ' : ''}Sending to ${recipients.length} recipient${recipients.length === 1 ? '' : 's'}.\n`);

  let sent = 0;
  let failed = 0;

  for (const { name, email } of recipients) {
    const firstName = (name || 'there').split(' ')[0];
    const html = htmlTemplate.replace(/\{\{name\}\}/g, firstName);

    try {
      await resend.emails.send({
        from:    'Diana at Bakeri <hello@bakeriapp.com>',
        to:      email.trim(),
        subject: "Your early access is still waiting — come join us!",
        html,
      });

      await logSent(name, email);
      console.log(`✓  ${email}`);
      sent++;

      await new Promise(r => setTimeout(r, 600));

    } catch (err) {
      console.error(`✗  ${email} — ${err.message}`);
      failed++;
    }
  }

  console.log(`\nDone. ${sent} sent, ${failed} failed.`);
}

sendReminders().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
