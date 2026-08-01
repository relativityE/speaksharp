/**
 * #1045 SECURITY / STATE-RESTORATION remediation (one-shot, run via rc-gates gate-3-dast diagnostic).
 *
 * The earlier deployed-journey runs used `verifyCredentialsAndInjectSession`, which signed the MAINTAINED
 * test accounts in and serialized their live sessions into the Playwright trace artifacts. Those artifacts
 * were deleted; this spec closes the remaining exposure by:
 *   1) RESTORING the shared Free account's Private sample to a NON-entitled (consumed) state — the critical
 *      shared-state fix, done first so it is guaranteed regardless of the revocation outcome; and
 *   2) REVOKING every refresh token for the maintained accounts (sign in, then admin global signOut) so any
 *      copied token is dead. `admin.auth.admin.signOut(jwt, 'global')` is used because this GoTrue instance
 *      has no per-user admin logout endpoint (the previous POST /admin/users/:id/logout returned 404).
 *
 * Pure supabase-js in the node test process (no browser page) → no trace, nothing to leak. Sanitized
 * output: user ids + statuses only, never tokens.
 */
import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = (process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '').replace(/\/$/, '');
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? '';
const FREE_EMAIL = process.env.FREE_TEST_EMAIL ?? process.env.BASIC_TEST_EMAIL ?? '';
const FREE_PASSWORD = process.env.FREE_TEST_PASSWORD ?? process.env.BASIC_TEST_PASSWORD ?? '';
const PRO_EMAIL = process.env.PRO_TEST_EMAIL ?? process.env.E2E_PRO_EMAIL ?? '';
const PRO_PASSWORD = process.env.PRO_TEST_PASSWORD ?? process.env.E2E_PRO_PASSWORD ?? '';

async function resolveUid(admin: SupabaseClient, email: string): Promise<string | null> {
  if (!email) return null;
  const target = email.toLowerCase();
  for (let page = 1; page <= 25; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`resolveUid(${email}): ${error.message}`);
    const users = (data?.users ?? []) as Array<{ id: string; email?: string | null }>;
    const hit = users.find((u) => (u.email ?? '').toLowerCase() === target);
    if (hit) return hit.id;
    if (users.length < 200) break;
  }
  return null;
}

/**
 * Revoke ALL refresh tokens for an account: sign in to mint a JWT, then admin global signOut (which
 * revokes every session for that user, including the one just minted). Returns a sanitized status string.
 */
async function revokeAllSessions(admin: SupabaseClient, email: string, password: string): Promise<string> {
  if (!email || !password || !ANON_KEY) return 'skipped-no-creds';
  const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data, error } = await anon.auth.signInWithPassword({ email, password });
  if (error || !data.session) return `signin-failed:${error?.message ?? 'no-session'}`;
  const { error: soErr } = await admin.auth.admin.signOut(data.session.access_token, 'global');
  return soErr ? `signout-failed:${soErr.message}` : 'revoked';
}

test('#1045 remediation: restore shared sample + revoke leaked sessions @live', async () => {
  test.setTimeout(120_000);
  test.skip(!SUPABASE_URL || !SERVICE_ROLE, 'service-role required');
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { autoRefreshToken: false, persistSession: false } });

  const freeUid = await resolveUid(admin, FREE_EMAIL);
  const proUid = await resolveUid(admin, PRO_EMAIL);

  // 1) CRITICAL shared-state fix FIRST: restore the Free account's Private sample to NON-entitled.
  let sampleRestored = false;
  if (freeUid) {
    const { error } = await admin.from('user_profiles').upsert({
      id: freeUid,
      subscription_status: 'free',
      private_sample_limit_seconds: 300,
      private_sample_seconds_used: 300,
      private_sample_completed_at: '2024-01-01T00:05:00.000Z',
      private_sample_session_id: null,
    }, { onConflict: 'id' });
    expect(error, `restore sample: ${error?.message ?? ''}`).toBeNull();
    const { data } = await admin.from('user_profiles')
      .select('private_sample_completed_at, private_sample_seconds_used').eq('id', freeUid).maybeSingle();
    const p = data as Record<string, unknown> | null;
    sampleRestored = p?.private_sample_completed_at != null && Number(p?.private_sample_seconds_used) >= 300;
  }

  // 2) Revoke sessions for every maintained account that could have been injected during the leak runs.
  const revoked: Record<string, string> = {
    free: freeUid ? await revokeAllSessions(admin, FREE_EMAIL, FREE_PASSWORD) : 'not-found',
    pro: proUid ? await revokeAllSessions(admin, PRO_EMAIL, PRO_PASSWORD) : 'not-found',
  };

  console.log(`[remediation] sampleRestored=${sampleRestored} revoked=${JSON.stringify(revoked)} freeUid=${freeUid ?? 'none'} proUid=${proUid ?? 'none'}`);

  // Assertions: sample restoration is required; revocation must succeed for any account that was found.
  if (freeUid) expect(sampleRestored, 'shared Free sample must be non-entitled after restore').toBe(true);
  for (const [label, status] of Object.entries(revoked)) {
    if (status === 'not-found') continue;
    expect(status, `${label} sessions must be revoked (got: ${status})`).toBe('revoked');
  }
});
