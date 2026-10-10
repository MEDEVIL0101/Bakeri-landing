import { createClient } from '@supabase/supabase-js';

// Public project URL + anon key — the same values the public storefront
// (baker/index.html) already ships. Every read/write below is scoped by RLS
// to the signed-in vendor (user_id = auth.uid()).
export const SUPABASE_URL = 'https://aqhebjxaynvtvurwedrl.supabase.co';
export const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFxaGVianhheW52dHZ1cndlZHJsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4MTgwOTMsImV4cCI6MjA5MTM5NDA5M30.XgkgwDM5nyrmoJtNNNRDiBQePcBFGew13TbK76y_aOI';

export const STORAGE_PUBLIC_URL = `${SUPABASE_URL}/storage/v1/object/public`;

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    // PKCE puts the email-link result in ?code= rather than the URL hash.
    flowType: 'pkce',
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

/** Absolute URL of a route inside the web app, for auth email redirects. */
export function appURL(path: string): string {
  return `${window.location.origin}${import.meta.env.BASE_URL}${path.replace(/^\//, '')}`;
}
