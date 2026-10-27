// @vitest-environment node
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { provisionCanaryCredential, maskEmail, strictLookup } from '../../scripts/lib/canaryAccountAdmin.mjs';

// #1294 focused Admin - Test Users security proofs. Injectable in-memory mocks — no network, no real
// accounts. Proves: DEFINITIVE-absence create + authenticate + id-binding; safe authenticated reuse bound to
// the exact looked-up id; truncated/ambiguous inventory → BLOCKED (never a blind create); wrong password →
// BLOCKED without reset; authoritative 30-day/immutable-marker/server-time trial; synthetic/partial paid
// rejection; no credential leakage; NO tier/sub/trial/paid writes.

const SECRETS = {
  CANARY_TRIAL_EMAIL: 'operator+trial@example.test',
  CANARY_TRIAL_PASSWORD: 'trial-secret-pw',
  CANARY_PAID_EMAIL: 'operator+paid@example.net',
  CANARY_PAID_PASSWORD: 'paid-secret-pw',
  FREE_TEST_EMAIL: 'free-user@example.test',
  FREE_TEST_PASSWORD: 'free-secret-pw',
};
const iso = (ms) => new Date(ms).toISOString();
const START = Date.now() - 5 * 86400_000;
const DAY = 86400_000;
const trialProfile = (over = {}) => ({
  id: 'x', subscription_status: 'free', subscription_id: null, stripe_customer_id: null, stripe_subscription_id: null,
  trial_started_at: iso(START), trial_expires_at: iso(START + 30 * DAY), commercial_trial_granted_at: iso(START),
  ...(typeof over === 'string' ? { id: over } : over),
});

const THROWAWAY_SECRETS = {
  ...SECRETS,
  THROWAWAY_TEST_EMAIL: 'one-off-free@example.test',
  THROWAWAY_TEST_PASSWORD: 'one-off-fixture-password',
};
const runThrowaway = (over = {}) => provisionCanaryCredential({
  adminClient: over.admin ?? makeAdmin({ profile: trialProfile('created-id') }),
  makeSignInClient: over.makeSignInClient ?? makeSignIn(),
  secrets: over.secrets ?? THROWAWAY_SECRETS,
  purpose: 'throwaway_free',
  action: over.action ?? 'create',
  inputs: over.inputs ?? {},
});

