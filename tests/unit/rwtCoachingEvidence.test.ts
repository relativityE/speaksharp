import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import manifest from '../fixtures/rwt/rwt-fixtures.manifest.json';
import { buildRwtCoachingEvidenceArtifact, writeRwtCoachingEvidenceArtifact, type RwtCoachingTakeEvidence } from '../live/helpers/rwtCoachingEvidence';

const fixture = manifest.fixtures.open_mic_tts;
const phrase = {
  version: 'gemini_coaching_v1' as const,
  what_worked: 'You opened with a clear point and supported it with a concrete example.',
  what_to_try_next: 'Pause after your headline so listeners can absorb the main idea.',
};
const take = (suffix: string, source: 'fresh' | 'cache' = 'fresh'): RwtCoachingTakeEvidence => {
  const sessionId = `10000000-0000-4000-8000-${suffix.padStart(12, '0')}`;
  const userId = '20000000-0000-4000-8000-000000000001';
  return {
    runId: 'rwt-run-42', suiteId: 'coaching-live-suite', product: 'open_mic',
    fixtureName: 'open_mic_tts', fixtureSha256: fixture.sha256,
    sessionId, userId,
    runOwnedBinding: { verified: true, runId: 'rwt-run-42', sessionId, userId, fixtureSha256: fixture.sha256 },
    transcript: 'Um, I opened with a clear point and supported it with an example.',
    metrics: { totalWords: 14, fillerCounts: { um: 1 }, durationSeconds: 8.1 },
    savedInputReadback: {
      sessionId, userId, product: 'open_mic',
      transcript: 'Um, I opened with a clear point and supported it with an example.',
      metrics: { totalWords: 14, fillerCounts: { um: 1 }, durationSeconds: 8.1 },
    },
    configuredModel: 'gemini-3.8-flash',
    diagnosticRequestId: `30000000-0000-4000-8000-${suffix.padStart(12, '0')}`,
    diagnosticAttemptId: `40000000-0000-4000-8000-${suffix.padStart(12, '0')}`,
    diagnosticStatus: 200, diagnosticOutcome: 'success', diagnosticReason: 'none',
    providerAttempts: source === 'fresh' ? 1 : 0, retryCount: 0,
    source,
    providerDurationMs: source === 'fresh' ? 640 : 0, totalDurationMs: 920, promptSha256: 'a'.repeat(64),
    authorityReceipt: {
      session_id: sessionId, user_id: userId, provider: 'google_gemini', model: 'gemini-3.8-flash-001',
      provider_request_made: true, receipt_suggestion_sha256: 'b'.repeat(64), current_suggestion_sha256: 'b'.repeat(64),
      ai_suggestions: { ...phrase }, ...(source === 'cache' ? { cache_read_count: 1 } : { cache_read_count: 0 }),
    },
    renderedSuggestions: { ...phrase },
  };
};
const focusTake = (suffix: string): RwtCoachingTakeEvidence => {
  const value = take(suffix);
  const focusFixture = manifest.fixtures.focus_points_tts;
  value.product = 'focus_points';
  value.fixtureName = 'focus_points_tts';
  value.fixtureSha256 = focusFixture.sha256;
  value.runOwnedBinding.fixtureSha256 = focusFixture.sha256;
  value.metrics = { totalWords: 129, focusVerdicts: ['covered', 'covered', 'covered', 'covered'] };
  value.savedInputReadback = { ...value.savedInputReadback, product: 'focus_points', metrics: value.metrics };
  value.authorityReceipt.ai_suggestions.version = 'gemini_coaching_focus_v1';
  value.renderedSuggestions.version = 'gemini_coaching_focus_v1';
  return value;
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

  it('requires a server-recorded cache read for repeat-take cache provenance', () => {
    const missingCache = take('2', 'cache');
    delete missingCache.authorityReceipt.cache_read_count;
    expect(() => buildRwtCoachingEvidenceArtifact({ releaseSha: 'a'.repeat(40), firstTake: take('1'), repeatTake: missingCache }))
      .toThrow(/cache replay lacks/);
  });

  it('writes exact synthetic evidence create-only with owner-only file permissions', () => {
    const directory = mkdtempSync('/private/tmp/rwt-coaching-evidence-');
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
    const directory = mkdtempSync('/private/tmp/rwt-coaching-evidence-');
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
});
