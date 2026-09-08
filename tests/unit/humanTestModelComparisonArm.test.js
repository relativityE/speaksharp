import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  MODEL_COMPARISON_AUTH_KEY,
  modelComparisonArmExpression,
  modelComparisonSwitchExpression,
} from '../../scripts/human-test/modelComparisonArm.mjs';

describe('#1432 signed CDP Production authorization', () => {
  const authorization = {
    payload: {
      version: 'speaksharp.model-comparison-authorization.v1', releaseSha: 'a'.repeat(40),
      origin: 'https://speaksharp-public.vercel.app', nonce: 'nonce-1234567890abcdef',
      issuedAt: '2026-09-08T12:00:00.000Z', expiresAt: '2026-09-08T12:01:00.000Z',
    },
    signature: 'signed-envelope-value',
  };

  it('installs a hidden immutable signed envelope and no URL/storage input', () => {
    const arm = modelComparisonArmExpression(authorization);
    expect(arm).toMatch(/Object\.defineProperty/);
    expect(arm).toContain(`Symbol.for("${MODEL_COMPARISON_AUTH_KEY}")`);
    expect(arm).toContain(JSON.stringify(authorization));
    expect(arm).toMatch(/enumerable: false/);
    expect(arm).toMatch(/writable: false/);
    expect(arm).not.toMatch(/searchParams|localStorage|sessionStorage/);
  });

  it('the harness and browser verifier use the same authorization key', () => {
    const browserAuthority = readFileSync(
      'frontend/src/services/transcription/modelComparisonAuthorization.ts', 'utf8',
    );
    expect(browserAuthority).toContain(`MODEL_COMPARISON_AUTH_KEY = '${MODEL_COMPARISON_AUTH_KEY}'`);
  });

  it('the executable observer installs the signed authorization before it navigates', () => {
    const observer = readFileSync('scripts/human-test/observe-take.mjs', 'utf8');
    expect(observer).toContain("arg('app', 'https://speaksharp-public.vercel.app')");
    const arm = observer.indexOf('source: modelComparisonArmExpression(signedAuthorization)');
    const navigate = observer.indexOf("Page.navigate");
    expect({ armFound: arm >= 0, beforeNavigation: arm < navigate }).toEqual({
      armFound: true,
      beforeNavigation: true,
    });
  });

  it('CASUALTY: removes the authorization installer after the one authorized document', () => {
    const observer = readFileSync('scripts/human-test/observe-take.mjs', 'utf8');
    const navigate = observer.indexOf("Page.navigate");
    const remove = observer.indexOf("Page.removeScriptToEvaluateOnNewDocument");
    expect({ removeFound: remove >= 0, removedAfterNavigation: remove > navigate }).toEqual({
      removeFound: true,
      removedAfterNavigation: true,
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
