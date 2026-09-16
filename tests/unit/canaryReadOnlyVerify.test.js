// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  DELETION_CLEARANCE,
  DEPENDENTS,
  VERDICTS,
  assertRedacted,
  dependencyObservation,
  formatCanaryLine,
  inspectCanaryIdentity,
  runCanaryInspection,
} from '../../scripts/lib/canaryReadOnlyVerify.mjs';

// Canary identity inspection is STRICTLY READ-ONLY (Product Owner decision, 15 Sep 2026). These in-memory stubs THROW
// on every write and every authentication method, so any attempt fails the test outright. No network, no accounts.

const TRIAL_EMAIL = 'operator+trial@example.test';
const PAID_EMAIL = 'operator+paid@example.net';
const DAY = 86400_000;
const iso = (ms) => new Date(ms).toISOString();
const NOW = Date.now();

const activeTrial = (id) => ({
  id, subscription_status: 'free', subscription_id: null, stripe_customer_id: null, stripe_subscription_id: null,
  trial_started_at: iso(NOW - 5 * DAY + 17_000), trial_expires_at: iso(NOW + 25 * DAY + 17_000), commercial_trial_granted_at: iso(NOW - 5 * DAY + 17_000),
});
const expiredTrial = (id) => ({
  ...activeTrial(id), trial_started_at: iso(NOW - 32 * DAY), trial_expires_at: iso(NOW - 2 * DAY), commercial_trial_granted_at: iso(NOW - 32 * DAY),
});
const paidPro = (id) => ({
  id, subscription_status: 'pro', subscription_id: null, stripe_customer_id: 'cus_live_customer1', stripe_subscription_id: 'sub_live_subscription1',
  trial_started_at: null, trial_expires_at: null, commercial_trial_granted_at: null,
});
const authUser = (id, email) => ({ id, email, created_at: iso(NOW - 31 * DAY + 42_000), last_sign_in_at: iso(NOW - DAY + 42_000) });

function makeAdmin({ users = [], profiles = {}, effTier = 'pro', counts = {}, unreadable = [], fullPages = false } = {}) {
  const calls = { forbidden: [], rpc: [], selects: [] };
  const deny = (name) => () => { calls.forbidden.push(name); throw new Error(`forbidden call: ${name}`); };
  return {
    calls,
    auth: {
      admin: {
        listUsers: async ({ page }) => {
          if (fullPages) return { data: { users: Array.from({ length: 200 }, (_, i) => ({ id: `f${page}_${i}`, email: `f${page}_${i}@x.z` })) }, error: null };
          return { data: { users: page === 1 ? users : [] }, error: null };
        },
        getUserById: async (id) => ({ data: { user: users.find((u) => u.id === id) ?? null }, error: null }),
        createUser: deny('createUser'),
        updateUserById: deny('updateUserById'),
        deleteUser: deny('deleteUser'),
        inviteUserByEmail: deny('inviteUserByEmail'),
        generateLink: deny('generateLink'),
      },
      signInWithPassword: deny('signInWithPassword'),
      signInWithOtp: deny('signInWithOtp'),
      refreshSession: deny('refreshSession'),
      setSession: deny('setSession'),
      resetPasswordForEmail: deny('resetPasswordForEmail'),
      updateUser: deny('updateUser'),
    },
    from: (table) => ({
      select: (columns, options) => {
        calls.selects.push({ table, columns, options: options ?? null });
        return {
          eq: (_column, value) => ({
            maybeSingle: async () => ({ data: profiles[value] ?? null, error: null }),
            then: (resolve, reject) => Promise.resolve(
              unreadable.includes(table)
                ? { count: null, error: { message: 'relation does not exist' } }
                : { count: counts[table] ?? 0, error: null },
            ).then(resolve, reject),
          }),
        };
      },
      insert: deny(`insert:${table}`),
      update: deny(`update:${table}`),
      upsert: deny(`upsert:${table}`),
      delete: deny(`delete:${table}`),
    }),
    rpc: async (fn) => { calls.rpc.push(fn); return { data: effTier, error: null }; },
  };
}

