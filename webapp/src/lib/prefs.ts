import { useCallback, useEffect, useState } from 'react';

// Per-browser display preferences (the iOS app keeps these in UserSettings,
// device-local too). Wrapped in try/catch: storage can be unavailable.

function read(key: string, fallback: string): string {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}

export function usePref<T extends string>(key: string, fallback: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => read(key, fallback) as T);
  useEffect(() => {
    const h = (e: StorageEvent) => { if (e.key === key) setV((e.newValue ?? fallback) as T); };
    window.addEventListener('storage', h);
    return () => window.removeEventListener('storage', h);
  }, [key, fallback]);
  const set = useCallback((nv: T) => {
    setV(nv);
    try { localStorage.setItem(key, nv); } catch { /* ignore */ }
  }, [key]);
  return [v, set];
}

/** 'us' (cups/oz) or 'metric' (ml/g) — same choice as iOS Settings → Units. */
export const useUnitSystem = () => usePref<'us' | 'metric'>('bakeri.units', 'us');
