import 'dotenv/config';
import { Resend } from 'resend';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const resend  = new Resend(process.env.RESEND_API_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const htmlTemplate = readFileSync(join(__dirname, 'beta_invite_email.html'), 'utf8');

// ── Test mode — set to false to send to everyone ──────────────────────────
const TEST_MODE = false;
const TEST_RECIPIENTS = [
  { name: 'Diana', email: 'dia.medcalf@gmail.com' },
  { name: 'Harvey', email: 'harveycmedcalf@gmail.com' },
];

const EXTRA_RECIPIENTS = [
  { name: 'Tony', email: 'adinardo.217@gmail.com' },
];

// ── Fetch recipients from waitlist ─────────────────────────────────────────

async function fetchRecipients() {
  const [
    { data: waitlist, error: e1 },
    { data: already,  error: e2 },
  ] = await Promise.all([
    supabase.from('waitlist').select('name, email'),
    supabase.from('beta_invites_sent').select('email'),
  ]);

  if (e1) throw new Error(`waitlist: ${e1.message}`);
  if (e2) throw new Error(`beta_invites_sent: ${e2.message}`);

  const alreadySent = new Set((already || []).map(r => r.email.trim().toLowerCase()));

  // Deduplicate by email (case-insensitive), skip already invited
  const seen = new Set();
  return (waitlist || []).filter(({ email }) => {
    const key = email.trim().toLowerCase();
    if (seen.has(key) || alreadySent.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ── Log a successful send ──────────────────────────────────────────────────

async function logSent(name, email) {
  const { error } = await supabase
    .from('beta_invites_sent')
    .upsert({ name, email: email.trim().toLowerCase() }, { onConflict: 'email' });
  if (error) console.warn(`  ⚠ Could not log ${email}: ${error.message}`);
}

// ── Send ───────────────────────────────────────────────────────────────────

const LIST_ONLY = process.argv.includes('--list');

async function sendInvites() {
  let recipients;
  if (TEST_MODE) {
    recipients = TEST_RECIPIENTS;
  } else {
    const fromDB = await fetchRecipients();
    const { data: already } = await supabase.from('beta_invites_sent').select('email');
    const alreadySent = new Set((already || []).map(r => r.email.trim().toLowerCase()));
    const extras = EXTRA_RECIPIENTS.filter(r => !alreadySent.has(r.email.trim().toLowerCase()));
    recipients = [...fromDB, ...extras];
  }

  if (LIST_ONLY) {
    console.log(`\nWould send to ${recipients.length} recipient${recipients.length === 1 ? '' : 's'}:\n`);
    for (const { name, email } of recipients) console.log(`  ${name} <${email}>`);
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
        subject: "Start your week with Bakeri! Here's your early access.",
        html,
      });

      await logSent(name, email);
      console.log(`✓  ${email}`);
      sent++;

      // Stay well within Resend's free tier rate limit (100/day, ~2/sec max)
      await new Promise(r => setTimeout(r, 600));

    } catch (err) {
      console.error(`✗  ${email} — ${err.message}`);
      failed++;
    }
  }

  console.log(`\nDone. ${sent} sent, ${failed} failed.`);
}

sendInvites().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