const inspectTrial = (admin) => inspectCanaryIdentity({ adminClient: admin, email: TRIAL_EMAIL, purpose: 'canary_trial', label: 'trial canary' });
const inspectPaid = (admin) => inspectCanaryIdentity({ adminClient: admin, email: PAID_EMAIL, purpose: 'canary_paid', label: 'paid canary' });

describe('canary read-only inspection — identity', () => {
  it('exactly one identity with an active trial → ELIGIBLE_CREDENTIAL_PENDING, masked, digested, minute-rounded', async () => {
    const admin = makeAdmin({ users: [authUser('u1', TRIAL_EMAIL)], profiles: { u1: activeTrial('u1') } });
    const report = await inspectTrial(admin);
    expect(report.verdict).toBe(VERDICTS.ELIGIBLE);
    expect(report.statement).toBe('account state appears eligible; credential viability pending authorized canary');
    expect(report.identityCount).toBe(1);
    expect(report.maskedIdentity).toBe('o***@e***.test');
    expect(report.digest).toMatch(/^[0-9a-f]{12}$/);
    expect(report.authCreatedAt).toMatch(/:00\.000Z$/);
    expect(report.priorLastSignInAt).toMatch(/:00\.000Z$/);
    expect(report.trialExpiresAt).toMatch(/:00\.000Z$/);
    expect(report.trialWindowDays).toBe(30);
    expect(JSON.stringify(report)).not.toContain(TRIAL_EMAIL);
    expect(admin.calls.forbidden).toEqual([]);
  });

  it('reports a MISSING identity as ineligible with count 0', async () => {
    const report = await inspectTrial(makeAdmin({ users: [] }));
    expect([report.verdict, report.reason, report.identityCount]).toEqual([VERDICTS.INELIGIBLE, 'identity_missing', 0]);
  });

  it('reports a DUPLICATE identity as ambiguous and unsafe to mutate', async () => {
    const admin = makeAdmin({ users: [authUser('u1', TRIAL_EMAIL), authUser('u2', TRIAL_EMAIL.toUpperCase())] });
    const report = await inspectTrial(admin);
    expect([report.verdict, report.reason, report.identityCount]).toEqual([VERDICTS.AMBIGUOUS, 'duplicate_identity', 2]);
  });

  it('a truncated inventory scan is ambiguous, never treated as absent', async () => {
    const report = await inspectTrial(makeAdmin({ fullPages: true }));
    expect([report.verdict, report.reason]).toEqual([VERDICTS.AMBIGUOUS, 'inventory_scan_truncated']);
  });

  it('an unconfigured identity is ineligible without any lookup', async () => {
    const admin = makeAdmin();
    const report = await inspectCanaryIdentity({ adminClient: admin, email: '', purpose: 'canary_trial', label: 'trial canary' });
    expect([report.verdict, report.reason, report.maskedIdentity, report.digest]).toEqual([VERDICTS.INELIGIBLE, 'identity_not_configured', '***', null]);
  });
});

