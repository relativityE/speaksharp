import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';

const action = yaml.load(readFileSync('.github/actions/setup-environment/action.yml', 'utf8'));
const ci = yaml.load(readFileSync('.github/workflows/ci.yml', 'utf8'));
const sharedAction = './.github/actions/setup-environment';
const evidenceJobs = ['e2e', 'full-evidence'];

// The producer's Node patch is part of its runtime identity. A floating major
// can resolve differently on two runner images within the SAME workflow run.
function resolvedEvidenceNode(actionDoc, job) {
  const nodeSteps = actionDoc.runs.steps.filter(step => step.uses?.startsWith('actions/setup-node@'));
  if (nodeSteps.length !== 1) throw new Error('One authoritative Node setup required');
  const options = nodeSteps[0].with;
  if (typeof options?.['node-version'] !== 'string' || !/^22\.\d+\.\d+$/.test(options['node-version'])
    || options['node-version-file'] !== undefined || options['check-latest'] === true) {
    throw new Error('Exact Node patch required; no floating or alternate resolver');
  }
  const setups = job.steps.filter(step => step.uses === sharedAction);
  if (setups.length !== 1 || setups[0].if || job.steps.some(step => step.uses?.startsWith('actions/setup-node@'))
    || setups[0].with?.['node-version'] !== undefined || setups[0].with?.['node-version-file'] !== undefined) {
    throw new Error('Evidence job must use the shared Node setup without an override');
  }
  return options['node-version'];
}

describe('CI receipt producers and collector use one exact Node patch', () => {
  it.each(evidenceJobs)('%s resolves the checked-in exact patch through the shared action', job => {
    expect(resolvedEvidenceNode(action, ci.jobs[job])).toMatch(/^22\.\d+\.\d+$/);
  });

  it('the actual producer and collector resolve the same runtime', () => {
    expect(new Set(evidenceJobs.map(job => resolvedEvidenceNode(action, ci.jobs[job]))).size).toBe(1);
  });

  it.each(['22', '22.23', '^22.23.3', '>=22', 'lts/*', '${{ inputs.node-version }}'])('refuses floating resolver %s', version => {
    const changed = structuredClone(action);
    changed.runs.steps.find(step => step.uses?.startsWith('actions/setup-node@')).with['node-version'] = version;
    expect(() => resolvedEvidenceNode(changed, ci.jobs.e2e)).toThrow(/Exact Node patch/);
  });

  it.each(evidenceJobs)('%s cannot override the common runtime with another setup step', job => {
    const changed = structuredClone(ci.jobs[job]);
    changed.steps.push({ uses: 'actions/setup-node@v6', with: { 'node-version': '22.23.3' } });
    // Use an exact-pin fixture so this control fails for the override itself,
    // independently of whether the source version has been repaired yet.
    const pinned = structuredClone(action);
    pinned.runs.steps.find(step => step.uses?.startsWith('actions/setup-node@')).with['node-version'] = '22.23.4';
    expect(() => resolvedEvidenceNode(pinned, changed)).toThrow(/without an override/);
  });
});
