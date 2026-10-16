import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import manifest from '../fixtures/rwt/rwt-fixtures.manifest.json';
import {
  EDGE_MAX_PROVIDER_ATTEMPTS,
  buildRwtCoachingEvidenceArtifact,
  canonicalSuggestionSha256,
  coachingContract,
  coachingSessionBindingSha256,
  recomputeCoachingPromptSha256,
  writeRwtCoachingEvidenceArtifact,
  type RwtCoachingTakeEvidence,
} from '../live/helpers/rwtCoachingEvidence';

const fixture = manifest.fixtures.open_mic_tts;
const phrase = {
  version: 'gemini_coaching_v1' as const,
  what_worked: 'You opened with a clear point and supported it with a concrete example.',
  what_to_try_next: 'Pause after your headline so listeners can absorb the main idea.',
};
const attachPromptGenerationReceipt = (value: RwtCoachingTakeEvidence): RwtCoachingTakeEvidence => {
  const requestId = `50000000-0000-4000-8000-${value.sessionId.slice(-12)}`;
  const attemptId = `60000000-0000-4000-8000-${value.sessionId.slice(-12)}`;
  const digest = recomputeCoachingPromptSha256(value.savedInputReadback);
  if (!digest) throw new Error('synthetic prompt fixture must contain complete saved prompt inputs');
  const clientReleaseId = 'a'.repeat(40);
  if (value.source === 'fresh') {
    value.diagnosticRequestId = requestId;
    value.diagnosticAttemptId = attemptId;
    value.diagnosticClientAttempt = 1;
  }
  value.promptGenerationReceipt = {
    request: {
      sessionId: value.sessionId, product: value.product, requestId, attemptId,
      clientAttempt: 1, clientReleaseId,
    },
    response: {
      request_id: requestId, attempt_id: attemptId, client_attempt: 1,
      status: 200, outcome: 'success', reason: 'none', provider: 'google_gemini',
      configured_model: coachingContract.model, observed_model: value.authorityReceipt.model,
      source: 'fresh', provider_attempts: 1, retry_count: 0, prompt_sha256: digest,
      product: value.product, has_session: true, client_release_id: clientReleaseId,
      session_binding_sha256: coachingSessionBindingSha256(value.userId, value.sessionId),
    },
  };
  value.promptSha256 = value.source === 'fresh' ? digest : null;
  return value;
};
const take = (suffix: string, source: 'fresh' | 'cache' = 'fresh'): RwtCoachingTakeEvidence => {
  const sessionId = `10000000-0000-4000-8000-${suffix.padStart(12, '0')}`;
  const userId = '20000000-0000-4000-8000-000000000001';
  const metrics = {
    totalWords: 14, fillerCounts: { um: 1 }, durationSeconds: 8.1,
    wpm: 115, filler_counts: { um: 1 }, filler_words: null, next_action_signal: null,
  };
  return attachPromptGenerationReceipt({
    runId: 'rwt-run-42', suiteId: 'coaching-live-suite', product: 'open_mic',
    fixtureName: 'open_mic_tts', fixtureSha256: fixture.sha256,
    sessionId, userId,
    runOwnedBinding: { verified: true, runId: 'rwt-run-42', sessionId, userId, fixtureSha256: fixture.sha256 },
    transcript: 'Um, I opened with a clear point and supported it with an example.',
    metrics,
    savedInputReadback: {
      sessionId, userId, product: 'open_mic',
      transcript: 'Um, I opened with a clear point and supported it with an example.',
      metrics,
      promptContext: { transcriptState: 'available', focusContext: { kind: 'none' } },
    },
    configuredModel: coachingContract.model,
    diagnosticRequestId: `30000000-0000-4000-8000-${suffix.padStart(12, '0')}`,
    diagnosticAttemptId: `40000000-0000-4000-8000-${suffix.padStart(12, '0')}`,
    diagnosticClientAttempt: 1,
    diagnosticStatus: 200, diagnosticOutcome: 'success', diagnosticReason: 'none',
    providerAttempts: source === 'fresh' ? 1 : 0, retryCount: 0,
    source,
    providerDurationMs: source === 'fresh' ? 640 : 0, totalDurationMs: 920, promptSha256: null,
    authorityReceipt: {
      session_id: sessionId, user_id: userId, provider: 'google_gemini', model: 'gemini-3.8-flash-001',
      provider_request_made: true, receipt_suggestion_sha256: canonicalSuggestionSha256(phrase), current_suggestion_sha256: canonicalSuggestionSha256(phrase),
      ai_suggestions: { ...phrase }, ...(source === 'cache' ? { cache_read_count: 1 } : { cache_read_count: 0 }),
    },
    renderedSuggestions: { ...phrase },
  });
};
const focusTake = (suffix: string): RwtCoachingTakeEvidence => {
  const value = take(suffix);
  const focusFixture = manifest.fixtures.focus_points_tts;
  value.product = 'focus_points';
  value.fixtureName = 'focus_points_tts';
  value.fixtureSha256 = focusFixture.sha256;
  value.runOwnedBinding.fixtureSha256 = focusFixture.sha256;
  value.metrics = {
    totalWords: 129, focusVerdicts: ['covered', 'covered', 'covered', 'covered'],
    wpm: 112, filler_counts: { uh: 2 }, filler_words: null, next_action_signal: { metric: 'filler_rate' },
  };
  value.savedInputReadback = {
    ...value.savedInputReadback,
    product: 'focus_points',
    metrics: value.metrics,
    promptContext: {
      transcriptState: 'available',
      focusContext: {
        kind: 'focus', topic: 'Quarterly launch', points: [
          { label: 'Customer impact', verdict: 'detected', detectedAtSeconds: 21 },
          { label: 'Support capacity', verdict: 'not_detected', detectedAtSeconds: null },
        ],
      },
    },
  };
  value.authorityReceipt.ai_suggestions.version = 'gemini_coaching_focus_v1';
  const digest = canonicalSuggestionSha256(value.authorityReceipt.ai_suggestions);
  value.authorityReceipt.receipt_suggestion_sha256 = digest;
  value.authorityReceipt.current_suggestion_sha256 = digest;
  value.renderedSuggestions.version = 'gemini_coaching_focus_v1';
  return attachPromptGenerationReceipt(value);
};