describe('throwaway_free: fixed credentials, absent identity, one creation only', () => {
  it('creates once, binds public authenticated UID and verifies Free/unbilled foundation without credential output', async () => {
    const admin = makeAdmin({ profile: trialProfile('created-id') });
    const result = await runThrowaway({ admin });
    expect(result.result).toBe('CREATED');
    expect(result.facts).toMatchObject({ created_once: true, authenticated_uid_verified: true, free_profile_verified: true, unbilled_verified: true });
    expect(admin.calls.createUser).toEqual([{ email: THROWAWAY_SECRETS.THROWAWAY_TEST_EMAIL, password: THROWAWAY_SECRETS.THROWAWAY_TEST_PASSWORD, email_confirm: true }]);
    expect(admin.calls.updateUserById).toHaveLength(0);
    expect(admin.calls.from).toEqual(['user_profiles']);
    const output = JSON.stringify(result);
    for (const secret of [...Object.values(THROWAWAY_SECRETS), 'created-id']) expect(output).not.toContain(secret);
  });

  it.each(['THROWAWAY_TEST_EMAIL', 'THROWAWAY_TEST_PASSWORD'])('refuses missing fixed %s even when shared or arbitrary credentials exist', async (key) => {
    const admin = makeAdmin();
    const result = await runThrowaway({ admin, secrets: { ...THROWAWAY_SECRETS, [key]: '', SOAK_TEST_PASSWORD: 'shared-fixture-password', SOME_SELECTED_SECRET: 'selected-fixture-password' } });
    expect(result.result).toBe('BLOCKED');
    expect(result.facts.reason).toContain(`missing_${key}`);
    expect(admin.calls.listUsers).toBe(0);
    expect(admin.calls.createUser).toHaveLength(0);
  });

  it.each([{ email: 'input@example.test' }, { password: 'plaintext-fixture-password' }, { credentialsPresent: true }])('rejects plaintext dispatch inputs before any lookup: %j', async (inputs) => {
    const admin = makeAdmin();
    const result = await runThrowaway({ admin, inputs });
    expect(result).toMatchObject({ result: 'BLOCKED', facts: { reason: 'plaintext_credentials_forbidden' } });
    expect(admin.calls.listUsers).toBe(0);
    expect(admin.calls.createUser).toHaveLength(0);
    expect(JSON.stringify(result)).not.toContain('plaintext-fixture-password');
  });

  it('rejects non-create action and paid tier selection without touching accounts', async () => {
    const admin = makeAdmin();
    expect(await runThrowaway({ admin, action: 'setup' })).toMatchObject({ result: 'BLOCKED', facts: { reason: 'throwaway_requires_create' } });
    expect(await runThrowaway({ admin, inputs: { tier: 'pro' } })).toMatchObject({ result: 'BLOCKED', facts: { reason: 'throwaway_requires_free' } });
    expect(admin.calls.listUsers).toBe(0);
    expect(admin.calls.createUser).toHaveLength(0);
  });

  it.each(['CANARY_TRIAL_EMAIL', 'CANARY_PAID_EMAIL', 'FREE_TEST_EMAIL'])('rejects collision with maintained %s', async (key) => {
    const admin = makeAdmin();
    const result = await runThrowaway({ admin, secrets: { ...THROWAWAY_SECRETS, THROWAWAY_TEST_EMAIL: THROWAWAY_SECRETS[key].toUpperCase() } });
    expect(result.result).toBe('BLOCKED');
    expect(result.facts.reason).toContain('not_distinct');
    expect(admin.calls.createUser).toHaveLength(0);
  });

  it('existing identity stops without signing in, reusing, resetting or creating', async () => {
    const admin = makeAdmin({ pages: [[{ email: THROWAWAY_SECRETS.THROWAWAY_TEST_EMAIL, id: 'existing-id' }]] });
    let authentications = 0;
    const result = await runThrowaway({ admin, makeSignInClient: () => ({ auth: { signInWithPassword: async () => { authentications++; throw new Error('must not authenticate existing identity'); } } }) });
    expect(result).toMatchObject({ result: 'BLOCKED', facts: { reason: 'throwaway_identity_already_exists' } });
    expect(authentications).toBe(0);
    expect(admin.calls.createUser).toHaveLength(0);
    expect(admin.calls.updateUserById).toHaveLength(0);
  });

  it('create race stops after one mutation; never re-looks up and reuses the race winner', async () => {
    const admin = makeAdmin({ createError: { message: 'A user with this email address has already been registered' } });
    const result = await runThrowaway({ admin });
    expect(result).toMatchObject({ result: 'BLOCKED', facts: { reason: 'throwaway_creation_not_confirmed' } });
    expect(admin.calls.createUser).toHaveLength(1);
    expect(admin.calls.listUsers).toBe(1);
    expect(admin.calls.from).toHaveLength(0);
  });

  it('uncertain network creation stops once and suppresses raw errors containing credentials', async () => {
    const admin = makeAdmin();
    let creations = 0;
    admin.auth.admin.createUser = async () => { creations++; throw new Error(`${THROWAWAY_SECRETS.THROWAWAY_TEST_PASSWORD} network failed`); };
    const result = await runThrowaway({ admin });
    expect(result).toMatchObject({ result: 'BLOCKED', facts: { reason: 'throwaway_creation_outcome_uncertain', creation_attempted: true } });
    expect(creations).toBe(1);
    expect(JSON.stringify(result)).not.toContain(THROWAWAY_SECRETS.THROWAWAY_TEST_PASSWORD);
  });

  it('unreadable inventory is not definitive absence', async () => {
    const admin = makeAdmin();
    admin.auth.admin.listUsers = async () => ({ data: null, error: null });
    const result = await runThrowaway({ admin });
    expect(result).toMatchObject({ result: 'BLOCKED', facts: { reason: 'auth_admin_error_[unreadable_inventory]' } });
    expect(admin.calls.createUser).toHaveLength(0);
  });

  it('ambiguous or truncated inventory and a missing created UID never permit reuse or another create', async () => {
    for (const options of [
      { pages: [[{ email: THROWAWAY_SECRETS.THROWAWAY_TEST_EMAIL, id: 'one' }, { email: THROWAWAY_SECRETS.THROWAWAY_TEST_EMAIL, id: 'two' }]] },
      { full: true },
    ]) {
      const admin = makeAdmin(options);
      expect((await runThrowaway({ admin })).result).toBe('BLOCKED');
      expect(admin.calls.createUser).toHaveLength(0);
    }
    const admin = makeAdmin({ createId: '' });
    expect(await runThrowaway({ admin })).toMatchObject({ result: 'BLOCKED', facts: { reason: 'create_returned_no_id' } });
    expect(admin.calls.createUser).toHaveLength(1);
    expect(admin.calls.from).toHaveLength(0);
  });

  it.each([
    [{ subscription_status: 'pro' }, 'throwaway_profile_not_free'],
    [{ subscription_status: 'trial_expired' }, 'throwaway_profile_not_free'],
    [{ subscription_id: 'legacy-billing-fixture' }, 'throwaway_billing_identity_present'],
    [{ stripe_customer_id: 'customer-fixture' }, 'throwaway_billing_identity_present'],
    [{ subscription_id: 0 }, 'throwaway_billing_identity_present'],
    [{ id: 'other-user' }, 'throwaway_profile_id_mismatch'],
  ])('refuses the wrong profile after creation: %j', async (over, reason) => {
    const admin = makeAdmin({ profile: trialProfile({ id: 'created-id', ...over }) });
    const result = await runThrowaway({ admin });
    expect(result).toMatchObject({ result: 'BLOCKED', facts: { reason } });
    expect(admin.calls.createUser).toHaveLength(1);
    expect(admin.calls.updateUserById).toHaveLength(0);
  });

  it('auth UID mismatch refuses after exactly one creation', async () => {
    const admin = makeAdmin({ profile: trialProfile('created-id') });
    const result = await runThrowaway({ admin, makeSignInClient: makeSignIn({ userId: 'other-user' }) });
    expect(result).toMatchObject({ result: 'BLOCKED', facts: { reason: 'authenticated_id_mismatch' } });
    expect(admin.calls.createUser).toHaveLength(1);
  });

  it('maintained free_test keeps its existing authenticated reuse contract', async () => {
    const admin = makeAdmin({ pages: [[{ email: SECRETS.FREE_TEST_EMAIL, id: 'found-id' }]], profile: trialProfile('found-id') });
    expect(await run({ admin, purpose: 'free_test', signIn: { userId: 'found-id' } })).toMatchObject({ result: 'REUSED' });
    expect(admin.calls.createUser).toHaveLength(0);
  });
});

