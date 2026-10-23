import { useEffect, useState } from 'react';

/** Phone layout (iOS-style nav bar, tab bar and side menu) — same breakpoint as styles.css. */
export const PHONE_QUERY = '(max-width: 900px)';

export function useMedia(query: string): boolean {
  const [match, setMatch] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatch(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return match;
}

export function useIsPhone(): boolean {
  return useMedia(PHONE_QUERY);
}
