/**
 * #1045 SECURITY / STATE-RESTORATION remediation (one-shot, run via rc-gates gate-3-dast diagnostic).
 *
 * The earlier deployed-journey runs used `verifyCredentialsAndInjectSession`, which signed the MAINTAINED
 * test accounts in and serialized their live sessions into the Playwright trace artifacts. Those artifacts
 * were deleted; this spec closes the remaining exposure by REVOKING every refresh token for those accounts
 * (GoTrue admin logout) so any copied token is dead. It also RESTORES the shared Free account's Private
 * sample to a NON-entitled (consumed) state, undoing the seed the failed run left behind.
 *
 * Service-role only (injected by gate-3-dast). No UI sign-in, no session injection → nothing to leak.
 * Sanitized output: user ids only, never tokens.
 */
import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = (process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '').replace(/\/$/, '');
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const FREE_EMAIL = process.env.FREE_TEST_EMAIL ?? process.env.BASIC_TEST_EMAIL ?? '';
const PRO_EMAIL = process.env.PRO_TEST_EMAIL ?? process.env.E2E_PRO_EMAIL ?? '';

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

/** Revoke ALL refresh tokens for a user (GoTrue admin logout, global scope). Idempotent. */
async function revokeSessions(uid: string): Promise<number> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${uid}/logout`, {
    method: 'POST',
    headers: { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ scope: 'global' }),
  });
  return res.status; // 204 on success
}

test('#1045 remediation: revoke leaked sessions + restore shared sample @live', async () => {
  test.setTimeout(120_000);
  test.skip(!SUPABASE_URL || !SERVICE_ROLE, 'service-role required');
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { autoRefreshToken: false, persistSession: false } });

  const freeUid = await resolveUid(admin, FREE_EMAIL);
  const proUid = await resolveUid(admin, PRO_EMAIL);

  // 1) Revoke sessions for every maintained account that could have been injected during the leak runs.
  const revoked: Record<string, number | 'not-found'> = {};
  for (const [label, uid] of [['free', freeUid], ['pro', proUid]] as const) {
    if (!uid) { revoked[label] = 'not-found'; continue; }
    revoked[label] = await revokeSessions(uid);
    expect([200, 204], `${label} logout should succeed`).toContain(revoked[label]);
  }

  // 2) Restore the shared Free account's Private sample to a NON-entitled (consumed) state.
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
    expect(sampleRestored, 'sample must be non-entitled after restore').toBe(true);
  }

  console.log(`[remediation] revoked=${JSON.stringify(revoked)} freeUid=${freeUid ?? 'none'} proUid=${proUid ?? 'none'} sampleRestored=${sampleRestored}`);
});