// Execute the actual CLI and both real core modules with only the external SDK/dotenv replaced.
// The SDK records counts/booleans only; no network, actual account, credential file or secret store.
function runThrowawayCli(over = {}, args = []) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'throwaway-admin-fixture-'));
  const audit = path.join(directory, 'audit.jsonl');
  try {
    fs.mkdirSync(path.join(directory, 'scripts/lib'), { recursive: true });
    for (const file of ['scripts/setup-throwaway-test-user.mjs', 'scripts/lib/canaryAccountAdmin.mjs', 'scripts/lib/canaryProvision.mjs'])
      fs.copyFileSync(path.resolve(file), path.join(directory, file));
    for (const [name, source] of [
      ['dotenv', 'export const config = () => { throw new Error("local env loading forbidden"); };'],
      ['@supabase/supabase-js', `import fs from 'node:fs';
const note = value => fs.appendFileSync(process.env.FIXTURE_AUDIT, JSON.stringify(value)+'\\n');
const uid='fixture-created-uid';
export const createClient = (_url,key) => ({
 auth:{admin:{listUsers:async()=>{note({operation:'lookup'});return {data:{users:[]},error:null};},
 createUser:async p=>{note({operation:'create',fixedCredentials:p.email===process.env.THROWAWAY_TEST_EMAIL&&p.password===process.env.THROWAWAY_TEST_PASSWORD});
 if(process.env.FIXTURE_UNCERTAIN==='true')throw new Error(process.env.THROWAWAY_TEST_PASSWORD+' uncertain');
 return {data:{user:{id:uid}},error:null};}},
 signInWithPassword:async()=>{note({operation:'authenticate',anon:key==='anon-fixture-key'});return {data:{user:{id:uid}},error:null};}},
 from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{id:uid,subscription_status:'free',subscription_id:null,stripe_customer_id:null,stripe_subscription_id:null,trial_started_at:'2026-10-01T00:00:00.000Z',trial_expires_at:'2026-10-31T00:00:00.000Z',commercial_trial_granted_at:'2026-10-01T00:00:00.000Z'},error:null})})})}),
 rpc:async()=>({data:'pro',error:null})
});`],
    ]) {
      const target = path.join(directory, 'node_modules', name);
      fs.mkdirSync(target, { recursive: true });
      fs.writeFileSync(path.join(target, 'package.json'), JSON.stringify({ name, type: 'module', exports: './index.mjs' }));
      fs.writeFileSync(path.join(target, 'index.mjs'), source);
    }
    const env = { PATH: process.env.PATH, ACTION: 'create', CREATE_PURPOSE: 'throwaway_free',
      SUPABASE_URL: 'https://fixture.invalid', SUPABASE_SERVICE_ROLE_KEY: 'admin-fixture-key', SUPABASE_ANON_KEY: 'anon-fixture-key',
      ...THROWAWAY_SECRETS, FIXTURE_AUDIT: audit, ...over };
    const result = spawnSync(process.execPath, ['scripts/setup-throwaway-test-user.mjs', ...args], { cwd: directory, env, encoding: 'utf8', timeout: 5000 });
    const calls = fs.existsSync(audit) ? fs.readFileSync(audit, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
    return { ...result, calls };
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

describe('throwaway_free actual CLI boundary', () => {
  it('runs the real CLI without dotenv, creates/authenticates once, and emits only sanitized receipts', () => {
    const result = runThrowawayCli();
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.calls).toEqual([{ operation: 'lookup' }, { operation: 'create', fixedCredentials: true }, { operation: 'authenticate', anon: true }]);
    expect(result.stdout).toContain('"result":"CREATED"');
    for (const value of [...Object.values(THROWAWAY_SECRETS), 'admin-fixture-key', 'anon-fixture-key', 'fixture-created-uid'])
      expect(result.stdout + result.stderr).not.toContain(value);
  });

  it.each([
    [{ THROWAWAY_TEST_PASSWORD: '', SOAK_TEST_PASSWORD: 'shared-fixture-password' }, 'missing_THROWAWAY_TEST_PASSWORD'],
    [{ CREATE_INPUTS_PRESENT: 'true' }, 'plaintext_credentials_forbidden'],
    [{ CREATE_USER_PASSWORD: 'plaintext-fixture-password' }, 'plaintext_credentials_forbidden'],
    [{ CREATE_USER_TIER: 'pro' }, 'throwaway_requires_free'],
    [{ ACTION: 'setup' }, 'throwaway_requires_create'],
    [{ SUPABASE_URL: '' }, 'missing_SUPABASE_URL'],
    [{ SUPABASE_SERVICE_ROLE_KEY: '' }, 'missing_SUPABASE_SERVICE_ROLE_KEY'],
    [{ SUPABASE_ANON_KEY: '' }, 'missing_SUPABASE_ANON_KEY'],
  ])('refuses bad inputs in the real CLI without any admin lookup: %j', (over, reason) => {
    const result = runThrowawayCli(over);
    expect(result.status).toBe(1);
    expect(result.stdout + result.stderr).toContain(reason);
    expect(result.calls).toEqual([]);
    expect(result.stdout + result.stderr).not.toContain('plaintext-fixture-password');
  });

  it('uncertain create exits once, without resetting/recreating or printing the raw exception', () => {
    const result = runThrowawayCli({ FIXTURE_UNCERTAIN: 'true' });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('throwaway_creation_outcome_uncertain');
    expect(result.calls.filter(x => x.operation === 'create')).toHaveLength(1);
    expect(result.stdout + result.stderr).not.toContain(THROWAWAY_SECRETS.THROWAWAY_TEST_PASSWORD);
  });

  it('dedicated CLI refuses plaintext arguments without echoing them or touching auth', () => {
    const result = runThrowawayCli({}, ['--password=plaintext-fixture-password']);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('unexpected_cli_arguments');
    expect(result.stdout + result.stderr).not.toContain('plaintext-fixture-password');
    expect(result.calls).toEqual([]);
  });

  it('dedicated workflow keeps both identity/password secret and never invokes maintained setup (static contract)', () => {
    const source = fs.readFileSync(path.resolve('.github/workflows/setup-throwaway-test-user.yml'), 'utf8');
    const step = source.split('      - name: Create one secret-backed throwaway Free account\n')[1]?.split('      - name:')[0];
    expect(step).toBeTruthy();
    expect(step).toContain('THROWAWAY_TEST_EMAIL: ${{ secrets.THROWAWAY_TEST_EMAIL }}');
    expect(step).toContain('THROWAWAY_TEST_PASSWORD: ${{ secrets.THROWAWAY_TEST_PASSWORD }}');
    expect(source).not.toMatch(/vars\.THROWAWAY_TEST_EMAIL|github\.event\.inputs|SOAK_TEST_PASSWORD|FREE_TEST_PASSWORD|CANARY_(?:TRIAL|PAID)_PASSWORD|secrets\[/);
    expect(step).toContain('run: node scripts/setup-throwaway-test-user.mjs');
    expect(source).not.toContain('setup-test-users.mjs');
    const maintained = fs.readFileSync(path.resolve('.github/workflows/setup-test-users.yml'), 'utf8');
    expect(maintained).not.toContain('throwaway_free');
    const script = fs.readFileSync(path.resolve('scripts/setup-throwaway-test-user.mjs'), 'utf8');
    expect(script).not.toMatch(/from ['"]dotenv|writeFile|SOAK_TEST_PASSWORD|FREE_TEST_PASSWORD|CANARY_(?:TRIAL|PAID)_PASSWORD/);
  });
});

function makeAdmin({ pages = [[]], full = false, fullMatchFirst = null, profile, createId = 'created-id', createError = null, effTier = 'pro' } = {}) {
  const calls = { listUsers: 0, createUser: [], updateUserById: [], from: [], rpc: [] };
  return {
    calls,
    auth: {
      admin: {
        listUsers: async ({ page }) => {
          calls.listUsers++;
          if (full) {
            const filler = Array.from({ length: 200 }, (_, i) => ({ email: `f${page}_${i}@x.z`, id: `f${page}_${i}` }));
            if (fullMatchFirst && page === 1) filler[0] = { email: fullMatchFirst, id: 'early-match' }; // one match, but pages stay full
            return { data: { users: filler }, error: null };
          }
          return { data: { users: pages[page - 1] || [] }, error: null };
        },
        createUser: async (payload) => { calls.createUser.push(payload); return createError ? { data: null, error: createError } : { data: { user: { id: createId } }, error: null }; },
        updateUserById: async (...a) => { calls.updateUserById.push(a); return { data: {}, error: null }; },
      },
    },
    from: (t) => { calls.from.push(t); return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: profile ?? null, error: null }) }) }) }; },
    rpc: async (fn, args) => { calls.rpc.push([fn, args]); return { data: effTier, error: null }; },
  };
}
const makeSignIn = ({ ok = true, userId = 'created-id', error = null } = {}) =>
  () => ({ auth: { signInWithPassword: async () => (ok ? { data: { user: { id: userId } }, error: null } : { data: null, error }) } });

