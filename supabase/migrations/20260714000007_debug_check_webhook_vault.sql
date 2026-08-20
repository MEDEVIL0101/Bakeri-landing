-- One-off diagnostic: confirm the bakeri_webhook_secret Vault entry exists
-- and matches the live BAKERI_WEBHOOK_SECRET edge function secret, before
-- writing new triggers/cron jobs that depend on it via
-- (select decrypted_secret from vault.decrypted_secrets where name = ...).
-- Result surfaces as a NOTICE in `supabase db push` output. Dropped by a
-- follow-up migration once read (same pattern as this repo's existing
-- debug_* migrations).
DO $$
DECLARE
    v_exists BOOLEAN;
    v_value  TEXT;
BEGIN
    SELECT EXISTS(SELECT 1 FROM vault.decrypted_secrets WHERE name = 'bakeri_webhook_secret')
    INTO v_exists;

    IF v_exists THEN
        SELECT decrypted_secret INTO v_value
        FROM vault.decrypted_secrets WHERE name = 'bakeri_webhook_secret' LIMIT 1;
        RAISE NOTICE 'VAULT_CHECK: entry exists, value=%', v_value;
    ELSE
        RAISE NOTICE 'VAULT_CHECK: entry MISSING';
    END IF;
END $$;
