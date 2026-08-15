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
