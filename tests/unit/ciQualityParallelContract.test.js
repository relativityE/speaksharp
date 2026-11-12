import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import yaml from 'js-yaml';
import { describe, it, expect } from 'vitest';

const workflow = yaml.load(readFileSync('.github/workflows/ci.yml', 'utf8'));
const quality = workflow.jobs.quality;
const coverage = workflow.jobs['unit-coverage-merge'];
const guard = coverage.steps.find((step) => step.name === 'Require Upstream Success');

describe('parallel quality preserves required merge evidence', () => {
  it('starts the identical quality command after scope, without waiting for tests', () => {
    expect(quality.needs).toBe('scope');
    // #1837: the docs lane runs the identical quality gate as well.
    expect(quality.if).toBe("needs.scope.outputs.full_required == 'true' || needs.scope.outputs.docs_lane == 'true'");
    expect(quality.steps.filter((step) => step.run === 'pnpm quality')).toHaveLength(1);
    expect(coverage.steps.some((step) => step.run === 'pnpm quality')).toBe(false);
    expect(quality.steps.find((step) => step.uses === 'actions/checkout@v6').with?.ref).toBeUndefined();
    expect(quality.steps.find((step) => step.run === 'pnpm quality')['continue-on-error']).toBeUndefined();
  });

  it('keeps quality upstream of the existing required coverage gate and report', () => {
    expect(coverage.needs).toEqual(['scope', 'unit-shard', 'quality']);
    expect(guard.env.QUALITY_RESULT).toBe('${{ needs.quality.result }}');
    expect(workflow.jobs['full-evidence'].needs).toContain('unit-coverage-merge');
    expect(workflow.jobs.report.needs).toContain('unit-coverage-merge');
  });

  it('executes the real shell guard and rejects failed, skipped, cancelled or absent quality', () => {
    for (const result of ['failure', 'skipped', 'cancelled', '', 'neutral']) {
      const run = spawnSync('bash', ['-c', guard.run], {
        env: { ...process.env, UNIT_RESULT: 'success', QUALITY_RESULT: result }, encoding: 'utf8',
      });
      expect(run.status).not.toBe(0);
    }
    expect(spawnSync('bash', ['-c', guard.run], {
      env: { ...process.env, UNIT_RESULT: 'success', QUALITY_RESULT: 'success' },
    }).status).toBe(0);
    for (const result of ['failure', 'skipped', 'cancelled']) {
      expect(spawnSync('bash', ['-c', guard.run], {
        env: { ...process.env, UNIT_RESULT: result, QUALITY_RESULT: 'success' },
      }).status).not.toBe(0);
    }
  });
});
