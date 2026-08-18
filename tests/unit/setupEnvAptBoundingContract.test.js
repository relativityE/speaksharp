import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import yaml from 'js-yaml';

// #1311 Option A regression contract. Two independent apt paths in the shared setup action stalled for up
// to 6h (Canvas/Sharp native deps in unit shards; Playwright `install-deps` in e2e shards). The authorized
// fix is a bounded, FAIL-CLOSED timeout on BOTH apt phases — terminate at the deadline and fail the job
// immediately, with NO retry/repair/further apt on the disposable runner — plus a controlled-contention
// throttle and a job-level backstop. This test freezes that contract so a future edit cannot silently
// reintroduce an unbounded apt phase, an apt retry-after-kill, or drop the throttle/backstop.
const root = process.cwd();
const actionText = readFileSync(
  resolve(root, '.github/actions/setup-environment/action.yml'),
  'utf8',
);
const actionDoc = yaml.load(actionText);
const steps = actionDoc.runs.steps;
const stepByName = (name) => steps.find((s) => s.name === name);

const APT_STEPS = [
  'Install System Dependencies (Canvas/Sharp)',
  'Install Playwright system deps (apt)',
];

describe.each(APT_STEPS)(
  'setup-environment apt step "%s": bounded + fail-closed (#1311 Option A)',
  (name) => {
    const step = stepByName(name);

    it('exists and is Linux-gated (GNU timeout is Linux-only; macOS/self-hosted must not inherit it)', () => {
      expect(step, `missing apt step: ${name}`).toBeTruthy();
      expect(step.if).toContain("runner.os == 'Linux'");
    });

    it('wraps the apt invocation in a bounded `timeout`', () => {
      expect(step.run).toMatch(/timeout(\s+-k\s+\d+)?\s+\d+\b/);
    });

    it('is FAIL-CLOSED: no retry loop, no dpkg repair, and it propagates the exit code', () => {
      // No bash retry loop around apt (the pre-#1311 `until ... && break` / `for i in` pattern).
      expect(step.run).not.toMatch(/\buntil\b|\bfor\s+i\b|&&\s*break/);
      // No self-repair on a killed/corrupted dpkg on this runner.
      expect(step.run).not.toMatch(/dpkg\s+--configure/);
      // The step must exit with the command's status (fail the job), not swallow it.
      expect(step.run).toMatch(/exit\s+\$rc/);
    });

    it('reports a timeout (rc 124/137) distinctly from a genuine apt/dpkg exit', () => {
      expect(step.run).toMatch(/124/);
      expect(step.run).toMatch(/137/);
      expect(step.run).toMatch(/::error::/);
    });
  },
);

describe('setup-environment: split + diagnostic timeline (#1311 Option A)', () => {
  it('the combined `install --with-deps` is gone (split so a hang names itself: apt vs CDN)', () => {
    expect(actionText).not.toContain('playwright install --with-deps');
    // The CDN browser download is a separate, plainly-named step.
    expect(stepByName('Install Playwright browser (chromium)')).toBeTruthy();
  });

  it('emits per-phase timestamp markers and pnpm cache hit/miss', () => {
    expect(actionText).toContain('[phase]');
    expect(actionText).toContain('cache-hit=');
  });
});

const ci = yaml.load(
  readFileSync(resolve(root, '.github/workflows/ci.yml'), 'utf8'),
);

describe.each(['unit-shard', 'e2e'])(
  'ci.yml "%s": 4-wide default concurrency + job backstop (#1311)',
  (job) => {
    it('has NO max-parallel throttle (restored 4-wide/default; the 2-wide trial was dropped as an unproven, permanent cost)', () => {
      expect(ci.jobs[job].strategy['max-parallel']).toBeUndefined();
    });

    it('keeps a job-level timeout-minutes backstop (the outer containment bound)', () => {
      expect(typeof ci.jobs[job]['timeout-minutes']).toBe('number');
    });
  },
);