const run = (over = {}) => provisionCanaryCredential({
  adminClient: over.admin ?? makeAdmin(over.adminOpts ?? {}),
  makeSignInClient: over.makeSignInClient ?? makeSignIn(over.signIn ?? {}),
  secrets: over.secrets ?? SECRETS,
  purpose: over.purpose ?? 'canary_trial',
});

describe('strictLookup', () => {
  it('found / absent / ambiguous / truncated', async () => {
    expect(await strictLookup(makeAdmin({ pages: [[{ email: 'a@b.c', id: 'i1' }]] }), 'a@b.c')).toMatchObject({ status: 'found', userId: 'i1' });
    expect(await strictLookup(makeAdmin({ pages: [[]] }), 'a@b.c')).toMatchObject({ status: 'absent' });
    expect(await strictLookup(makeAdmin({ pages: [[{ email: 'a@b.c', id: 'i1' }, { email: 'A@B.C', id: 'i2' }]] }), 'a@b.c')).toMatchObject({ status: 'ambiguous' });
    expect(await strictLookup(makeAdmin({ full: true }), 'a@b.c')).toMatchObject({ status: 'truncated' });
  });

  it('ONE match before the page cap with a full final page → truncated (a 2nd match could be unscanned)', async () => {
    const r = await strictLookup(makeAdmin({ full: true, fullMatchFirst: 'a@b.c' }), 'a@b.c');
    expect(r.status).toBe('truncated'); // NOT 'found' — uniqueness cannot be proven from a truncated scan
  });
});