describe('canary read-only inspection — entitlement', () => {
  it('an expired trial is INELIGIBLE at server time, with its expiry reported', async () => {
    const admin = makeAdmin({ users: [authUser('u1', TRIAL_EMAIL)], profiles: { u1: expiredTrial('u1') }, effTier: 'free' });
    const report = await inspectTrial(admin);
    expect([report.verdict, report.reason, report.effectiveTier]).toEqual([VERDICTS.INELIGIBLE, 'trial_not_active_server_time', 'free']);
    expect(report.statement).toBe('account state is ineligible: trial_not_active_server_time');
    expect(report.trialExpiresAt).not.toBeNull();
  });

  it('Trial and paid states stay distinct: a paid profile is never an eligible trial, and a trial is never an eligible paid canary', async () => {
    const paidAsTrial = await inspectTrial(makeAdmin({ users: [authUser('p1', TRIAL_EMAIL)], profiles: { p1: paidPro('p1') } }));
    const trialAsPaid = await inspectPaid(makeAdmin({ users: [authUser('t1', PAID_EMAIL)], profiles: { t1: activeTrial('t1') } }));
    const paidAsPaid = await inspectPaid(makeAdmin({ users: [authUser('p1', PAID_EMAIL)], profiles: { p1: paidPro('p1') } }));
    expect([paidAsTrial.verdict, paidAsTrial.reason]).toEqual([VERDICTS.INELIGIBLE, 'trial_missing_commercial_marker']);
    expect([trialAsPaid.verdict, trialAsPaid.reason]).toEqual([VERDICTS.INELIGIBLE, 'paid_stored_tier_not_pro']);
    expect([paidAsPaid.verdict, paidAsPaid.billingIdentityShape]).toEqual([VERDICTS.ELIGIBLE, 'complete']);
  });

  it('a paid canary that is no longer server-effective Pro is ineligible', async () => {
    const report = await inspectPaid(makeAdmin({ users: [authUser('p1', PAID_EMAIL)], profiles: { p1: paidPro('p1') }, effTier: 'free' }));
    expect([report.verdict, report.reason]).toEqual([VERDICTS.INELIGIBLE, 'paid_not_effective_pro']);
  });

  it('a missing profile is ineligible; the only RPC called is effective_subscription_tier', async () => {
    const admin = makeAdmin({ users: [authUser('u1', TRIAL_EMAIL)], profiles: {} });
    const missing = await inspectTrial(admin);
    const eligibleAdmin = makeAdmin({ users: [authUser('u1', TRIAL_EMAIL)], profiles: { u1: activeTrial('u1') } });
    await inspectTrial(eligibleAdmin);
    expect([missing.verdict, missing.reason]).toEqual([VERDICTS.INELIGIBLE, 'profile_missing']);
    expect([...new Set(eligibleAdmin.calls.rpc)]).toEqual(['effective_subscription_tier']);
  });
});

describe('canary read-only inspection — redaction, no writes, no authentication', () => {
  it('never emits an email, a Stripe identifier or a token, and the guard fails closed when one appears', async () => {
    const admin = makeAdmin({ users: [authUser('p1', PAID_EMAIL)], profiles: { p1: paidPro('p1') } });
    const report = await inspectPaid(admin);
    const text = JSON.stringify(report);
    expect([text.includes(PAID_EMAIL), text.includes('cus_live'), text.includes('sub_live')]).toEqual([false, false, false]);
    expect(assertRedacted(report, [PAID_EMAIL])).toBe(true);
    expect(() => assertRedacted({ ...report, label: PAID_EMAIL }, [PAID_EMAIL])).toThrow(/redaction_violation/);
    expect(() => assertRedacted({ ...report, reason: 'sub_live_subscription1' })).toThrow(/billing_identifier/);
    expect(() => assertRedacted({ ...report, reason: 'eyJhbGciOiJIUzI1NiJ9' })).toThrow(/token_like/);
  });

  it('writes and authentication are impossible: every stub write/auth method throws, and none was reached', async () => {
    const admin = makeAdmin({ users: [authUser('u1', TRIAL_EMAIL), authUser('p1', PAID_EMAIL)], profiles: { u1: expiredTrial('u1'), p1: paidPro('p1') }, effTier: 'free' });
    const { results, allEligible } = await runCanaryInspection({ adminClient: admin, env: { CANARY_TRIAL_EMAIL: TRIAL_EMAIL, CANARY_PAID_EMAIL: PAID_EMAIL } });
    expect(results.map((r) => r.verdict)).toEqual([VERDICTS.INELIGIBLE, VERDICTS.INELIGIBLE]);
    expect(allEligible).toBe(false);
    expect(admin.calls.forbidden).toEqual([]);
    expect(results.map(formatCanaryLine).join('\n')).not.toMatch(/credential(s)? (ok|valid|viable)|\bPASS\b/i);
  });
});

