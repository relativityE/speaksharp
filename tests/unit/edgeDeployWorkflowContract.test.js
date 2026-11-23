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
describe('account-closure-only: exactly one function, post-129 ledger, no invalidation, versions reconciled', () => {
  const release = yaml.load(readFileSync(resolve(process.cwd(), '.github/workflows/production-release.yml'), 'utf8'));
  const job = jobs['deploy-account-closure-only'];
  const steps = job.steps;
  const at = (name) => steps.findIndex((step) => step.name === name);

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

  it('never runs authority invalidation or the database job for this operation', () => {
    expect(jobs['invalidate-account-closure-authority'].if).toContain("inputs.operation != 'account-closure-only'");
    expect(jobs['deploy-production-db'].if).toContain("inputs.operation != 'account-closure-only'");
    expect(job.needs).toEqual(['validate-edge-configuration', 'verify-t2-database-prerequisites']);
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
    expect(job.env.WATCHED_FUNCTIONS.split(' ').sort()).toEqual(['account-closure', 'attest-session-engine', 'check-usage-limit',
      'create-user', 'get-ai-suggestions', 'objective-register-source', 'observability-smoke', 'stripe-billing-portal',
      'stripe-checkout', 'stripe-webhook']);
    const keep = steps.find((step) => step.name === 'Keep the account-closure version reconciliation');
    expect(keep.with['retention-days']).toBe(1);
  });

  it('the reconciliation fails when any other function changed, or when a reported success did not advance', () => {
    const run = steps[at('Reconcile versions after account-closure publication')].run;
    const program = /'(\{schemaVersion: 1, route[\s\S]*?)' \\\n\s*> account-closure-version-reconciliation\.json/.exec(run)?.[1] ?? '';
    expect(program).toContain('.othersUnchanged');
    const dir = mkdtempSync(join(tmpdir(), 'acr-'));
    const names = job.env.WATCHED_FUNCTIONS.split(' ');
    const fn = (slug, version, updated) => ({ slug, version, status: 'ACTIVE', updated_at: updated });
    const before = names.map((slug, i) => fn(slug, slug === 'account-closure' ? 9 : 20 + i, `t${i}`));
    const reconcile = (after, outcome) => {
      writeFileSync(join(dir, 'b.json'), JSON.stringify(before)); writeFileSync(join(dir, 'a.json'), JSON.stringify(after));
      return JSON.parse(execFileSync('jq', ['-n', '--arg', 'outcome', outcome, '--arg', 'published', 'account-closure',
        '--slurpfile', 'before', join(dir, 'b.json'), '--slurpfile', 'after', join(dir, 'a.json'), program], { encoding: 'utf8' }));
    };
    const bumped = before.map((f) => f.slug === 'account-closure' ? { ...f, version: 10, updated_at: 'new' } : f);
    expect(reconcile(bumped, 'success')).toMatchObject({ publishedAdvanced: true, othersUnchanged: true, changedOthers: [] });
    expect(reconcile(before, 'success')).toMatchObject({ publishedAdvanced: false, othersUnchanged: true });
    const otherMoved = bumped.map((f) => f.slug === 'stripe-webhook' ? { ...f, version: f.version + 1 } : f);
    expect(reconcile(otherMoved, 'success')).toMatchObject({ othersUnchanged: false, changedOthers: ['stripe-webhook'] });
    const touched = before.map((f) => f.slug === 'get-ai-suggestions' ? { ...f, updated_at: 'touched' } : f);
    expect(reconcile(touched, 'failure')).toMatchObject({ othersUnchanged: false, changedOthers: ['get-ai-suggestions'] });
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