describe('#1294 Admin - Test Users canary credential seam', () => {
  it('ABSENT trial → CREATE + authenticate + id-binding; writes NO tier/sub/trial; authoritative trial readback', async () => {
    const admin = makeAdmin({ pages: [[]], profile: trialProfile('created-id') });
    const r = await provisionCanaryCredential({ adminClient: admin, makeSignInClient: makeSignIn({ userId: 'created-id' }), secrets: SECRETS, purpose: 'canary_trial' });
    expect(r.result).toBe('CREATED');
    expect(r.facts.trial_active_server_time).toBe(true);
    expect(r.facts.trial_window_days).toBe(30);
    expect(admin.calls.createUser).toEqual([{ email: 'operator+trial@example.test', password: 'trial-secret-pw', email_confirm: true }]);
    expect(admin.calls.updateUserById).toHaveLength(0);   // never mutates an account row
    expect(admin.calls.from).toEqual(['user_profiles']);   // read-back only
  });

  it('ABSENT but authenticated id != created id → BLOCKED (identity not bound)', async () => {
    const r = await run({ adminOpts: { pages: [[]], profile: trialProfile(), createId: 'created-id' }, signIn: { userId: 'someone-else' } });
    expect(r.result).toBe('BLOCKED');
    expect(r.facts.reason).toBe('authenticated_id_mismatch');
  });

  it('PRESENT + correct password → REUSED bound to exact found id (no duplicate, no reset)', async () => {
    const admin = makeAdmin({ pages: [[{ email: 'operator+trial@example.test', id: 'found-id' }]], profile: trialProfile('found-id') });
    const r = await provisionCanaryCredential({ adminClient: admin, makeSignInClient: makeSignIn({ userId: 'found-id' }), secrets: SECRETS, purpose: 'canary_trial' });
    expect(r.result).toBe('REUSED');
    expect(admin.calls.createUser).toHaveLength(0);
    expect(admin.calls.updateUserById).toHaveLength(0);
    expect(r.facts.password_reset).toBe(false);
  });

  it('PRESENT + WRONG password → BLOCKED without reset or duplicate', async () => {
    const admin = makeAdmin({ pages: [[{ email: 'operator+trial@example.test', id: 'found-id' }]], profile: trialProfile('found-id') });
    const r = await provisionCanaryCredential({ adminClient: admin, makeSignInClient: makeSignIn({ ok: false, error: { code: 'invalid_credentials', message: 'Invalid login credentials' } }), secrets: SECRETS, purpose: 'canary_trial' });
    expect(r.result).toBe('BLOCKED');
    expect(r.facts.password_reset).toBe(false);
    expect(admin.calls.createUser).toHaveLength(0);
    expect(admin.calls.updateUserById).toHaveLength(0);
  });

  it('TRUNCATED inventory scan → BLOCKED, never a blind create', async () => {
    const admin = makeAdmin({ full: true });
    const r = await provisionCanaryCredential({ adminClient: admin, makeSignInClient: makeSignIn(), secrets: SECRETS, purpose: 'canary_trial' });
    expect(r.result).toBe('BLOCKED');
    expect(r.facts.reason).toBe('inventory_scan_truncated');
    expect(admin.calls.createUser).toHaveLength(0);
  });

  it('AMBIGUOUS duplicate normalized-email → BLOCKED', async () => {
    const r = await run({ adminOpts: { pages: [[{ email: 'operator+trial@example.test', id: 'a' }, { email: 'OPERATOR+trial@Example.test', id: 'b' }]] } });
    expect(r.result).toBe('BLOCKED');
    expect(r.facts.reason).toBe('duplicate_identity');
  });

  it('BLOCKS missing / malformed / equal / prohibited-domain identities', async () => {
    expect((await run({ secrets: { ...SECRETS, CANARY_TRIAL_EMAIL: '' } })).result).toBe('BLOCKED');
    expect((await run({ secrets: { ...SECRETS, CANARY_TRIAL_EMAIL: 'not-an-email' } })).result).toBe('BLOCKED');
    expect((await run({ secrets: { ...SECRETS, CANARY_PAID_EMAIL: 'operator+trial@example.test' } })).result).toBe('BLOCKED');
    expect((await run({ secrets: { ...SECRETS, CANARY_TRIAL_EMAIL: 'x@speaksharp.app' } })).result).toBe('BLOCKED');
    expect((await run({ secrets: { ...SECRETS, CANARY_TRIAL_EMAIL: 'x@mail.speaksharp.app' } })).result).toBe('BLOCKED');
  });

  it('BLOCKS when the public anon sign-in client is unavailable (no service-role fallback)', async () => {
    const r = await run({ makeSignInClient: () => null });
    expect(r.result).toBe('BLOCKED');
    expect(r.facts.reason).toBe('no_anon_sign_in_client');
  });

  it('trial readback BLOCKS synthetic sub / wrong 30-day window / missing marker / not-active-server-time', async () => {
    const found = (over) => ({ adminOpts: { pages: [[{ email: 'operator+trial@example.test', id: 'found-id' }]], profile: trialProfile({ id: 'found-id', ...over.profile }), effTier: over.effTier }, signIn: { userId: 'found-id' } });
    expect((await run(found({ profile: { stripe_subscription_id: 'sub_test_x' } }))).facts.reason).toBe('synthetic_subscription_present');
    expect((await run(found({ profile: { trial_expires_at: iso(START + 10 * DAY) } }))).facts.reason).toBe('trial_window_not_exactly_30d');
    expect((await run(found({ profile: { commercial_trial_granted_at: null } }))).facts.reason).toBe('trial_missing_commercial_marker');
    expect((await run(found({ effTier: 'free' }))).facts.reason).toBe('trial_not_active_server_time');
  });

  it('#1294: active-trial SUCCESS goes through the CANONICAL 5-arg overload (passes the commercial marker)', async () => {
    // A found, authenticating trial account with a valid immutable-marker + exact-30-day window resolves to
    // REUSED (effTier 'pro' from the marker+window). Lock that the marker KEY was passed to the tier RPC so
    // this can never silently regress to the legacy 4-arg overload that fails closed for trials.
    const admin = makeAdmin({ pages: [[{ email: 'operator+trial@example.test', id: 'found-id' }]], profile: trialProfile({ id: 'found-id' }), effTier: 'pro' });
    const r = await provisionCanaryCredential({ adminClient: admin, makeSignInClient: makeSignIn({ userId: 'found-id' }), secrets: SECRETS, purpose: 'canary_trial' });
    expect(r.result).toBe('REUSED');
    expect(r.facts.trial_active_server_time).toBe(true);
    const tierCall = admin.calls.rpc.find((c) => c[0] === 'effective_subscription_tier');
    expect(tierCall, 'tier RPC was called').toBeTruthy();
    expect(tierCall[1]).toHaveProperty('p_commercial_trial_granted_at');
  });

  it('paid create establishes credentials only; rejects partial/synthetic billing shapes', async () => {
    // clean fresh paid account (billing absent) → CREATED, no synthetic
    const ok = await run({ purpose: 'canary_paid', secrets: SECRETS, adminOpts: { pages: [[]], profile: trialProfile('created-id') } });
    expect(ok.result).toBe('CREATED');
    expect(ok.facts.paid_synthetic).toBe(false);
    // partial billing shape (customer but no subscription) → BLOCKED
    const partial = await run({ purpose: 'canary_paid', adminOpts: { pages: [[{ email: 'operator+paid@example.net', id: 'found-id' }]], profile: trialProfile({ id: 'found-id', stripe_customer_id: 'cus_x' }) }, signIn: { userId: 'found-id' } });
    expect(partial.result).toBe('BLOCKED');
    expect(partial.facts.reason).toBe('paid_partial_billing_identity');
  });

  it('NEVER leaks a raw email or password; output is masked', async () => {
    const r = await run({ adminOpts: { pages: [[]], profile: trialProfile('created-id') }, signIn: { userId: 'created-id' } });
    const s = JSON.stringify(r);
    expect(s).not.toContain('trial-secret-pw');
    expect(s).not.toContain('operator+trial@example.test');
    expect(r.maskedEmail).toBe('o***@e***.test');
  });

  it('maskEmail keeps only first-letter hints', () => {
    expect(maskEmail('alice.smith@company.co')).toBe('a***@c***.co');
  });

  // free_test — a genuine standard Free account (active 30-day trial), secret-backed, distinct from canaries.
  it('free_test ABSENT → CREATE + authenticate + verify a genuine active 30-day trial', async () => {
    const admin = makeAdmin({ pages: [[]], profile: trialProfile('created-id') });
    const r = await provisionCanaryCredential({ adminClient: admin, makeSignInClient: makeSignIn({ userId: 'created-id' }), secrets: SECRETS, purpose: 'free_test' });
    expect(r.result).toBe('CREATED');
    expect(r.facts.trial_active_server_time).toBe(true);
    expect(r.facts.trial_window_days).toBe(30);
    expect(admin.calls.createUser).toEqual([{ email: 'free-user@example.test', password: 'free-secret-pw', email_confirm: true }]);
    expect(admin.calls.updateUserById).toHaveLength(0);
  });

  it('free_test BLOCKS an identity that collides with a canary, or uses a prohibited domain', async () => {
    expect((await run({ purpose: 'free_test', secrets: { ...SECRETS, FREE_TEST_EMAIL: 'operator+trial@example.test' } })).result).toBe('BLOCKED'); // == canary_trial
    expect((await run({ purpose: 'free_test', secrets: { ...SECRETS, FREE_TEST_EMAIL: 'operator+paid@example.net' } })).result).toBe('BLOCKED'); // == canary_paid
    expect((await run({ purpose: 'free_test', secrets: { ...SECRETS, FREE_TEST_EMAIL: 'x@speaksharp.app' } })).result).toBe('BLOCKED');
    expect((await run({ purpose: 'free_test', secrets: { ...SECRETS, FREE_TEST_EMAIL: '' } })).result).toBe('BLOCKED');
  });

  // #2 — a purpose FAILS CLOSED when a RELEVANT PEER identity is missing/malformed (not just the selected one).
  it('BLOCKS when a required peer identity is missing or malformed, for all three purposes', async () => {
    // canary_trial requires a valid canary_paid peer
    expect((await run({ purpose: 'canary_trial', secrets: { ...SECRETS, CANARY_PAID_EMAIL: '' } })).result).toBe('BLOCKED');
    expect((await run({ purpose: 'canary_trial', secrets: { ...SECRETS, CANARY_PAID_EMAIL: 'not-an-email' } })).result).toBe('BLOCKED');
    expect((await run({ purpose: 'canary_trial', secrets: { ...SECRETS, CANARY_PAID_EMAIL: 'peer@speaksharp.app' } })).result).toBe('BLOCKED');
    // canary_paid requires a valid canary_trial peer
    expect((await run({ purpose: 'canary_paid', secrets: { ...SECRETS, CANARY_TRIAL_EMAIL: '' } })).result).toBe('BLOCKED');
    // free_test requires BOTH canary peers
    expect((await run({ purpose: 'free_test', secrets: { ...SECRETS, CANARY_TRIAL_EMAIL: '' } })).result).toBe('BLOCKED');
    expect((await run({ purpose: 'free_test', secrets: { ...SECRETS, CANARY_PAID_EMAIL: 'malformed' } })).result).toBe('BLOCKED');
  });

  // #3 — the trial window must be EXACTLY 30 days (a narrow tolerance), not ±1 day.
  it.each([
    ['29 days', START + 29 * DAY, 'BLOCKED'],
    ['29d23h', START + 30 * DAY - 3600_000, 'BLOCKED'],
    ['exactly 30 days', START + 30 * DAY, 'CREATED'],
    ['30d1h', START + 30 * DAY + 3600_000, 'BLOCKED'],
  ])('trial window %s → %s', async (_label, expiryMs, expected) => {
    const admin = makeAdmin({ pages: [[]], profile: trialProfile({ id: 'created-id', trial_expires_at: iso(expiryMs) }) });
    const r = await provisionCanaryCredential({ adminClient: admin, makeSignInClient: makeSignIn({ userId: 'created-id' }), secrets: SECRETS, purpose: 'canary_trial' });
    expect(r.result).toBe(expected);
    // No conditional expect: BLOCKED rows must name the exact-30d reason; the CREATED row carries none.
    expect(r.facts?.reason ?? '').toMatch(expected === 'BLOCKED' ? /trial_window_not_exactly/ : /^$/);
  });
});
