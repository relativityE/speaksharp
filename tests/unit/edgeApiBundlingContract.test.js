// @vitest-environment node
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import yaml from 'js-yaml';

const workflow = yaml.load(readFileSync('.github/workflows/deploy-supabase-migrations.yml', 'utf8'));
const jobs = workflow.jobs;
const functions = ['stripe-webhook', 'check-usage-limit', 'create-user', 'observability-smoke',
  'attest-session-engine', 'objective-register-source', 'get-ai-suggestions', 'stripe-checkout',
  'stripe-billing-portal', 'account-closure'];
const deploySteps = jobs['deploy-edge-functions'].steps;
const deploy = deploySteps.find(step => step.name === 'Deploy Edge Functions');
const readback = jobs['verify-edge-functions'].steps.find(step => step.run?.includes('functions list'));

// Execute the checked-in shell, replacing only the external CLI with an argument recorder.
// The child receives no real account, provider, database or deployment credentials.
function execute(script, extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'edge-api-contract-'));
  const log = join(dir, 'calls');
  try {
    const bin = join(dir, 'supabase');
    writeFileSync(bin, '#!/bin/sh\nprintf "%s\\n" "$*" >> "$EDGE_CALL_LOG"\n'
      + 'if [ "$1 $2" = "functions list" ]; then printf "%s\\n" "$EDGE_FUNCTION_LIST"; exit 0; fi\n'
      + 'if [ "$3" = "${EDGE_FAIL_SLUG:-}" ]; then exit 23; fi\n');
    chmodSync(bin, 0o700);
    const result = spawnSync('/bin/bash', ['-e', '-c', script], {
      cwd: dir, encoding: 'utf8', timeout: 5000,
      env: { PATH: `${dir}:${process.env.PATH}`, EDGE_CALL_LOG: log,
        SUPABASE_PROJECT_ID: 'synthetic-project', EDGE_FUNCTION_LIST: functions.join('\n'), ...extra },
    });
    let calls = [];
    try { calls = readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(line => line.split(' ')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    return { ...result, calls };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('reviewed Edge deployment uses server-side bundling without changing publication scope', () => {
  const recorded = execute(deploy.run);
  it.each(functions)('publishes only the reviewed %s arguments through the Docker-free route', slug => {
    const call = recorded.calls[functions.indexOf(slug)];
    expect(recorded.error).toBeUndefined();
    expect(recorded.status).toBe(0);
    expect(call).toEqual(['functions', 'deploy', slug, '--project-ref', 'synthetic-project',
      '--no-verify-jwt', '--use-api']);
  });
  it('keeps exactly ten serial explicit targets, with no prune, wildcard or parallel publication', () => {
    expect(recorded.calls.map(call => call[2])).toEqual(functions);
    expect(deploy['working-directory']).toBe('backend/supabase');
    expect(deploy.run).not.toMatch(/(?:^|\s)&(?:\s|$)|--prune|--jobs|--use-docker|--legacy-bundle/);
  });
  it('stops at a failed publication instead of publishing later targets', () => {
    const result = execute(deploy.run, { EDGE_FAIL_SLUG: 'check-usage-limit' });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(23);
    expect(result.calls.map(call => call[2])).toEqual(functions.slice(0, 2));
  });
  it('keeps explicit production intent, exact-main admission and the serial database slot', () => {
    expect(workflow.on.workflow_call.inputs.deploy_production.default).toBe(false);
    expect(workflow.on.workflow_dispatch.inputs.deploy_production.default).toBe(false);
    expect(workflow.concurrency).toEqual({ group: 'production-database-migrations', 'cancel-in-progress': false });
    const admission = jobs['validate-edge-configuration'];
    for (const condition of ['inputs.deploy_production == true', "github.event_name == 'workflow_dispatch'", "github.ref == 'refs/heads/main'"]) {
      expect(admission.if).toContain(condition);
    }
    expect(admission.steps.some(step => step.run === 'node scripts/production-release-policy.mjs authorize')).toBe(true);
  });
  it('requires verified T2/TLS before CAS and rechecks qualified main before publication', () => {
    const prerequisites = jobs['verify-t2-database-prerequisites'];
    expect(prerequisites.environment).toBe('production-db');
    const prerequisiteScript = prerequisites.steps.find(step => step.run?.includes('t2-migration-postflight')).run;
    expect(prerequisiteScript).toContain('assert-db-connectivity-tls.sh');
    const invalidation = jobs['invalidate-account-closure-authority'];
    expect(invalidation.needs).toContain('verify-t2-database-prerequisites');
    expect(invalidation.if).toContain("needs.verify-t2-database-prerequisites.result == 'success'");
    expect(invalidation.steps.findIndex(step => step.run === 'node scripts/production-release-policy.mjs authorize'))
      .toBeLessThan(invalidation.steps.findIndex(step => step.run === 'node scripts/account-closure-invalidate.mjs'));
    expect(invalidation.steps.some(step => step.run === 'node scripts/account-closure-invalidate.mjs')).toBe(true);
    const publication = jobs['deploy-edge-functions'];
    expect(publication.needs).toContain('invalidate-account-closure-authority');
    expect(publication.if).toContain("needs.invalidate-account-closure-authority.result == 'success'");
    const policy = deploySteps.findIndex(step => step.run === 'node scripts/production-release-policy.mjs authorize');
    const t2 = deploySteps.findIndex(step => step.run?.includes('t2-migration-postflight.mjs verify release'));
    const publish = deploySteps.indexOf(deploy);
    expect(policy).toBeGreaterThan(-1);
    expect(policy).toBeLessThan(t2);
    expect(t2).toBeLessThan(publish);
    expect(deploySteps[t2].run).toContain('assert-db-connectivity-tls.sh');
    expect(deploySteps.find(step => step.uses === 'supabase/setup-cli@v2').with.version).toBe('2.101.0');
  });
  it('requires hosted readback after publication, including when the SQL job is skipped', () => {
    expect(jobs['deploy-production-db'].if).toContain("inputs.operation != 'edge-functions'");
    expect(jobs['verify-edge-functions'].if).toContain('always()');
    expect(jobs['verify-edge-functions'].if).toContain("needs.deploy-edge-functions.result == 'success'");
    expect(execute(readback.run).status).toBe(0);
    const missing = execute(readback.run, { EDGE_FUNCTION_LIST: functions.slice(0, -1).join('\n') });
    expect(missing.status).not.toBe(0);
    expect(missing.stdout).toContain('account-closure missing after Edge deployment');
  });
});