describe('RWT restricted synthetic coaching evidence', () => {
  it('builds separate first/repeat evidence bound to pinned fixture, run-owned sessions, receipt and render', () => {
    const artifact = buildRwtCoachingEvidenceArtifact({
      releaseSha: 'a'.repeat(40), firstTake: take('1'), repeatTake: take('2', 'cache'),
    });
    expect(artifact).toMatchObject({
      schemaVersion: 'rwt_coaching_evidence_v1', visibility: 'restricted_synthetic',
      firstTake: { source: 'fresh', transcript: expect.any(String), metrics: expect.any(Object) },
      repeatTake: { source: 'cache' },
    });
    expect(artifact.firstTake.authorityReceipt.model).not.toBe(artifact.firstTake.configuredModel);
    expect(artifact.firstTake.renderedSuggestions).toEqual(artifact.firstTake.authorityReceipt.ai_suggestions);
    expect(JSON.stringify(artifact)).toContain(phrase.what_worked);
  });

  it('accepts Focus evidence only with the pinned Focus fixture and Focus-specific stored version', () => {
    const artifact = buildRwtCoachingEvidenceArtifact({
      releaseSha: 'a'.repeat(40), firstTake: focusTake('3'), repeatTake: focusTake('4'),
    });
    expect(artifact).toMatchObject({ product: 'focus_points', fixture: { name: 'focus_points_tts' } });
    expect(artifact.firstTake.authorityReceipt.ai_suggestions.version).toBe('gemini_coaching_focus_v1');
  });

  it('fails closed when the session or account is not bound to this run', () => {
    const unbound = take('1');
    unbound.runOwnedBinding = { ...unbound.runOwnedBinding, userId: '30000000-0000-4000-8000-000000000001' };
    expect(() => buildRwtCoachingEvidenceArtifact({ releaseSha: 'a'.repeat(40), firstTake: unbound, repeatTake: take('2') }))
      .toThrow(/not bound to this run/);
  });

  it('rejects an unpinned fixture hash and a user-data fixture', () => {
    const changed = take('1');
    changed.fixtureSha256 = 'c'.repeat(64);
    expect(() => buildRwtCoachingEvidenceArtifact({ releaseSha: 'a'.repeat(40), firstTake: changed, repeatTake: take('2') }))
      .toThrow(/pinned synthetic fixture/);
  });

  it('requires the generation input to match the authenticated saved-session readback', () => {
    const mismatched = take('1');
    mismatched.savedInputReadback.transcript = 'Different transcript';
    expect(() => buildRwtCoachingEvidenceArtifact({ releaseSha: 'a'.repeat(40), firstTake: mismatched, repeatTake: take('2') }))
      .toThrow(/differs from authenticated saved-session readback/);
  });

  it('rejects missing authority, mismatched saved/rendered text, and configured/observed model confusion', () => {
    const wrongSession = take('1');
    wrongSession.authorityReceipt.session_id = '40000000-0000-4000-8000-000000000001';
    expect(() => buildRwtCoachingEvidenceArtifact({ releaseSha: 'a'.repeat(40), firstTake: wrongSession, repeatTake: take('2') }))
      .toThrow(/authority receipt/);

    const wrongRender = take('1');
    wrongRender.renderedSuggestions.what_worked = 'Different text appeared in the card.';
    expect(() => buildRwtCoachingEvidenceArtifact({ releaseSha: 'a'.repeat(40), firstTake: wrongRender, repeatTake: take('2') }))
      .toThrow(/rendered suggestions differ/);

    const wrongModel = take('1');
    wrongModel.authorityReceipt.model = '';
    expect(() => buildRwtCoachingEvidenceArtifact({ releaseSha: 'a'.repeat(40), firstTake: wrongModel, repeatTake: take('2') }))
      .toThrow(/authority receipt/);
  });

  it('rejects runtime source/product unions, unknown serialized fields, and the wrong configured model', () => {
    const wrongProduct = take('1') as unknown as Record<string, unknown>;
    wrongProduct.product = 'other';
    expect(() => buildRwtCoachingEvidenceArtifact({ releaseSha: 'a'.repeat(40), firstTake: wrongProduct as never, repeatTake: take('2') }))
      .toThrow(/product is invalid/);

    const wrongSource = take('1') as unknown as Record<string, unknown>;
    wrongSource.source = 'mystery';
    expect(() => buildRwtCoachingEvidenceArtifact({ releaseSha: 'a'.repeat(40), firstTake: wrongSource as never, repeatTake: take('2') }))
      .toThrow(/source is invalid/);

    const extra = take('1') as unknown as Record<string, unknown>;
    extra.apiKey = 'must never be serialized';
    expect(() => buildRwtCoachingEvidenceArtifact({ releaseSha: 'a'.repeat(40), firstTake: extra as never, repeatTake: take('2') }))
      .toThrow(/unexpected field.*apiKey/i);

    const nestedExtra = take('1');
    (nestedExtra.authorityReceipt as unknown as Record<string, unknown>).authorization = 'must never be serialized';
    expect(() => buildRwtCoachingEvidenceArtifact({ releaseSha: 'a'.repeat(40), firstTake: nestedExtra, repeatTake: take('2') }))
      .toThrow(/unexpected field.*authorization/i);

    const wrongModel = take('1');
    wrongModel.configuredModel = `not-${coachingContract.model}`;
    expect(wrongModel.configuredModel).not.toBe('gemini-3.6-flash');
    expect(wrongModel.configuredModel).not.toBe('gemini-3.8-flash');
    expect(() => buildRwtCoachingEvidenceArtifact({ releaseSha: 'a'.repeat(40), firstTake: wrongModel, repeatTake: take('2') }))
      .toThrow(/configured model does not match the active coaching contract/);
  });

  it('recomputes the canonical saved suggestion digest; changing the pair and matching render cannot reuse old hashes', () => {
    const corrupted = take('1');
    corrupted.authorityReceipt.ai_suggestions.what_worked = 'A substituted phrase with untouched receipt hashes.';
    corrupted.renderedSuggestions.what_worked = corrupted.authorityReceipt.ai_suggestions.what_worked;
    expect(() => buildRwtCoachingEvidenceArtifact({ releaseSha: 'a'.repeat(40), firstTake: corrupted, repeatTake: take('2') }))
      .toThrow(/canonical suggestion digest does not match/);
  });

  it('independently recomputes fresh prompt binding and preserves the original binding across cache replay', () => {
    const artifact = buildRwtCoachingEvidenceArtifact({
      releaseSha: 'a'.repeat(40), firstTake: take('1'), repeatTake: take('2', 'cache'),
    });
    expect(artifact.firstTake.promptBinding).toMatchObject({
      verdict: 'PASS', reason: 'recomputed_from_bound_saved_prompt_inputs',
    });
    expect(artifact.repeatTake.promptBinding).toMatchObject({
      verdict: 'PASS', reason: 'recomputed_from_bound_saved_prompt_inputs',
    });
  });

  it('fails when transcript inputs change even if caller and server-supplied digest strings still agree', () => {
    const changed = take('1');
    changed.transcript = 'A substituted transcript with matching fake readback.';
    changed.savedInputReadback.transcript = changed.transcript;
    const callerAndReceiptDigest = changed.promptSha256;
    expect(changed.promptGenerationReceipt?.response.prompt_sha256).toBe(callerAndReceiptDigest);
    const artifact = buildRwtCoachingEvidenceArtifact({ releaseSha: 'a'.repeat(40), firstTake: changed, repeatTake: take('2') });
    expect(artifact.firstTake.promptBinding).toMatchObject({
      verdict: 'FAIL', reason: 'server_prompt_digest_mismatch',
    });
  });

  it('fails closed on wrong selected session, product, request, attempt, model, or contract digest', () => {
    const changedSession = take('1');
    const otherSession = '90000000-0000-4000-8000-000000000001';
    changedSession.sessionId = otherSession;
    changedSession.runOwnedBinding.sessionId = otherSession;
    changedSession.savedInputReadback.sessionId = otherSession;
    changedSession.authorityReceipt.session_id = otherSession;
    changedSession.promptGenerationReceipt!.request.sessionId = otherSession;
    const sessionArtifact = buildRwtCoachingEvidenceArtifact({ releaseSha: 'a'.repeat(40), firstTake: changedSession, repeatTake: take('2') });
    expect(sessionArtifact.firstTake.promptBinding).toMatchObject({ verdict: 'FAIL', reason: 'generation_request_or_session_binding_mismatch' });

    for (const mutate of [
      (proof: NonNullable<RwtCoachingTakeEvidence['promptGenerationReceipt']>) => { proof.response.product = 'focus_points'; },
      (proof: NonNullable<RwtCoachingTakeEvidence['promptGenerationReceipt']>) => { proof.response.request_id = '70000000-0000-4000-8000-000000000001'; },
      (proof: NonNullable<RwtCoachingTakeEvidence['promptGenerationReceipt']>) => { proof.response.attempt_id = '80000000-0000-4000-8000-000000000001'; },
      (proof: NonNullable<RwtCoachingTakeEvidence['promptGenerationReceipt']>) => { proof.response.prompt_sha256 = 'b'.repeat(64); },
    ]) {
      const wrong = take('3');
      mutate(wrong.promptGenerationReceipt!);
      const result = buildRwtCoachingEvidenceArtifact({ releaseSha: 'a'.repeat(40), firstTake: wrong, repeatTake: take('4') });
      expect(result.firstTake.promptBinding.verdict).toBe('FAIL');
    }

    const originalContractModel = coachingContract.model;
    try {
      for (const [index, contractModel] of ['gemini-3.6-flash', 'gemini-3.8-flash'].entries()) {
        coachingContract.model = contractModel;
        const wrongModel = take(String(31 + index * 2));
        wrongModel.promptGenerationReceipt!.response.configured_model = `not-${coachingContract.model}`;
        expect(wrongModel.promptGenerationReceipt!.response.configured_model).not.toBe(coachingContract.model);
        const result = buildRwtCoachingEvidenceArtifact({
          releaseSha: 'a'.repeat(40), firstTake: wrongModel, repeatTake: take(String(32 + index * 2)),
        });
        expect(result.firstTake.promptBinding).toMatchObject({
          verdict: 'FAIL', reason: 'generation_request_or_session_binding_mismatch',
        });
      }
    } finally {
      coachingContract.model = originalContractModel;
    }

    const mismatchedCurrentAttempt = take('5');
    mismatchedCurrentAttempt.diagnosticRequestId = '70000000-0000-4000-8000-000000000002';
    const attemptArtifact = buildRwtCoachingEvidenceArtifact({
      releaseSha: 'a'.repeat(40), firstTake: mismatchedCurrentAttempt, repeatTake: take('6'),
    });
    expect(attemptArtifact.firstTake.promptBinding).toMatchObject({
      verdict: 'FAIL', reason: 'generation_request_or_session_binding_mismatch',
    });
  });

  it('keeps HOLD when exact authoritative prompt inputs or the original generation response are unavailable', () => {
    const missingPromptInputs = take('1');
    delete missingPromptInputs.savedInputReadback.promptContext;
    const missingReceipt = take('3');
    delete missingReceipt.promptGenerationReceipt;
    const artifact = buildRwtCoachingEvidenceArtifact({
      releaseSha: 'a'.repeat(40), firstTake: missingPromptInputs, repeatTake: missingReceipt,
    });
    expect(artifact.firstTake.promptBinding).toMatchObject({
      verdict: 'HOLD', reason: 'authoritative_prompt_inputs_or_generation_receipt_unavailable',
    });
    expect(artifact.repeatTake.promptBinding).toMatchObject({
      verdict: 'HOLD', reason: 'authoritative_prompt_inputs_or_generation_receipt_unavailable',
    });
  });

  it('requires a server-recorded cache read for repeat-take cache provenance', () => {
    const missingCache = take('2', 'cache');
    delete missingCache.authorityReceipt.cache_read_count;
    expect(() => buildRwtCoachingEvidenceArtifact({ releaseSha: 'a'.repeat(40), firstTake: take('1'), repeatTake: missingCache }))
      .toThrow(/cache replay lacks/);
  });

  it('writes exact synthetic evidence create-only with owner-only file permissions', () => {
    const directory = mkdtempSync(path.join(realpathSync(tmpdir()), 'rwt-coaching-evidence-'));
    try {
      const input = { releaseSha: 'a'.repeat(40), firstTake: take('1'), repeatTake: take('2', 'cache') };
      const result = writeRwtCoachingEvidenceArtifact(input, directory);
      expect(result.mode).toBe(0o600);
      expect(statSync(directory).mode & 0o077).toBe(0);
      const contents = readFileSync(result.file, 'utf8');
      expect(contents).toContain(phrase.what_worked);
      expect(contents).toContain(input.firstTake.transcript);
      expect(() => writeRwtCoachingEvidenceArtifact(input, directory)).toThrow(/refusing overwrite/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('refuses an output directory accessible to group or other users', () => {
    const directory = mkdtempSync(path.join(realpathSync(tmpdir()), 'rwt-coaching-evidence-'));
    try {
      chmodSync(directory, 0o755);
      expect(() => writeRwtCoachingEvidenceArtifact({
        releaseSha: 'a'.repeat(40), firstTake: take('1'), repeatTake: take('2'),
      }, directory)).toThrow(/must not grant group or other access/);
    } finally {
      chmodSync(directory, 0o700);
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('rejects a symlink evidence destination without writing through it', () => {
    const parent = mkdtempSync(path.join(realpathSync(tmpdir()), 'rwt-coaching-evidence-'));
    const target = path.join(parent, 'target');
    const link = path.join(parent, 'linked');
    try {
      mkdirSync(target, { mode: 0o700 });
      symlinkSync(target, link, 'dir');
      expect(() => writeRwtCoachingEvidenceArtifact({
        releaseSha: 'a'.repeat(40), firstTake: take('1'), repeatTake: take('2'),
      }, link)).toThrow(/symlink/);
      expect(() => writeRwtCoachingEvidenceArtifact({
        releaseSha: 'a'.repeat(40), firstTake: take('1'), repeatTake: take('2'),
      }, path.join(link, 'nested'))).toThrow(/symlink/);
      expect(readdirSync(target)).toEqual([]);
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });

  it('rejects a group/world-writable non-sticky ancestor but permits the system temp ancestor', () => {
    const parent = mkdtempSync(path.join(realpathSync(tmpdir()), 'rwt-coaching-evidence-'));
    try {
      chmodSync(parent, 0o777);
      expect(() => writeRwtCoachingEvidenceArtifact({
        releaseSha: 'a'.repeat(40), firstTake: take('1'), repeatTake: take('2'),
      }, path.join(parent, 'private'))).toThrow(/unsafe writable ancestor/);
    } finally {
      chmodSync(parent, 0o700);
      rmSync(parent, { recursive: true, force: true });
    }
  });
});

/**
 * #1258 option A (Codex r4290615974, PM 6207410484) — a truthful three-attempt success must produce the evidence artifact.
 * The bound is the Edge function's own MAX_PROVIDER_ATTEMPTS; the fresh/cache consistency checks are unchanged.
 */
describe('coaching evidence — the option A attempt ceiling', () => {
  const build = (first: RwtCoachingTakeEvidence) =>
    buildRwtCoachingEvidenceArtifact({ releaseSha: 'a'.repeat(40), firstTake: first, repeatTake: take('2') });
  const withAttempts = (attempts: number, retries: number, source: 'fresh' | 'cache' = 'fresh') => {
    const t = take('1', source);
    t.providerAttempts = attempts;
    t.retryCount = retries;
    return t;
  };

  it('the bound is pinned to the Edge MAX_PROVIDER_ATTEMPTS (3)', () => {
    const edge = readFileSync(path.resolve(__dirname, '../../backend/supabase/functions/get-ai-suggestions/providerRetry.ts'), 'utf8');
    expect(edge).toContain(`export const MAX_PROVIDER_ATTEMPTS = ${EDGE_MAX_PROVIDER_ATTEMPTS};`);
    expect(EDGE_MAX_PROVIDER_ATTEMPTS).toBe(3);
  });

  it('POSITIVE: a fresh 3-attempt / 2-retry recovery builds (as do 1/0 and 2/1)', () => {
    for (const [a, r] of [[1, 0], [2, 1], [3, 2]]) expect(() => build(withAttempts(a, r))).not.toThrow();
  });

  it('beyond the ceiling (4/3), an inconsistent fresh retry (3/1), a cache with attempts, or a fraction is rejected', () => {
    expect(() => build(withAttempts(4, 3))).toThrow();
    expect(() => build(withAttempts(3, 1))).toThrow();
    expect(() => build(withAttempts(1, 0, 'cache'))).toThrow();
    expect(() => build(withAttempts(2.5, 1.5))).toThrow();
  });
});
