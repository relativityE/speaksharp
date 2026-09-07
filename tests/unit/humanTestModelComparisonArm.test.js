import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  MODEL_COMPARISON_CDP_ARM,
  MODEL_COMPARISON_CDP_ARM_KEY,
  modelComparisonSwitchExpression,
} from '../../scripts/human-test/modelComparisonArm.mjs';

describe('#1426 CDP-only Production arm', () => {
  it('installs a hidden immutable Symbol marker and no URL/storage input', () => {
    expect(MODEL_COMPARISON_CDP_ARM).toMatch(/Object\.defineProperty/);
    expect(MODEL_COMPARISON_CDP_ARM).toContain(`Symbol.for("${MODEL_COMPARISON_CDP_ARM_KEY}")`);
    expect(MODEL_COMPARISON_CDP_ARM).toMatch(/enumerable: false/);
    expect(MODEL_COMPARISON_CDP_ARM).toMatch(/writable: false/);
    expect(MODEL_COMPARISON_CDP_ARM).not.toMatch(/location|searchParams|localStorage|sessionStorage/);
  });

  it('the CDP harness and browser installer use the same arm key', () => {
    const browserAuthority = readFileSync(
      'frontend/src/services/transcription/runtimeCandidateSwitch.ts', 'utf8',
    );
    expect(browserAuthority).toContain(`MODEL_COMPARISON_CDP_ARM_KEY = '${MODEL_COMPARISON_CDP_ARM_KEY}'`);
  });

  it('the executable observer installs the arm before it navigates', () => {
    const observer = readFileSync('scripts/human-test/observe-take.mjs', 'utf8');
    const arm = observer.indexOf("source: MODEL_COMPARISON_CDP_ARM");
    const navigate = observer.indexOf("Page.navigate");
    expect({ armFound: arm >= 0, beforeNavigation: arm < navigate }).toEqual({
      armFound: true,
      beforeNavigation: true,
    });
  });

  it('the CDP switch applies the requested arm and reads all three identity terms', async () => {
    const candidate = 'v4:distil:q4';
    globalThis.__SS_SWITCH_CANDIDATE__ = async (id) => ({ ok: true, candidate: id });
    globalThis.__SS_ACTIVE_CANDIDATE__ = () => ({
      requested: candidate,
      observed: candidate,
      expected: candidate,
      matches: true,
    });
    try {
      const receipt = await new Function(`return ${modelComparisonSwitchExpression(candidate)}`)();
      expect(receipt).toEqual({
        outcome: { ok: true, candidate },
        active: { requested: candidate, observed: candidate, expected: candidate, matches: true },
      });
    } finally {
      delete globalThis.__SS_SWITCH_CANDIDATE__;
      delete globalThis.__SS_ACTIVE_CANDIDATE__;
    }
  });

  it('quotes a candidate as data rather than executable source', async () => {
    const hostile = `x'); globalThis.__escaped = false; ('`;
    globalThis.__escaped = true;
    globalThis.__SS_SWITCH_CANDIDATE__ = async () => ({ ok: false, code: 'unknown_candidate' });
    globalThis.__SS_ACTIVE_CANDIDATE__ = () => null;
    try {
      await new Function(`return ${modelComparisonSwitchExpression(hostile)}`)();
      expect(globalThis.__escaped).toBe(true);
    } finally {
      delete globalThis.__escaped;
      delete globalThis.__SS_SWITCH_CANDIDATE__;
      delete globalThis.__SS_ACTIVE_CANDIDATE__;
    }
  });
});
