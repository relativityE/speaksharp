import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { verifyLiveJourneyAccounts, LIVE_JOURNEY_ROLES, liveJourneyMaskValues } from '../../scripts/verify-test-users.mjs';

/**
 * Sam 1793541050.190059: the Cloud test live run's two REQUIRED accounts, verified by role only. Reconciles historical aa2ff01a
 * (verifyThrowaway): the same stubbed auth listing and no-identifier output checks, without its in-job id file (account binding now uses
 * the owner-supplied, digest-checked id) and widened to both roles with the profile tier.
 */
const THROWAWAY = 'throwaway.synthetic@example.invalid';
const FREE = 'free.synthetic@example.invalid';
const T_ID = '11111111-1111-4111-8111-111111111111';
const F_ID = '22222222-2222-4222-8222-222222222222';
const sha = (v) => createHash('sha256').update(v).digest('hex');
const ENV = { THROWAWAY_TEST_EMAIL: THROWAWAY, FREE_TEST_EMAIL: FREE };
const DIGESTS = { EXPECTED_THROWAWAY_ID_SHA256: sha(T_ID), EXPECTED_FREE_ID_SHA256: sha(F_ID) };

function world({ users = [{ id: 'other', email: 'someone@example.invalid' }, { id: T_ID, email: THROWAWAY.toUpperCase() }, { id: F_ID, email: FREE }],
  profiles = [{ id: T_ID, subscription_status: 'free' }, { id: F_ID, subscription_status: 'free' }], profileError = null, listError = null } = {}) {
  const queries = [];
  const supabase = {
    from(table) {
      const q = { table, select: null, in: null };
      queries.push(q);
      const builder = {
        select(columns) { q.select = columns; return builder; },
        in(column, ids) { q.in = [column, [...ids]]; return builder; },
        then(ok, fail) { return Promise.resolve(profileError ? { data: null, error: profileError } : { data: profiles.filter((p) => ids(q).includes(p.id)), error: null }).then(ok, fail); },
      };
      return builder;
    },
  };
  const ids = (q) => q.in?.[1] ?? [];
  const listUsers = async () => { if (listError) throw listError; return users; };
  return { supabase, listUsers, queries };
}
const ROW = { authUserExists: true, tierMatches: true, idMatches: true, pass: true };
const leaks = (value) => new RegExp(`${T_ID}|${F_ID}|synthetic|example\\.invalid|${sha(T_ID)}|${sha(F_ID)}`, 'i').test(JSON.stringify(value));