describe('canary read-only inspection — dependency observation (PARTIAL, never deletion clearance)', () => {
  it('reads each LISTED dependent table as a COUNT only (head: true), never row contents', async () => {
    const admin = makeAdmin({ users: [authUser('u1', TRIAL_EMAIL)], profiles: { u1: activeTrial('u1') }, counts: { sessions: 3 } });
    const report = await inspectTrial(admin);
    const countReads = admin.calls.selects.filter((s) => s.table !== 'user_profiles');
    expect(countReads.map((s) => s.table).sort()).toEqual(DEPENDENTS.map(([t]) => t).sort());
    expect(countReads.every((s) => s.columns === '*' && s.options?.head === true && s.options?.count === 'exact')).toBe(true);
    expect(report.dependentRowCounts.sessions).toBe(3);
  });

  it('unreadable tables are named, not hidden', async () => {
    const unknown = await inspectTrial(makeAdmin({ users: [authUser('u1', TRIAL_EMAIL)], profiles: { u1: activeTrial('u1') }, unreadable: ['user_issue_reports'] }));
    expect(unknown.dependentRowCounts.user_issue_reports).toBe('unreadable');
    expect(unknown.unreadableTables).toEqual(['user_issue_reports']);
  });

  // #1483 P1-2. DEPENDENTS is hand-maintained and its completeness is NOT proven against the schema, so an
  // unlisted reference cannot be counted. No combination of these counts may authorize deletion, and the report
  // must never speak deletion-safe language. Clearance stays UNKNOWN_NOT_AUTHORIZED until a schema/migration
  // derived FK inventory proves the complete set and its delete rules — which this diagnostic deliberately
  // does not build.
  it('CASUALTY: no count pattern can authorize deletion — nonzero, all-zero, or fully readable', async () => {
    const withRows = await inspectTrial(makeAdmin({ users: [authUser('u1', TRIAL_EMAIL)], profiles: { u1: activeTrial('u1') }, counts: { sessions: 3, trial_entitlements: 1 } }));
    const allZero = await inspectTrial(makeAdmin({ users: [authUser('u1', TRIAL_EMAIL)], profiles: { u1: activeTrial('u1') } }));
    const unreadable = await inspectTrial(makeAdmin({ users: [authUser('u1', TRIAL_EMAIL)], profiles: { u1: activeTrial('u1') }, unreadable: ['sessions'] }));

    for (const report of [withRows, allZero, unreadable]) {
      expect(report.deletionClearance).toBe(DELETION_CLEARANCE.UNKNOWN);
      expect(report.inventoryCompleteness).toBe('unproven');
      expect(report.blockedBy).toBeNull();
      // The absence of observed obstructions is NOT clearance: an all-zero, fully readable view says the same
      // thing as an unreadable one, because the list itself is not proven complete.
      expect(report.deletionClearance).not.toBe('CLEAN');
    }
    // The emitted record carries no deletion-safe vocabulary at all.
    const emitted = JSON.stringify([withRows, allZero, unreadable]) + [withRows, allZero, unreadable].map(formatCanaryLine).join('\n');
    for (const banned of ['CLEAN', 'RESIDUE_ONLY', 'safe to delete', 'retirement', 'deletable']) {
      expect(emitted, `report must not claim ${banned}`).not.toContain(banned);
    }
  });

  it('no rule in the real dependency list is RESTRICT today — so the obstruction path needs injection to prove', () => {
    // Stated as a fact rather than used as a branch: a test that conditionally asserts proves nothing when the
    // condition is false, which is exactly what vitest/no-conditional-expect exists to catch.
    expect(DEPENDENTS.filter(([, , rule]) => rule !== 'CASCADE' && rule !== 'SET NULL')).toEqual([]);
  });

  it('a positive obstruction in the partial view IS reported as observed', () => {
    // A RESTRICT-ruled table with rows is real evidence of an obstruction even in an incomplete inventory, so
    // this path must stay live even while the real list contains no such rule.
    const synthetic = [['synthetic_restrict_table', 'user_id', 'RESTRICT']];
    const blocked = dependencyObservation({ synthetic_restrict_table: 2 }, synthetic);
    expect(blocked.deletionClearance).toBe(DELETION_CLEARANCE.BLOCKED);
    expect(blocked.blockedBy).toBe('synthetic_restrict_table');
    // Still never clearance: an obstruction found in a partial view does not make the rest of the view complete.
    expect(blocked.inventoryCompleteness).toBe('unproven');

    // Zero rows under the same RESTRICT rule is not an obstruction, and is still not clearance.
    const quiet = dependencyObservation({ synthetic_restrict_table: 0 }, synthetic);
    expect([quiet.deletionClearance, quiet.blockedBy]).toEqual([DELETION_CLEARANCE.UNKNOWN, null]);
  });
});

