// Offline controls for the local-stack billing workflow. No network, no secrets, no Stripe calls:
// shell snippets run against a stubbed stripe_get that only prints a fixture.
import { strict as assert } from 'node:assert';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'vitest';
import { parse } from 'yaml';
import { REQUIRED_STEPS } from './journeySteps.mjs';

type Step = { name?: string; id?: string; if?: string; run?: string; env?: Record<string, string> };
const workflowText = readFileSync('.github/workflows/billing-local-stack-journey.yml', 'utf8');
const workflow = parse(workflowText) as { jobs: { journey: { env: Record<string, string>; steps: Step[] } } };
const job = workflow.jobs.journey;
const step = (id: string): Step => {
  const found = job.steps.find(s => s.id === id);
  assert.ok(found, `step ${id} missing`);
  return found;
};
const spec = readFileSync('tests/billing/user-journey/journey.billing.spec.ts', 'utf8');

const jqCount = (filter: string, body: string) => spawnSync('jq', ['-e', filter], { input: body, encoding: 'utf8' });

test('Stripe list count: a genuine list is counted', () => {
  assert.equal(jqCount(job.env.STRIPE_LIST_COUNT, '{"object":"list","data":[]}').stdout.trim(), '0');
  assert.equal(jqCount(job.env.STRIPE_LIST_COUNT, '{"object":"list","data":[{"id":"clock_x"}]}').stdout.trim(), '1');
});

test('Stripe list count negative control: {} and {"data":null} are errors, never zero', () => {
  // The old filter is the defect Sam reproduced: it reads both as 0.
  assert.equal(execFileSync('jq', ['.data | length'], { input: '{}', encoding: 'utf8' }).trim(), '0');
  assert.equal(execFileSync('jq', ['.data | length'], { input: '{"data":null}', encoding: 'utf8' }).trim(), '0');
  for (const body of ['{}', '{"data":null}', '{"object":"list","data":null}', '{"data":[]}', '[]', '"list"',
    '{"object":"list","data":{}}', '{"error":{"type":"invalid_request_error"}}']) {
    const result = jqCount(job.env.STRIPE_LIST_COUNT, body);
    assert.notEqual(result.status, 0, body);
    assert.notEqual(result.stdout.trim(), '0', body);
  }
});

test('no Stripe count in the workflow uses the bare .data | length filter', () => {
  assert.doesNotMatch(workflowText, /jq '\.data \| length'/);
});

const stripeCountFn = (source: string) => {
  const match = /stripe_count\(\) \{[\s\S]*?\n\}/.exec(source);
  assert.ok(match, 'stripe_count() not found');
  return match[0];
};

const runCount = (fn: string, fixture: string) => spawnSync('bash', ['-c', [
  'set -euo pipefail',
  'stripe_get() { printf "%s" "$FIXTURE"; }',
  fn,
  'n="$(stripe_count "test_helpers/test_clocks?limit=1" "test clocks")"',
  'echo "count=$n"',
].join('\n')], { encoding: 'utf8', env: { ...process.env, FIXTURE: fixture, STRIPE_LIST_COUNT: job.env.STRIPE_LIST_COUNT } });

for (const id of ['stripe_account', 'stripe_residue']) {
  test(`${id}: the shell count stops on a non-list answer instead of reading zero`, () => {
    const fn = stripeCountFn(step(id).run ?? '');
    const ok = runCount(fn, '{"object":"list","data":[]}');
    assert.equal(ok.status, 0);
    assert.match(ok.stdout, /count=0/);
    for (const fixture of ['{}', '{"data":null}']) {
      const bad = runCount(fn, fixture);
      assert.notEqual(bad.status, 0, fixture);
      assert.doesNotMatch(bad.stdout, /count=/, fixture);
      assert.match(bad.stderr, /not a list/, fixture);
    }
  });
}