describe('verify-test-users live-journey-accounts target', () => {
  it('reports both required roles by role only, with one profile read and no identifier', async () => {
    const w = world();
    const out = await verifyLiveJourneyAccounts({ supabase: w.supabase, env: { ...ENV, ...DIGESTS }, listUsers: w.listUsers });
    expect(out).toEqual({ target: 'live-journey-accounts', allPass: true, results: [
      { role: 'existing-disposable', ...ROW }, { role: 'maintained-read-only', ...ROW }] });
    expect(leaks(out)).toBe(false);
    expect(w.queries).toEqual([{ table: 'user_profiles', select: 'id, subscription_status', in: ['id', [T_ID, F_ID]] }]);
    expect(LIVE_JOURNEY_ROLES.map((r) => [r.role, r.emailVar, r.expectedTier])).toEqual([
      ['existing-disposable', 'THROWAWAY_TEST_EMAIL', 'free'], ['maintained-read-only', 'FREE_TEST_EMAIL', 'free']]);
  });

  it('matches owner-supplied id digests per role; a wrong digest fails only that role', async () => {
    const w = world();
    const good = await verifyLiveJourneyAccounts({ supabase: w.supabase, listUsers: w.listUsers,
      env: { ...ENV, EXPECTED_THROWAWAY_ID_SHA256: sha(T_ID), EXPECTED_FREE_ID_SHA256: sha(F_ID) } });
    expect(good.results.map((r) => [r.role, r.idMatches, r.pass])).toEqual([['existing-disposable', true, true], ['maintained-read-only', true, true]]);
    const bad = await verifyLiveJourneyAccounts({ supabase: w.supabase, listUsers: w.listUsers,
      env: { ...ENV, EXPECTED_THROWAWAY_ID_SHA256: sha(T_ID), EXPECTED_FREE_ID_SHA256: sha('33333333-3333-4333-8333-333333333333') } });
    expect(bad.results.map((r) => [r.role, r.idMatches, r.pass])).toEqual([['existing-disposable', true, true], ['maintained-read-only', false, false]]);
    expect(bad.allPass).toBe(false);
    expect(leaks(bad)).toBe(false);
    // Cross-role swap: each role's digest supplied for the other role fails both, never passes either.
    const swapped = await verifyLiveJourneyAccounts({ supabase: w.supabase, listUsers: w.listUsers,
      env: { ...ENV, EXPECTED_THROWAWAY_ID_SHA256: sha(F_ID), EXPECTED_FREE_ID_SHA256: sha(T_ID) } });
    expect(swapped.results.map((r) => [r.role, r.idMatches, r.pass])).toEqual([['existing-disposable', false, false], ['maintained-read-only', false, false]]);
  });

  it('missing expected-id input never counts as a verified owner id: that role is incomplete and nothing passes overall', async () => {
    const w = world();
    // Both digests absent: existence and tier hold for both roles, yet neither role passes and the target fails.
    const none = await verifyLiveJourneyAccounts({ supabase: w.supabase, env: ENV, listUsers: w.listUsers });
    expect(none.results).toEqual([
      { role: 'existing-disposable', authUserExists: true, tierMatches: true, idMatches: null, pass: false },
      { role: 'maintained-read-only', authUserExists: true, tierMatches: true, idMatches: null, pass: false }]);
    expect(none.allPass).toBe(false);
    // One digest absent: only that role is incomplete; the supplied one is still checked.
    const one = await verifyLiveJourneyAccounts({ supabase: w.supabase, listUsers: w.listUsers, env: { ...ENV, EXPECTED_FREE_ID_SHA256: sha(F_ID) } });
    expect(one.results.map((r) => [r.role, r.idMatches, r.pass])).toEqual([['existing-disposable', null, false], ['maintained-read-only', true, true]]);
    expect(one.allPass).toBe(false);
    // A blank value is absent, not a match.
    const blank = await verifyLiveJourneyAccounts({ supabase: w.supabase, listUsers: w.listUsers, env: { ...ENV, ...DIGESTS, EXPECTED_THROWAWAY_ID_SHA256: '   ' } });
    expect(blank.results[0]).toEqual({ role: 'existing-disposable', authUserExists: true, tierMatches: true, idMatches: null, pass: false });
  });

  it('a malformed digest is refused before any read', async () => {
    const w = world();
    for (const bad of [F_ID, sha(F_ID).toUpperCase(), sha(F_ID).slice(1), `${sha(F_ID)}0`, 'not-a-digest']) {
      await expect(verifyLiveJourneyAccounts({ supabase: w.supabase, env: { ...ENV, EXPECTED_THROWAWAY_ID_SHA256: bad }, listUsers: w.listUsers }))
        .rejects.toThrow(/^LIVE_JOURNEY_ACCOUNTS_CONFIG: an expected id digest is malformed$/);
    }
    expect(w.queries).toEqual([]);
  });

  it('masks every email (as given and lower-cased) and digest, skipping blanks', () => {
    const masks = liveJourneyMaskValues({ THROWAWAY_TEST_EMAIL: THROWAWAY.toUpperCase(), FREE_TEST_EMAIL: FREE, EXPECTED_THROWAWAY_ID_SHA256: sha(T_ID),
      EXPECTED_FREE_ID_SHA256: '  ' });
    expect(masks.sort()).toEqual([THROWAWAY.toUpperCase(), THROWAWAY, FREE, sha(T_ID)].sort());
  });

  it('writes nothing: the target has no file, insert, update or sign-in path (historical no-overwrite protection)', async () => {
    const src = readFileSync(resolve(process.cwd(), 'scripts/verify-test-users.mjs'), 'utf8');
    const body = src.slice(src.indexOf('export async function verifyLiveJourneyAccounts('), src.indexOf('export function statusLine('));
    for (const token of ['writeFile', 'appendFile', '.insert(', '.update(', '.upsert(', '.delete(', 'signIn', 'console.']) expect(body).not.toContain(token);
  });

  it('a missing account, missing profile or wrong tier fails that role without naming it', async () => {
    const cases = [
      [world({ users: [{ id: T_ID, email: THROWAWAY }] }), 'maintained-read-only', { authUserExists: false, tierMatches: false }],
      [world({ profiles: [{ id: T_ID, subscription_status: 'free' }] }), 'maintained-read-only', { authUserExists: true, tierMatches: false }],
      [world({ profiles: [{ id: T_ID, subscription_status: 'pro' }, { id: F_ID, subscription_status: 'free' }] }), 'existing-disposable', { authUserExists: true, tierMatches: false }],
    ];
    for (const [w, role, facts] of cases) {
      const out = await verifyLiveJourneyAccounts({ supabase: w.supabase, env: ENV, listUsers: w.listUsers });
      expect(out.allPass).toBe(false);
      expect(out.results.find((r) => r.role === role)).toEqual({ role, ...facts, idMatches: null, pass: false });
      expect(leaks(out)).toBe(false);
    }
  });

  it('both names are required and nothing falls back to E2E, CREATE or PRO names', async () => {
    const w = world();
    for (const env of [{ FREE_TEST_EMAIL: FREE }, { THROWAWAY_TEST_EMAIL: THROWAWAY },
      { E2E_FREE_EMAIL: FREE, THROWAWAY_TEST_EMAIL: THROWAWAY }, { CREATE_USER_EMAIL: FREE, PRO_TEST_EMAIL: FREE, THROWAWAY_TEST_EMAIL: THROWAWAY }]) {
      await expect(verifyLiveJourneyAccounts({ supabase: w.supabase, env, listUsers: w.listUsers })).rejects.toThrow(/^LIVE_JOURNEY_ACCOUNTS_CONFIG/);
    }
    await expect(verifyLiveJourneyAccounts({ supabase: w.supabase, env: { THROWAWAY_TEST_EMAIL: FREE, FREE_TEST_EMAIL: FREE.toUpperCase() }, listUsers: w.listUsers }))
      .rejects.toThrow(/same account/);
    expect(w.queries).toEqual([]);
  });

  it('every read failure becomes one fixed code: no SDK message, email or id can leak', async () => {
    const sdk = new Error(`lookup failed for ${THROWAWAY} id ${T_ID}`);
    for (const w of [world({ listError: sdk }), world({ profileError: { message: `denied for ${F_ID}` } })]) {
      const err = await verifyLiveJourneyAccounts({ supabase: w.supabase, env: ENV, listUsers: w.listUsers }).catch((e) => e);
      expect(err.message).toBe('LIVE_JOURNEY_ACCOUNTS_READ_FAILED');
      expect(leaks(err.message)).toBe(false);
    }
  });
});