describe('canary read-only inspection — one snapshot decides AND is reported', () => {
  // Codex P2 4020951921 on #1483. The first implementation read the profile and ran the tier RPC here, then
  // called `verifyCanaryFoundation`, which reads AGAIN and returned only {ok, reason}. If entitlement changed
  // between the two reads, the second read could see a clean credentials-only Free profile — which that helper's
  // paid lane deliberately accepts — and return ok, while the report still showed the Pro-shaped snapshot read
  // first. The production diagnostic then called a stale paid identity ELIGIBLE.
  //
  // Per PM direction the helper now performs the single profile read and the single tier RPC and returns the
  // snapshot it validated; the inspection reads nothing about the profile itself. So the one read asserted below
  // happens INSIDE `verifyCanaryFoundation` — reached through it, not performed here — and the verdict and the
  // reported facts provably come from that same snapshot.
  const downgradedFree = (id) => ({
    ...paidPro(id), subscription_status: 'free', stripe_customer_id: null, stripe_subscription_id: null,
  });

  it('reads the profile exactly ONCE, so no later change can be paired with the reported snapshot', async () => {
    let profileReads = 0;
    // Serves Pro on the first read and a downgraded Free profile on every read after it: a second read would
    // judge a different identity state than the one this report shows.
    const profiles = {
      get p1() {
        profileReads += 1;
        return profileReads === 1 ? paidPro('p1') : downgradedFree('p1');
      },
    };
    const admin = makeAdmin({ users: [authUser('p1', PAID_EMAIL)], profiles });
    const report = await inspectPaid(admin);

    expect(profileReads).toBe(1);
    expect(admin.calls.selects.filter((s) => s.table === 'user_profiles')).toHaveLength(1);
    expect(admin.calls.rpc).toEqual(['effective_subscription_tier']);
    // Verdict and reported facts both come from that single read.
    expect([report.verdict, report.storedTier, report.billingIdentityShape]).toEqual([VERDICTS.ELIGIBLE, 'pro', 'complete']);
  });

  it('a downgraded snapshot is judged as exactly the state it reports', async () => {
    const admin = makeAdmin({ users: [authUser('p1', PAID_EMAIL)], profiles: { p1: downgradedFree('p1') }, effTier: 'free' });
    const report = await inspectPaid(admin);
    expect([report.verdict, report.reason]).toEqual([VERDICTS.INELIGIBLE, 'paid_not_effective_pro']);
    expect([report.storedTier, report.effectiveTier, report.billingIdentityShape]).toEqual(['free', 'free', 'none']);
    expect(admin.calls.forbidden).toEqual([]);
  });
});
