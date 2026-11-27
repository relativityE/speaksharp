import { describe, expect, it } from 'vitest';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import yaml from 'js-yaml';

// Regression contract for the post-#1290 defect: the hosted Edge-function readback (verify-edge-functions)
// was SKIPPED even though the Edge deployment succeeded, because an unrelated upstream job
// (deploy-production-db) is intentionally skipped for operation=edge-functions and that skip propagated
// through the needs-graph. The fix pins the readback with a leading always() so its condition is evaluated
// regardless of the skipped ancestor, while still running ONLY when the Edge deploy itself succeeded.
const wf = yaml.load(readFileSync(resolve(process.cwd(), '.github/workflows/deploy-supabase-migrations.yml'), 'utf8'));
const jobs = wf.jobs;

describe('deploy-supabase-migrations Edge deploy/readback job conditions', () => {
  it('fails closed on missing T2 schema before invalidation and publication', () => {
    const prerequisite = jobs['verify-t2-database-prerequisites'];
    expect(prerequisite.needs).toBe('validate-edge-configuration');
    expect(prerequisite.if).toContain('inputs.deploy_production == true');
    const preflight = prerequisite.steps.find(step => step.run?.includes('t2-migration-postflight'));
    expect(preflight.env.DEPLOY_EDGE).toBe('${{ needs.validate-edge-configuration.outputs.deploy_edge_functions }}');
    expect(preflight.run).toContain('true) REQUIRE_COACHING_CHECKS=1 node scripts/t2-migration-postflight.mjs verify edge-release');
    expect(preflight.run).toContain('false) node scripts/t2-migration-postflight.mjs verify release');
    expect(preflight.run).toContain("*) echo '::error::resolved Edge deployment intent unavailable'; exit 1");
    for (const name of ['invalidate-account-closure-authority', 'deploy-edge-functions']) {
      expect(jobs[name].needs).toContain('verify-t2-database-prerequisites');
      expect(jobs[name].if).toContain("needs.verify-t2-database-prerequisites.result == 'success'");
      expect(jobs[name].if).not.toContain("needs.verify-t2-database-prerequisites.result == 'skipped'");
    }
    const steps = jobs['deploy-edge-functions'].steps;
    const check = steps.findIndex(step => step.run?.includes('REQUIRE_COACHING_CHECKS=1 node scripts/t2-migration-postflight.mjs verify edge-release'));
    const mutation = steps.findIndex(step => step.name === 'Deploy Edge Functions');
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(mutation);
    expect(steps[check].run).not.toContain('verify release');
    expect(prerequisite.steps.find(step => step.run?.includes('t2-migration-postflight')).run).toContain('assert-db-connectivity-tls.sh');
  });
  it('rechecks current qualified main before both drain invalidation and Edge mutation', () => {
    for (const name of ['invalidate-account-closure-authority', 'deploy-edge-functions', 'deploy-production-db']) {
      expect(jobs[name].steps.some((step) => step.run === 'node scripts/production-release-policy.mjs authorize')).toBe(true);
    }
  });
  it('deploy-production-db is intentionally skipped for an edge-functions-only operation', () => {
    expect(jobs['deploy-production-db'].if).toContain("inputs.operation != 'edge-functions'");
  });

  it('deploy-edge-functions runs when the DB job is skipped (always() + skipped tolerance)', () => {
    const cond = jobs['deploy-edge-functions'].if;
    expect(cond).toContain('always()');
    expect(cond).toContain("needs.deploy-production-db.result == 'skipped'");
  });

  it('verify-edge-functions (hosted readback) survives the skipped upstream via always()', () => {
    const cond = jobs['verify-edge-functions'].if;
    // always() forces GitHub to evaluate the condition regardless of the skipped deploy-production-db ancestor
    expect(cond).toContain('always()');
    // ...but it still runs ONLY when the Edge deployment itself succeeded (never a blind readback)
    expect(cond).toContain("needs.deploy-edge-functions.result == 'success'");
    expect(jobs['verify-edge-functions'].needs).toContain('deploy-edge-functions');
  });
  it('captures every reviewed function version before publication and reconciles after success OR partial failure', () => {
    const steps = jobs['deploy-edge-functions'].steps;
    const at = name => steps.findIndex(step => step.name === name);
    const before = at('Capture Edge function versions before publication');
    const deploy = at('Deploy Edge Functions');
    const reconcile = at('Reconcile Edge function versions after publication');
    const keep = at('Keep the Edge version reconciliation');
    expect([before, deploy, reconcile, keep].every(i => i > -1)).toBe(true);
    expect(before < deploy && deploy < reconcile && reconcile < keep).toBe(true);
    expect(steps[deploy].id).toBe('deploy_edge');
    // Every function the deploy publishes is captured, in both reads.
    const published = [...steps[deploy].run.matchAll(/supabase functions deploy ([a-z-]+) /g)].map(m => m[1]);
    expect(published).toHaveLength(10);
    for (const step of [steps[before], steps[reconcile]]) {
      const names = /--arg names "([a-z -]+)"/.exec(step.run)[1].split(' ');
      expect(names).toEqual(published);
      expect(step.run).toContain('supabase functions list --project-ref "$SUPABASE_PROJECT_ID" -o json');
      // Metadata only: slug, version, status and timestamp; never source or environment.
      expect(step.run).toContain('{slug: $n, version: ($f.version // null), status: ($f.status // null), updated_at: ($f.updated_at // null)}');
    }
    // Runs after a partial failure too, and a "success" in which any function did not advance fails.
    for (const step of [steps[reconcile], steps[keep]]) expect(step.if).toBe("${{ always() && steps.deploy_edge.outcome != 'skipped' }}");
    expect(steps[reconcile].env.DEPLOY_OUTCOME).toBe('${{ steps.deploy_edge.outcome }}');
    expect(steps[reconcile].run).toContain('advanced: (($a.version // 0) > ($b.version // 0))');
    expect(steps[reconcile].run).toContain('if [ "$DEPLOY_OUTCOME" = success ] && [ "$(jq -r .allAdvanced edge-version-reconciliation.json)" != true ]; then');
    expect(steps[keep].uses).toBe('actions/upload-artifact@v6');
    expect(steps[keep].with['retention-days']).toBe(1);
    expect(steps[keep].with.path).toBe('edge-version-reconciliation.json');
  });
});