test('a dirty account is a blocked prerequisite that creates and deletes nothing', () => {
  const run = step('stripe_account').run ?? '';
  assert.match(run, /BLOCKED PREREQUISITE, not a billing failure/);
  assert.match(run, /blocked=dirty_test_account/);
  assert.doesNotMatch(run, /-X (POST|DELETE)|--request (POST|DELETE)/);
});

// Minimal evaluator for the `if:` expressions this workflow uses: always(), &&, ==, != over step outcomes.
function evaluate(expr: string, outcomes: Record<string, string>): boolean {
  return expr.split('&&').map(part => part.trim()).every(part => {
    if (part === 'always()') return true;
    const m = /^steps\.(\w+)\.outcome (==|!=) '(\w+)'$/.exec(part);
    assert.ok(m, `unsupported condition: ${part}`);
    const value = outcomes[m[1]] ?? 'skipped';
    return m[2] === '==' ? value === m[3] : value !== m[3];
  });
}

test('rejected ACK, SHA or account: the residue step makes zero provider calls', () => {
  const residueIf = step('stripe_residue').if ?? '';
  // A failed dispatch check skips the account check (no if: on it); a refused account check fails it.
  assert.equal(step('stripe_account').if, undefined);
  for (const accountOutcome of ['skipped', 'failure', 'cancelled']) {
    assert.equal(evaluate(residueIf, { stripe_account: accountOutcome, stack_start: 'success' }), false, accountOutcome);
  }
  // Readback still runs after a later journey failure.
  assert.equal(evaluate(residueIf, { stripe_account: 'success', stack_start: 'failure' }), true);
});

test('no step before the account check can reach Stripe', () => {
  const index = job.steps.findIndex(s => s.id === 'stripe_account');
  for (const earlier of job.steps.slice(0, index)) {
    assert.doesNotMatch(JSON.stringify(earlier), /api\.stripe\.com|STRIPE_TEST_SECRET_KEY/, earlier.name);
  }
});

test('teardown is checked: a failed supabase stop is not swallowed', () => {
  const run = step('stack_stop').run ?? '';
  assert.match(run, /set -euo pipefail/);
  assert.match(run, /supabase stop --workdir "\$SUPABASE_WORKDIR" --no-backup\s*$/m);
  assert.doesNotMatch(run, /supabase stop[^\n]*\|\| true/);
});

test('the combined receipt is finalised after teardown, destruction proof and residue check', () => {
  const ids = job.steps.map(s => s.id);
  const combined = ids.indexOf('combined');
  for (const before of ['stripe_residue', 'stack_stop', 'stack_destroyed']) {
    assert.ok(ids.indexOf(before) > -1 && ids.indexOf(before) < combined, before);
  }
  const run = step('combined').run ?? '';
  for (const outcome of ['stack_stop', 'stack_destroyed', 'stripe_residue']) {
    assert.match(run, new RegExp(`steps\\.${outcome}\\.outcome`));
  }
});

