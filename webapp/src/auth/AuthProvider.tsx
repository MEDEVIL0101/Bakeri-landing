import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { Profile } from '../lib/types';
import { loadPlan, type VendorPlan } from '../lib/plans';

interface AuthState {
  /** undefined while the stored session is still being restored. */
  session: Session | null | undefined;
  profile: Profile | null;
  profileLoading: boolean;
  /** True after a PASSWORD_RECOVERY link signs the user in. */
  recovering: boolean;
  setRecovering: (v: boolean) => void;
  refreshProfile: () => Promise<void>;
  /** The vendor's plan row: null = hasn't picked one; undefined = loading or unknown (never block on it). */
  plan: VendorPlan | null | undefined;
  planLoading: boolean;
  refreshPlan: () => Promise<VendorPlan | null | undefined>;
  /** True when 2FA is on and this session hasn't entered its code yet; undefined while checking. */
  mfaNeeded: boolean | undefined;
  refreshMfa: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

const PROFILE_COLUMNS =
  'id, user_name, business_name, business_slogan, email, profile_slug, country, pickup_address, delivery_enabled, stripe_connect_onboarding_complete, vendor_setup_completed_at, terms_accepted_at, storefront_listing_id, selected_theme, background_pattern';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [plan, setPlan] = useState<VendorPlan | null | undefined>(undefined);
  const [planLoading, setPlanLoading] = useState(false);
  const [mfaNeeded, setMfaNeeded] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === 'PASSWORD_RECOVERY') setRecovering(true);
      setSession(s);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // 2FA: a password-only session is aal1; with a verified authenticator the
  // account needs aal2 before the app (and RLS) lets it at anything.
  const refreshMfa = useCallback(async () => {
    const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    setMfaNeeded(error ? false : data.nextLevel === 'aal2' && data.currentLevel !== 'aal2');
  }, []);

  useEffect(() => {
    if (session === undefined) return;
    if (!session) { setMfaNeeded(false); return; }
    refreshMfa();
  }, [session, refreshMfa]);

  // Data loads wait for the code — RLS refuses an aal1 session anyway.
  const userId = mfaNeeded === false ? session?.user.id : undefined;

  const loadProfile = useCallback(async () => {
    if (!userId) { setProfile(null); return; }
    setProfileLoading(true);
    // Same retry as iOS ProfileService.fetchProfileWithRetries: right after
    // sign-in the first read can race the session and come back empty.
    let row: Profile | null = null;
    for (const delay of [0, 300, 600]) {
      if (delay) await new Promise((r) => setTimeout(r, delay));
      const { data, error } = await supabase.from('profiles').select(PROFILE_COLUMNS).eq('id', userId).maybeSingle();
      if (!error && data) { row = data as Profile; break; }
    }
    setProfile(row);
    setProfileLoading(false);
  }, [userId]);

  useEffect(() => { loadProfile(); }, [loadProfile]);

  const refreshPlan = useCallback(async () => {
    if (!userId) { setPlan(undefined); return undefined; }
    setPlanLoading(true);
    const p = await loadPlan(userId);
    setPlan(p);
    setPlanLoading(false);
    return p;
  }, [userId]);

  useEffect(() => { refreshPlan(); }, [refreshPlan]);

  const signOut = useCallback(async () => {
    // This browser only. The default ('global') also ended the account's
    // session in the iPhone app, which then asked to log in again within the
    // hour (Harvey 2026-11-02: "requesting login credentials often").
    await supabase.auth.signOut({ scope: 'local' });
    setProfile(null);
    setPlan(undefined);
  }, []);

  return (
    <AuthContext.Provider
      value={{ session, profile, profileLoading, recovering, setRecovering, refreshProfile: loadProfile, plan, planLoading, refreshPlan, mfaNeeded, refreshMfa, signOut }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}

/** The signed-in vendor's id. Only call inside the authenticated shell. */
export function useUserId(): string {
  const { session } = useAuth();
  if (!session) throw new Error('useUserId without a session');
  return session.user.id;
}