// ── Deletion rollout step 5 (plan #1952): the account-closure-only route ─────────────────────────────────────────────
describe('account-closure-only: main-gated, exactly one function, post-129 ledger, full-roster reconciliation', () => {
  const release = yaml.load(readFileSync(resolve(process.cwd(), '.github/workflows/production-release.yml'), 'utf8'));
  const job = jobs['deploy-account-closure-only'];
  const steps = job.steps;
  const at = (name) => steps.findIndex((step) => step.name === name);
  const jqFile = (file, args, input) => execFileSync('jq', [...args, '-f', resolve(process.cwd(), file)], { encoding: 'utf8', input });

  it('is a separate, exactly confirmed production-release operation that never enables the ten-function path', () => {
    expect(release.on.workflow_dispatch.inputs.operation.options).toEqual(['frontend', 'edge-functions', 'account-closure-only', 'enable-coaching-readiness']);
    const caller = release.jobs['release-account-closure'];
    expect(caller.uses).toBe('./.github/workflows/deploy-supabase-migrations.yml');
    expect(caller.with).toMatchObject({ operation: 'account-closure-only', deploy_edge_functions: false, deploy_production: true });
    expect(caller.if).toContain("inputs.operation == 'account-closure-only'");
    expect(release.jobs['release-edge'].with.operation).toBe('edge-functions');
    const resolveRun = jobs['validate-edge-configuration'].steps.find((step) => step.id === 'resolve').run;
    expect(resolveRun).toContain('migrations|secrets|account-closure-only) deploy_edge=false ;;');
    expect(resolveRun).toContain("echo 'account_closure_only=true' >> \"$GITHUB_OUTPUT\"");
    expect(jobs['deploy-edge-functions'].if).toContain("needs.validate-edge-configuration.outputs.deploy_edge_functions == 'true'");
  });

  it('publication uses the existing main-only production-db environment and never names a missing one', () => {
    expect(job.environment).toBe('production-db');
    const gate = jobs['require-account-closure-main-gate'];
    expect(job.needs).toContain('require-account-closure-main-gate');
    expect(job.if).toContain("needs.require-account-closure-main-gate.result == 'success'");
    expect(gate.environment).toBeUndefined(); // read-only check; must never create an environment by naming it
    const run = gate.steps[0].run;
    expect(run).toContain('gh api "repos/$REPOSITORY/environments/production-db"');
    expect(run).toContain('custom_branch_policies');
    expect(run).toContain(`jq -e '. == ["main"]'`);
    // The abandoned reviewer environment must not come back: naming it would silently create an unprotected one.
    expect(JSON.stringify(jobs)).not.toContain('production-account-closure');
    // Same gate as every production migration apply.
    expect(jobs['deploy-production-db'].environment).toBe('production-db');
  });

  it('never runs authority invalidation or the database job for this operation', () => {
    expect(jobs['invalidate-account-closure-authority'].if).toContain("inputs.operation != 'account-closure-only'");
    expect(jobs['deploy-production-db'].if).toContain("inputs.operation != 'account-closure-only'");
    expect(JSON.stringify(job)).not.toContain('account-closure-invalidate');
    expect(job.if).toContain("needs.validate-edge-configuration.outputs.deploy_edge_functions == 'false'");
    expect(job.if).toContain("needs.verify-t2-database-prerequisites.result == 'success'");
  });

  it('publishes ONLY account-closure, between a post-129 T2 check before and a completion-OFF check after', () => {
    const deploys = steps.flatMap((step) => (step.run ?? '').split('\n')).filter((line) => /functions deploy /.test(line));
    expect(deploys).toEqual(['supabase functions deploy account-closure --project-ref "$SUPABASE_PROJECT_ID" --no-verify-jwt --use-api']);
    const deploy = steps.findIndex((step) => step.id === 'deploy_account_closure');
    const before = at('Recheck the post-129 ledger and completion OFF immediately before publication');
    const capture = at("Capture every function's version before account-closure publication");
    const reconcile = at('Reconcile versions after account-closure publication');
    const after = at('Recheck completion OFF and unbound after publication');
    expect([at('Recheck exact green main before account-closure publication') < before, before < capture, capture < deploy,
      deploy < reconcile, reconcile < after]).toEqual([true, true, true, true, true]);
    for (const index of [before, after]) expect(steps[index].run).toContain('node scripts/t2-migration-postflight.mjs verify account-closure-release');
    for (const index of [reconcile, after]) expect(steps[index].if).toContain('always()');
    expect(jobs['verify-t2-database-prerequisites'].steps.at(-1).run).toContain('verify account-closure-release');
    expect(job.env.PUBLISHED_FUNCTION).toBe('account-closure');
    expect(JSON.stringify(job)).not.toContain('WATCHED_FUNCTIONS'); // the full roster, never a named list
    expect(steps[capture].run).toContain('jq -f scripts/edge-roster.jq');
    expect(steps[capture].run).toContain("account-closure is not deployed before publication");
    expect(steps[reconcile].run).toContain('-f scripts/account-closure-reconcile.jq');
    expect(steps.find((step) => step.name === 'Keep the account-closure version reconciliation').with['retention-days']).toBe(1);
  });

  it('the roster read refuses incomplete, non-array or duplicated metadata', () => {
    const ok = [{ slug: 'b', version: 3, status: 'ACTIVE', updated_at: 't1', extra: 'dropped' }, { slug: 'a', version: 1, status: 'ACTIVE', updated_at: 't0' }];
    expect(JSON.parse(jqFile('scripts/edge-roster.jq', [], JSON.stringify(ok))).map((f) => f.slug)).toEqual(['a', 'b']);
    expect(JSON.parse(jqFile('scripts/edge-roster.jq', [], JSON.stringify(ok)))[1]).toEqual({ slug: 'b', version: 3, status: 'ACTIVE', updated_at: 't1' });
    for (const bad of [{}, [{ slug: 'a', status: 'ACTIVE', updated_at: 't' }], [{ slug: 'a', version: '1', status: 'ACTIVE', updated_at: 't' }],
      [{ version: 1, status: 'ACTIVE', updated_at: 't' }], [{ slug: 'a', version: 1, status: 'ACTIVE', updated_at: 't' }, { slug: 'a', version: 2, status: 'ACTIVE', updated_at: 't' }]]) {
      expect(() => jqFile('scripts/edge-roster.jq', [], JSON.stringify(bad))).toThrow();
    }
  });

  it('the reconciliation compares the FULL non-target roster and never counts a missing prior target as an advance', () => {
    const dir = mkdtempSync(join(tmpdir(), 'acr-'));
    const f = (slug, version, updated = 't', status = 'ACTIVE') => ({ slug, version, status, updated_at: updated });
    const before = [f('account-closure', 9), f('get-ai-suggestions', 20), f('stripe-webhook', 30)];
    const reconcile = (b, a, outcome = 'success') => {
      writeFileSync(join(dir, 'b.json'), JSON.stringify(b)); writeFileSync(join(dir, 'a.json'), JSON.stringify(a));
      return JSON.parse(jqFile('scripts/account-closure-reconcile.jq', ['-n', '--arg', 'outcome', outcome, '--arg', 'published', 'account-closure',
        '--slurpfile', 'before', join(dir, 'b.json'), '--slurpfile', 'after', join(dir, 'a.json')], ''));
    };
    const bumped = [f('account-closure', 10, 'new'), ...before.slice(1)];
    expect(reconcile(before, bumped)).toMatchObject({ publishedAdvanced: true, othersUnchanged: true, changedOthers: [] });
    expect(reconcile(before, before)).toMatchObject({ publishedAdvanced: false, othersUnchanged: true });
    expect(reconcile(before.slice(1), bumped)).toMatchObject({ publishedAdvanced: false, target: { before: null, after: 10 } });
    expect(reconcile(before, [...bumped, f('new-fn', 1)])).toMatchObject({ othersUnchanged: false, added: ['new-fn'] });
    expect(reconcile(before, bumped.filter((x) => x.slug !== 'stripe-webhook'))).toMatchObject({ othersUnchanged: false, removed: ['stripe-webhook'] });
    expect(reconcile(before, bumped.map((x) => x.slug === 'stripe-webhook' ? { ...x, version: 31 } : x))).toMatchObject({ othersUnchanged: false, changed: ['stripe-webhook'] });
    expect(reconcile(before, before.map((x) => x.slug === 'get-ai-suggestions' ? { ...x, updated_at: 'touched' } : x), 'failure'))
      .toMatchObject({ othersUnchanged: false, changed: ['get-ai-suggestions'] });
    expect(reconcile(before, before.map((x) => x.slug === 'get-ai-suggestions' ? { ...x, status: 'THROTTLED' } : x), 'failure'))
      .toMatchObject({ othersUnchanged: false, changed: ['get-ai-suggestions'] });
    const run = steps[at('Reconcile versions after account-closure publication')].run;
    expect(run).toContain('if [ "$(jq -r .othersUnchanged account-closure-version-reconciliation.json)" != true ]; then');
    expect(run).toContain('if [ "$DEPLOY_OUTCOME" = success ] && [ "$(jq -r .publishedAdvanced account-closure-version-reconciliation.json)" != true ]; then');
    rmSync(dir, { recursive: true, force: true });
  });

  it('accepts the real Management API shape: integer updated_at and extra fields (Codex P1 4667736061)', () => {
    // The shape `supabase functions list -o json` returns (v1 list-all-functions): updated_at/created_at are integers.
    const real = [
      { id: 'f1', slug: 'account-closure', name: 'account-closure', status: 'ACTIVE', version: 9, created_at: 1795000000000,
        updated_at: 1795400000000, verify_jwt: false, import_map: true, entrypoint_path: 'file:///x/index.ts', ezbr_sha256: 'e57c' },
      { id: 'f2', slug: 'stripe-webhook', name: 'stripe-webhook', status: 'ACTIVE', version: 31, created_at: 1794000000000,
        updated_at: 1795100000000, verify_jwt: false },
    ];
    expect(JSON.parse(jqFile('scripts/edge-roster.jq', [], JSON.stringify(real)))).toEqual([
      { slug: 'account-closure', version: 9, status: 'ACTIVE', updated_at: 1795400000000 },
      { slug: 'stripe-webhook', version: 31, status: 'ACTIVE', updated_at: 1795100000000 },
    ]);
    for (const updated of [null, '', true, [], {}]) {
      expect(() => jqFile('scripts/edge-roster.jq', [], JSON.stringify([{ ...real[0], updated_at: updated }]))).toThrow();
    }
  });

  it('the T2 CLI refuses account-closure-release on the pre-129 ledger and admits the post-129 ledger past that check (Codex P1 4667508806)', () => {
    const fifteen = ['20261018090000', '20261018170000', '20261019010000', '20261019055102', '20261019202856', '20261020230653',
      '20261024083000', '20261025021046', '20261110173548', '20261112133000', '20261114100000', '20261114170000', '20261117105700',
      '20261119120000', '20261119200000'];
    const dir = mkdtempSync(join(process.cwd(), '.account-closure-cli-'));
    try {
      // Transport only: the real CLI and contract run; the fake psql returns the ledger and refuses non-read-only use.
      writeFileSync(join(dir, 'psql'), `#!/usr/bin/env node\nimport('node:fs').then((fs) => {
if(!String(process.env.PGOPTIONS||'').includes('default_transaction_read_only=on'))process.exit(9);
console.log(fs.readFileSync(process.env.LEDGER_ROW,'utf8'));});\n`);
      chmodSync(join(dir, 'psql'), 0o700);
      const invoke = (ledger) => {
        writeFileSync(join(dir, 'ledger.json'), JSON.stringify(ledger));
        return spawnSync(process.execPath, ['scripts/t2-migration-postflight.mjs', 'verify', 'account-closure-release'], {
          encoding: 'utf8', timeout: 20_000, env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, LEDGER_ROW: join(dir, 'ledger.json') } });
      };
      const pre = invoke(fifteen);
      expect(pre.status).toBe(1);
      expect(pre.stderr).toContain('T2 account-closure release requires the post-129 completion settlement ledger');
      const post = invoke([...fifteen, '20261027192550'].sort());
      expect(post.status).toBe(1); // the fake transport cannot supply a full snapshot, so it still fails closed later
      expect(post.stderr).not.toContain('requires the post-129 completion settlement ledger');
      expect(post.stderr).not.toContain('T2 release ledger unknown');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('the T2 CLI admits account-closure-release only on the post-129 completion-settlement ledger', () => {
    const cli = readFileSync(resolve(process.cwd(), 'scripts/t2-migration-postflight.mjs'), 'utf8');
    expect(cli).toContain("['release', 'edge-release', 'account-closure-release', 'coaching-checks-release'].includes(version)");
    expect(cli).toContain("if (version === 'account-closure-release' && contract.profile !== 'post-129-completion-settlement') {");
  });
});

describe('coaching readiness flag release', () => {
  const release = yaml.load(readFileSync(resolve(process.cwd(), '.github/workflows/production-release.yml'), 'utf8'));
  const name = 'enable-coaching-readiness';
  const gate = release.jobs['verify-coaching-readiness-release-gate'];
  const job = release.jobs[name];
  const step = (text) => job.steps.find((entry) => entry.name === text);

  it('only admits the explicitly confirmed operation through the existing reviewed main gate', () => {
    const sha = 'a'.repeat(40);
    const confirmation = release.jobs['validate-release'].steps[0].run;
    const confirm = (op, phrase) => spawnSync('bash', ['-c', confirmation], {
      env: { ...process.env, OPERATION: op, EXPECTED_HEAD_SHA: sha, CONFIRM: phrase },
    }).status;
    expect(confirm(name, 'RELEASE ' + name + ' AT ' + sha)).toBe(0);
    expect(confirm(name, 'RELEASE frontend AT ' + sha)).not.toBe(0);
    expect(confirm('secrets', 'RELEASE secrets AT ' + sha)).not.toBe(0);
    expect(confirm(name, 'RELEASE ' + name + ' AT ' + 'b'.repeat(40))).not.toBe(0);
    expect(gate.needs).toEqual(['production-policy', 'validate-release']);
    expect(gate.if).toContain("inputs.operation == '" + name + "'");
    expect(gate.steps[0].run).toContain('required_reviewers');
    expect(gate.steps[0].run).toContain('== ["main"]');
    expect(job.if).toContain("needs.verify-coaching-readiness-release-gate.result == 'success'");
    expect(job.environment).toBe('production-db');
    expect(job.concurrency).toEqual({ group: 'production-database-migrations', 'cancel-in-progress': false });
    expect(JSON.stringify(job)).not.toMatch(/functions deploy|vercel |db push|GEMINI_API_KEY|STRIPE_/);
  });

  it('verifies the installed schema and advances drain authority before the flag write', () => {
    const schema = step('Verify the installed readiness schema and T2 prerequisites');
    const exact = step('Recheck exact green main before invalidating drain authority');
    const revoke = step('Invalidate account-deletion drain authority before configuration changes');
    const set = step('Set only the coaching readiness flag');
    expect(schema.run).toContain('default_transaction_read_only=on');
    expect(schema.run).toContain('20261126005433');
    expect(schema.run).toContain('verify edge-release');
    expect(exact.run).toBe('node scripts/production-release-policy.mjs authorize');
    expect(revoke.run).toBe('node scripts/account-closure-invalidate.mjs');
    expect([schema, exact, revoke, set].map((entry) => job.steps.indexOf(entry))).toEqual([3, 4, 5, 6]);
  });

  it('writes one fixed flag once, and never writes after a bad target or policy refusal', () => {
    const command = step('Set only the coaching readiness flag').run;
    const stub = [
      'node() { echo policy >&2; [ "$*" = "scripts/production-release-policy.mjs authorize" ] || return 2; echo "$POLICY_OUTPUT"; return "$POLICY_EXIT"; }',
      'supabase() { echo "supabase:$*"; return "$SUPABASE_EXIT"; }',
    ].join('\n');
    const ref = 'a'.repeat(20);
    const run = ({ project = ref, token = 'fake', policy = '0', allowed = true, mutation = '0' } = {}) => spawnSync('bash', ['-c', stub + '\n' + command], {
      env: { ...process.env, SUPABASE_PROJECT_ID: project, SUPABASE_ACCESS_TOKEN: token,
        EXPECTED_HEAD_SHA: 'a'.repeat(40), POLICY_EXIT: policy, SUPABASE_EXIT: mutation,
        POLICY_OUTPUT: JSON.stringify({ allowed, state: allowed ? 'QUALIFIED' : 'OFF', releaseSha: 'a'.repeat(40) }),
        GITHUB_STEP_SUMMARY: '/dev/null' },
      encoding: 'utf8',
    });
    const result = run();
    expect(result.status).toBe(0);
    expect(result.stdout.trim().split('\n')).toEqual([
      'supabase:secrets set COACHING_MODEL_READINESS_ENABLED=true --project-ref ' + ref,
    ]);
    for (const args of [{ project: '../wrong' }, { token: '' }, { policy: '1' }, { allowed: false }]) {
      const held = run(args);
      expect(held.status).not.toBe(0);
      expect(held.stdout).not.toContain('supabase:');
    }
    const refused = run({ mutation: '1' });
    expect(refused.status).not.toBe(0);
    expect(refused.stdout.match(/supabase:/g)).toHaveLength(1);
  });
});
