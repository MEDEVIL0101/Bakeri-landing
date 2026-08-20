// Country/currency support for baker Stripe Connect accounts.
// Scope is intentionally limited to US + CA — both are 2-decimal currencies,
// so the Math.round(x * 100) cents math throughout the payment functions
// keeps working unchanged. Extending to zero-decimal currencies (e.g. JPY)
// would need that math revisited everywhere it appears.

export const SUPPORTED_CONNECT_COUNTRIES = ["US", "CA"] as const;
export type ConnectCountry = typeof SUPPORTED_CONNECT_COUNTRIES[number];

const COUNTRY_CURRENCY: Record<ConnectCountry, string> = {
  US: "usd",
  CA: "cad",
};

// Defaults to "CA" for anything missing/unrecognized — matches the
// pre-fix behavior for a baker who hasn't picked a country yet, and is a
// safe fallback against bad client input.
export function normalizeConnectCountry(country: string | null | undefined): ConnectCountry {
  return (SUPPORTED_CONNECT_COUNTRIES as readonly string[]).includes(country ?? "")
    ? (country as ConnectCountry)
    : "CA";
}

export function currencyForCountry(country: string | null | undefined): string {
  return COUNTRY_CURRENCY[normalizeConnectCountry(country)];
}
