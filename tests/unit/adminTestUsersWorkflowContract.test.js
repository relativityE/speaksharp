import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import yaml from 'js-yaml';

// #1294 workflow contract for Admin - Test Users. The rename is display-name ONLY; the filename, action
// names, and standard free/pro create path stay stable. The Basic tier option and Basic count inputs are
// gone, an additive create_purpose selector is present, and the four canary secrets are wired at the exact
// step that runs the provisioning script (canary passwords are never dispatch inputs).
const wf = yaml.load(readFileSync(resolve(process.cwd(), '.github/workflows/setup-test-users.yml'), 'utf8'));
const inputs = wf.on.workflow_dispatch.inputs;
const raw = readFileSync(resolve(process.cwd(), '.github/workflows/setup-test-users.yml'), 'utf8');

describe('Admin - Test Users workflow contract', () => {
  it('renames the display name only, keeping the stable action set', () => {
    expect(wf.name).toBe('Admin - Test Users');
    expect(inputs.action.options).toEqual(['setup', 'query', 'create', 'sync_reviewers', 'verify']);
  });

  it('preserves standard free/pro create with NO Basic tier option', () => {
    expect(inputs.create_tier.options).toEqual(['free', 'pro']);
    expect(inputs.create_tier.options).not.toContain('basic');
    expect(inputs.create_tier.default).toBe('free');
  });

  it('removed the Basic count input alias', () => {
    expect(inputs).not.toHaveProperty('new_basic_count');
    expect(raw).not.toMatch(/new_basic_count|NEW_BASIC_COUNT/);
  });

  it('adds an additive create_purpose selector (standard default + secret-backed canary + free_test)', () => {
    expect(inputs.create_purpose.options).toEqual(['standard', 'canary_trial', 'canary_paid', 'free_test']);
    expect(inputs.create_purpose.default).toBe('standard');
  });

  it('never exposes a canary or free_test password as a dispatch input', () => {
    for (const key of Object.keys(inputs)) {
      expect(key).not.toMatch(/canary.*password|password.*canary|free_test.*password/i);
    }
  });

  it('wires test-account EMAILS from Variables and PASSWORDS from Secrets at the provisioning step (#1294 split)', () => {
    // #1294 sourcing split: test-account emails are operator-owned identifiers (Variables); passwords are
    // credentials (Secrets). All four email identifiers (canary + free/pro) resolve from Variables.
    for (const s of ['CANARY_TRIAL_EMAIL', 'CANARY_PAID_EMAIL', 'FREE_TEST_EMAIL', 'PRO_TEST_EMAIL']) {
      expect(raw).toContain(`${s}: \${{ vars.${s} }}`);
      expect(raw, `${s} must not resolve from a Secret`).not.toContain(`${s}: \${{ secrets.${s} }}`);
    }
    for (const s of ['CANARY_TRIAL_PASSWORD', 'CANARY_PAID_PASSWORD', 'FREE_TEST_PASSWORD']) {
      expect(raw).toContain(`${s}: \${{ secrets.${s} }}`);
    }
  });

  it('the verify action runs only the read-only verifier, with the credentials it needs', () => {
    // A write-mode script behind "verify" would turn a diagnostic into a Production mutation.
    const branch = /elif \[ "\$ACTION" = "verify" \]; then\s*\n\s*(.+)\n/.exec(raw);
    expect(branch, 'verify branch missing from the admin action step').not.toBeNull();
    expect(branch[1].trim()).toBe('pnpm verify:test-users');
    const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'));
    expect(pkg.scripts['verify:test-users']).toBe('node scripts/verify-test-users.mjs');
    for (const s of ['SUPABASE_URL: ${{ vars.SUPABASE_URL }}', 'SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}',
      'FREE_TEST_EMAIL: ${{ vars.FREE_TEST_EMAIL }}', 'PRO_TEST_EMAIL: ${{ vars.PRO_TEST_EMAIL }}']) {
      expect(raw).toContain(s);
    }
  });

  it('the verifier performs no writes: no insert, update, upsert, delete or auth mutation', () => {
    const src = readFileSync(resolve(process.cwd(), 'scripts/verify-test-users.mjs'), 'utf8');
    for (const write of ['.insert(', '.update(', '.upsert(', '.delete(', 'createUser', 'updateUserById', 'deleteUser', 'inviteUserByEmail', '.rpc(']) {
      expect(src, `verify-test-users.mjs must not call ${write}`).not.toContain(write);
    }
  });

  it('the run summary claims password or registry changes ONLY for setup, and verify says it changed nothing', () => {
    // Codex P2 4009444319: the Summary step printed "Registry updated" / "New SOAK_TEST_PASSWORD generated" on
    // every action, so a read-only verify run produced evidence of mutations that never happened.
    const summary = wf.jobs['test-user-admin'].steps.find((s) => s.name === 'Summary');
    expect(summary, 'Summary step missing').toBeTruthy();
    const lines = summary.run.split('\n');
    const guards = [];
    const unguarded = [];
    for (const line of lines) {
      const t = line.trim();
      if (/^if \[/.test(t)) guards.push(/^if \[ "\$ACTION" = "setup" \]; then$/.test(t));
      else if (t === 'fi') guards.pop();
      // Only EMITTED lines are claims; a shell comment naming the secret is not evidence in the run summary.
      else if (/^echo /.test(t) && /SOAK_TEST_PASSWORD|Password Strategy|Registry updated/.test(t) && !guards.includes(true)) unguarded.push(t);
    }
    expect(unguarded, 'password/registry claims printed outside an ACTION=setup guard').toEqual([]);
    expect(summary.run).toMatch(/if \[ "\$ACTION" = "verify" \]; then\s*\n\s*echo "Read-only verification: no accounts, profiles or secrets were changed\." >> \$GITHUB_STEP_SUMMARY/);
  });

  it('keeps the stable script path and filename contract', () => {
    expect(raw).toContain('node scripts/setup-test-users.mjs');
  });

  // #1483 P1-1 least privilege. The strictly read-only canary inspection never authenticates, so handing it
  // passwords or the anon key grants capability it cannot legitimately use. It must run in its OWN conditioned
  // step with the minimum environment, and the broad admin step must be unable to serve that case. These
  // assertions read the PARSED steps, not the raw text, so a step that merely mentions the right words cannot
  // pass while the actual environment is wrong.
  it('CASUALTY: the canary verify path runs in its own step with ONLY the allowed environment', () => {
    const steps = wf.jobs['test-user-admin'].steps;
    // Select the dedicated step by EXACT NAME. Keying on the presence of `canaries` or `verify:test-users` would
    // also match the broad step — it serves verify_target=reviewers and mentions `canaries` only to NEGATE that
    // case — so such a filter could pass vacuously against a wrong workflow.
    const CANARY_STEP = 'Run canary identity inspection (strictly read-only)';
    const canarySteps = steps.filter((s) => s.name === CANARY_STEP);
    // 1. Exactly one such step exists.
    expect(canarySteps).toHaveLength(1);
    const [canary] = canarySteps;
    // No OTHER step may run for the canary case (a positive canary condition that is not a negation).
    const otherCanaryRunners = steps.filter((s) => s.name !== CANARY_STEP && /canaries/.test(s.if ?? '') && !/\$\{\{\s*!/.test(s.if ?? ''));
    expect(otherCanaryRunners.map((s) => s.name)).toEqual([]);

    // 2. Its condition requires BOTH the verify action and the canaries target.
    expect(canary.if).toMatch(/action\s*==\s*'verify'/);
    expect(canary.if).toMatch(/verify_target\s*==\s*'canaries'/);

    // 3. Its environment is exactly the allowed set — no more, no fewer.
    expect(Object.keys(canary.env ?? {}).sort()).toEqual([
      'ACTION', 'CANARY_PAID_EMAIL', 'CANARY_TRIAL_EMAIL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_URL', 'VERIFY_TARGET',
    ]);

    // 4. No credential, password or anon-key variable reaches it — by name or by referenced secret.
    const canaryEnv = JSON.stringify(canary.env ?? {});
    for (const banned of ['PASSWORD', 'ANON_KEY', 'SOAK', 'GH_PAT', 'GH_TOKEN', 'PRO_TEST', 'FREE_TEST', 'CREATE_']) {
      expect(canaryEnv, `canary verify step must not receive ${banned}`).not.toContain(banned);
    }

    // 5. The broad admin step cannot execute for the canary case — but MUST still serve everything else.
    const broad = steps.find((s) => s.name === 'Run test user admin action');
    expect(broad, 'broad admin step missing').toBeTruthy();
    expect(broad.if, 'broad step must exclude the canary-verification case').toMatch(/!\s*\(.*action\s*==\s*'verify'.*verify_target\s*==\s*'canaries'.*\)/s);
    // It is the step that legitimately holds the wider credential set, which is why it must be excluded here.
    expect(JSON.stringify(broad.env ?? {})).toContain('SUPABASE_ANON_KEY');
    // Reviewer verification still routes through it: the exclusion is narrowed to the canaries target only, so a
    // future edit that excluded ALL verify traffic would break reviewer verification while this test still passed.
    expect(broad.if, 'exclusion must be scoped to the canaries target, not to verify as a whole').toContain("verify_target == 'canaries'");
    expect(broad.run, 'broad step must keep serving the reviewer verify branch').toMatch(/elif \[ "\$ACTION" = "verify" \]; then\s*\n\s*pnpm verify:test-users/);

    // 6. The canary step runs ONLY the read-only verifier — no setup script, no create path, no extra command.
    expect(canary.run.trim()).toBe('pnpm verify:test-users');
  });

  it('verify_target selects the reviewers check (default) or the read-only canary inspection', () => {
    expect(inputs.verify_target.options).toEqual(['reviewers', 'canaries']);
    expect(inputs.verify_target.default).toBe('reviewers');
    expect(raw).toContain('VERIFY_TARGET: ${{ github.event.inputs.verify_target }}');
  });

  // Product Owner decision (15 Sep 2026): the canary inspection is STRICTLY read-only. No writes, no authentication
  // (no token, no last_sign_in_at stamp), and the only RPC is the effective-tier read.
  const WRITES = ['.insert(', '.update(', '.upsert(', '.delete(', 'createUser', 'updateUserById', 'deleteUser', 'inviteUserByEmail', 'generateLink'];
  const AUTH = ['signInWithPassword', 'signInWithOtp', 'signInWithIdToken', 'signInAnonymously', 'signUp(', 'refreshSession', 'setSession', 'resetPasswordForEmail', 'updateUser(', 'provisionCanaryCredential', 'authenticateAndVerify', 'signInWithBoundedRetry'];
  const CREDENTIALS = ['CANARY_TRIAL_PASSWORD', 'CANARY_PAID_PASSWORD', 'SUPABASE_ANON_KEY', 'FREE_TEST_PASSWORD', 'SOAK_TEST_PASSWORD'];
  const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
  const fnBody = (src, name) => {
    const start = src.indexOf(`export async function ${name}(`);
    return start < 0 ? '' : src.slice(start, src.indexOf('\n}\n', start) + 2);
  };

  it('the canary inspection and the verifier contain no write, authentication or credential path', () => {
    const lib = read('scripts/lib/canaryReadOnlyVerify.mjs');
    const verifier = read('scripts/verify-test-users.mjs');
    const found = [];
    for (const [name, src] of [['canaryReadOnlyVerify.mjs', lib], ['verify-test-users.mjs', verifier]]) {
      for (const token of [...WRITES, ...AUTH, ...CREDENTIALS]) if (src.includes(token)) found.push(`${name}: ${token}`);
    }
    expect(found).toEqual([]);
  });

  it('the canary inspection imports only read-only helpers and runs no RPC of its own', () => {
    const lib = read('scripts/lib/canaryReadOnlyVerify.mjs');
    const imported = /import \{([^}]+)\} from '\.\/canaryAccountAdmin\.mjs'/.exec(lib)[1].split(',').map((s) => s.trim()).sort();
    expect(imported).toEqual(['maskEmail', 'strictLookup', 'verifyCanaryFoundation']);
    expect(lib.match(/from '\.\/[^']+'/g)).toEqual(["from './canaryAccountAdmin.mjs'"]);
    // The single tier RPC now lives in the helper that judges it (see the one-read/one-authority test below).
    expect(lib.split('.rpc(').length - 1).toBe(0);
  });

  it('ONE read and ONE eligibility authority: the inspection reports the snapshot the helper validated', () => {
    // Codex P2 4020951921: the inspection used to read the profile and run the tier RPC itself, then call
    // `verifyCanaryFoundation`, which reads AGAIN and returned only {ok, reason}. A mid-flight entitlement
    // downgrade could pair the second read's `ok` with the first read's Pro-shaped facts and report
    // ELIGIBLE_CREDENTIAL_PENDING for a stale identity. Per PM direction the helper now returns the snapshot it
    // validated, and the inspection reads NOTHING about the profile itself.
    const lib = read('scripts/lib/canaryReadOnlyVerify.mjs');
    const admin = read('scripts/lib/canaryAccountAdmin.mjs');
    expect(lib).toContain('await verifyCanaryFoundation(adminClient, userId, purpose)');
    expect(lib).toContain('foundation.snapshot');
    // Zero profile reads and zero tier RPCs in the inspection; exactly one of each in the helper.
    expect(lib.match(/\.from\('user_profiles'\)/g)).toBeNull();
    expect(admin.match(/\.from\('user_profiles'\)/g)).toHaveLength(1);
    const adminRpcs = [...admin.matchAll(/\.rpc\(\s*'([^']+)'/g)].map((m) => m[1]);
    expect(adminRpcs).toEqual(['effective_subscription_tier']);
    // The helper must hand back what it judged, or the report could drift from the verdict again.
    expect(admin).toMatch(/snapshot: data, effectiveTier: effTier/);
  });

  it('the reused canary admin helpers are themselves read-only', () => {
    const admin = read('scripts/lib/canaryAccountAdmin.mjs');
    // fnBody matches `export async function` only, so the pure (sync) rule function needs its own slice — an
    // empty body would otherwise pass this scan vacuously.
    const pureStart = admin.indexOf('export function judgeCanaryFoundationSnapshot(');
    const pureBody = pureStart < 0 ? '' : admin.slice(pureStart, admin.indexOf('\n}\n', pureStart) + 2);
    const bodies = {
      strictLookup: fnBody(admin, 'strictLookup'),
      verifyCanaryFoundation: fnBody(admin, 'verifyCanaryFoundation'),
      judgeCanaryFoundationSnapshot: pureBody,
    };
    // The rules function must perform no I/O at all — no reads, not just no writes.
    for (const io of ['await ', '.from(', '.rpc(', 'adminClient']) {
      expect(pureBody, `judgeCanaryFoundationSnapshot must be pure: found ${io}`).not.toContain(io);
    }
    const found = [];
    for (const [name, body] of Object.entries(bodies)) {
      if (body.length === 0) found.push(`${name}: not found`);
      for (const token of [...WRITES, ...AUTH]) if (body.includes(token)) found.push(`${name}: ${token}`);
    }
    expect(found).toEqual([]);
  });
});