test('D1 source check: the clock create carries this run\'s marker as its name', () => {
  const create = /stripe\('test_helpers\/test_clocks', 'POST', ([^\n]*)\);/.exec(spec)?.[1] ?? '';
  assert.match(create, /^testClockCreateFields\(this\.marker,/);
});

// Sam's #1813 return on 230ae21b: (a) independent Docker checks, (b) exact identities, (c) a bound finalizer.
test('(a) no Docker query is combined in one substitution any more; Docker is reached only through the checked module', () => {
  assert.doesNotMatch(workflowText, /\$\(docker[^)]*;/);
  for (const s of job.steps) assert.doesNotMatch(s.run ?? '', /^\s*[a-z_]+="\$\(docker/m, s.name);
});

test('(b) this run\'s identities are recorded right after creation, before any Stripe step or the journey', () => {
  const ids = job.steps.map(s => s.id ?? s.name);
  const at = ids.indexOf('stack_identity');
  assert.equal(at, ids.indexOf('stack_start') + 1);
  assert.match(step('stack_identity').run ?? '', /localStackResources\.mjs capture "\$LOCAL_STACK_PROJECT"\s*\\\s*\n\s*> "\$RUNNER_TEMP\/stack-identity\.json"/);
  assert.match(step('stack_identity').run ?? '', /set -euo pipefail/);
});

test('(b) destruction is proven against those identities, and only after a checked stop', () => {
  const destroyed = step('stack_destroyed');
  assert.match(destroyed.if ?? '', /steps\.stack_stop\.outcome == 'success'/);
  assert.match(destroyed.run ?? '', /localStackResources\.mjs verify "\$LOCAL_STACK_PROJECT" \\\s*\n\s*"\$RUNNER_TEMP\/stack-identity\.json" > billing-local-stack-destroyed\.json/);
});

test('(c) the finalizer is told this dispatch\'s journey, release and stack, and reads the destruction proof', () => {
  const combined = step('combined');
  assert.equal(combined.env?.JOURNEY, '${{ inputs.journey }}');
  assert.equal(combined.env?.RELEASE, '${{ inputs.commit_sha }}');
  const run = combined.run ?? '';
  for (const flag of ['--receipt billing-local-stack-receipt.json', '--destruction billing-local-stack-destroyed.json',
    '--journey "$JOURNEY"', '--release "$RELEASE"', '--run "$LOCAL_STACK_PROJECT"']) assert.ok(run.includes(flag), flag);
});

test('(c) the finalizer CLI binds the combined result to the raw receipt file, and refuses a bare receipt', () => {
  const dir = mkdtempSync(join(tmpdir(), 'billing-combined-'));
  try {
    const project = 'billing-local-stack-123456-1';
    const release = 'a'.repeat(40);
    const full = { schema: 'billing-user-journey/v1', journey: 'conversion', stripeMode: 'test', result: 'PENDING_STACK_DESTRUCTION',
      steps: REQUIRED_STEPS.conversion.map(s => ({ step: s, result: 'PASSED' })), failureStage: null, reason: null,
      cleanup: 'PENDING_STACK_DESTRUCTION', billingRowResidue: 'NOT_READ_REQUIRES_STACK_DESTRUCTION_PROOF',
      testedRelease: release, stackRun: project };
    const destroyed = { schema: 'billing-local-stack-destroyed/v1', project, databaseSystemIdentifier: '1', containers: 1,
      volumes: 1, networks: 1, destroyed: true };
    writeFileSync(join(dir, 'destroyed.json'), JSON.stringify(destroyed));
    const finalise = (receipts: unknown) => {
      writeFileSync(join(dir, 'receipt.json'), JSON.stringify(receipts));
      return spawnSync('node', ['tests/billing/user-journey/localStackReceipt.mjs', '--receipt', join(dir, 'receipt.json'),
        '--destruction', join(dir, 'destroyed.json'), '--journey', 'conversion', '--release', release, '--run', project,
        '--stack-stopped', 'success', '--stack-destroyed', 'success', '--stripe-clean', 'success'], { encoding: 'utf8' });
    };
    const good = finalise([full]);
    assert.equal(good.status, 0, good.stdout);
    const sha = createHash('sha256').update(readFileSync(join(dir, 'receipt.json'))).digest('hex');
    assert.equal(JSON.parse(good.stdout).rawReceiptSha256, sha);
    const bare = finalise([{ journey: 'conversion', result: 'PENDING_STACK_DESTRUCTION', cleanup: 'PENDING_STACK_DESTRUCTION',
      billingRowResidue: 'NOT_READ_REQUIRES_STACK_DESTRUCTION_PROOF' }]);
    assert.equal(bare.status, 1);
    assert.equal(JSON.parse(bare.stdout).result, 'NOT_PROVEN');
    const otherRun = finalise([{ ...full, stackRun: 'billing-local-stack-999-1' }]);
    assert.equal(otherRun.status, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
