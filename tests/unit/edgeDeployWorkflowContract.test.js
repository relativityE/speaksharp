import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
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
    expect(preflight.run).toContain('true) node scripts/t2-migration-postflight.mjs verify edge-release');
    expect(preflight.run).toContain('false) node scripts/t2-migration-postflight.mjs verify release');
    expect(preflight.run).toContain("*) echo '::error::resolved Edge deployment intent unavailable'; exit 1");
    for (const name of ['invalidate-account-closure-authority', 'deploy-edge-functions']) {
      expect(jobs[name].needs).toContain('verify-t2-database-prerequisites');
      expect(jobs[name].if).toContain("needs.verify-t2-database-prerequisites.result == 'success'");
      expect(jobs[name].if).not.toContain("needs.verify-t2-database-prerequisites.result == 'skipped'");
    }
    const steps = jobs['deploy-edge-functions'].steps;
    const check = steps.findIndex(step => step.run?.includes('node scripts/t2-migration-postflight.mjs verify edge-release'));
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
describe('account-closure-only: reviewer-gated, exactly one function, post-129 ledger, full-roster reconciliation', () => {
  const release = yaml.load(readFileSync(resolve(process.cwd(), '.github/workflows/production-release.yml'), 'utf8'));
  const job = jobs['deploy-account-closure-only'];
  const steps = job.steps;
  const at = (name) => steps.findIndex((step) => step.name === name);
  const jqFile = (file, args, input) => execFileSync('jq', [...args, '-f', resolve(process.cwd(), file)], { encoding: 'utf8', input });

  it('is a separate, exactly confirmed production-release operation that never enables the ten-function path', () => {
    expect(release.on.workflow_dispatch.inputs.operation.options).toEqual(['frontend', 'edge-functions', 'account-closure-only']);
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

  it('publication waits on a PROTECTED environment that must already have required reviewers', () => {
    expect(job.environment).toBe('production-account-closure');
    const gate = jobs['require-account-closure-reviewer-gate'];
    expect(job.needs).toContain('require-account-closure-reviewer-gate');
    expect(job.if).toContain("needs.require-account-closure-reviewer-gate.result == 'success'");
    expect(gate.environment).toBeUndefined(); // read-only check; must never create the environment by naming it
    const run = gate.steps[0].run;
    expect(run).toContain('gh api "repos/$REPOSITORY/environments/production-account-closure"');
    expect(run).toContain(`jq -e 'index("required_reviewers") != null'`);
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

  it('the T2 CLI admits account-closure-release only on the post-129 completion-settlement ledger', () => {
    const cli = readFileSync(resolve(process.cwd(), 'scripts/t2-migration-postflight.mjs'), 'utf8');
    expect(cli).toContain("['release', 'edge-release', 'account-closure-release'].includes(version)");
    expect(cli).toContain("if (version === 'account-closure-release' && contract.profile !== 'post-129-completion-settlement') {");
  });
});
