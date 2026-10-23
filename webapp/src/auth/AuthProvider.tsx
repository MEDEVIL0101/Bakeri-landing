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

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === 'PASSWORD_RECOVERY') setRecovering(true);
      setSession(s);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const userId = session?.user.id;

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
    await supabase.auth.signOut();
    setProfile(null);
    setPlan(undefined);
  }, []);

  return (
    <AuthContext.Provider
      value={{ session, profile, profileLoading, recovering, setRecovering, refreshProfile: loadProfile, plan, planLoading, refreshPlan, signOut }}
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
