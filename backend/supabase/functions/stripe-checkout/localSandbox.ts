// Outcome 7 D1 / outcome 8: the ONLY non-live checkout path. It opens solely on a disposable local
// Supabase stack started by the approval-gated billing workflow, never on a hosted project.
//
// Every condition must hold; any miss returns false and checkout stays on the fail-closed live rule:
//   - an exact acknowledgement value, not a boolean flag that a stray "true" could satisfy;
//   - a Stripe TEST secret key;
//   - SUPABASE_URL is one of the local stack's own API origins (the edge runtime's internal gateway or
//     the CLI's loopback port). Hosted Supabase sets SUPABASE_URL itself to https://<ref>.supabase.co,
//     so no deployed project can match this list;
//   - SITE_URL, which checkout concatenates into its redirects, is exactly the local app origin;
//   - a browser Origin, when present, is that same local app origin.
export const LOCAL_SANDBOX_ACKNOWLEDGEMENT = 'ISOLATED-TEST-MODE-ONLY';
export const LOCAL_API_ORIGINS: readonly string[] = ['http://kong:8000', 'http://127.0.0.1:54321', 'http://localhost:54321'];
export const LOCAL_APP_ORIGINS: readonly string[] = ['http://localhost:5173', 'http://127.0.0.1:5173'];

type EnvGetter = (key: string) => string | undefined;

function exactOrigin(raw: string | undefined, allowed: readonly string[]): boolean {
  if (!raw) return false;
  let url: URL;
  try { url = new URL(raw); } catch { return false; }
  if (url.protocol !== 'http:' || url.username || url.password || url.search || url.hash) return false;
  if (url.pathname !== '/') return false;
  return allowed.includes(url.origin);
}

export function isApprovedLocalBillingSandbox(getEnv: EnvGetter, req: Request): boolean {
  if (getEnv('BILLING_LOCAL_SANDBOX') !== LOCAL_SANDBOX_ACKNOWLEDGEMENT) return false;
  if (!getEnv('STRIPE_SECRET_KEY')?.startsWith('sk_test_')) return false;
  const supabaseUrl = getEnv('SUPABASE_URL');
  if (!exactOrigin(supabaseUrl, LOCAL_API_ORIGINS)) return false;
  // Redirects are built as `${SITE_URL}/...`, so only the bare origin string is accepted.
  const siteUrl = getEnv('SITE_URL');
  if (!siteUrl || !LOCAL_APP_ORIGINS.includes(siteUrl)) return false;
  const origin = req.headers.get('Origin');
  if (origin !== null && !LOCAL_APP_ORIGINS.includes(origin)) return false;
  return true;
}
