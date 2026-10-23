import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
    expect(prerequisite.steps.some(step => step.run?.includes('node scripts/t2-migration-postflight.mjs verify release'))).toBe(true);
    for (const name of ['invalidate-account-closure-authority', 'deploy-edge-functions']) {
      expect(jobs[name].needs).toContain('verify-t2-database-prerequisites');
      expect(jobs[name].if).toContain("needs.verify-t2-database-prerequisites.result == 'success'");
      expect(jobs[name].if).not.toContain("needs.verify-t2-database-prerequisites.result == 'skipped'");
    }
    const steps = jobs['deploy-edge-functions'].steps;
    const check = steps.findIndex(step => step.run?.includes('node scripts/t2-migration-postflight.mjs verify release'));
    const mutation = steps.findIndex(step => step.name === 'Deploy Edge Functions');
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(mutation);
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
});
