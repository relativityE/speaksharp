/**
 * #892 deterministic contract test for the transcript-fidelity gate. Proves the new gate FAILS a
 * clipped opening (the #891 manual failure) that the OLD one-keyword-anywhere gate let through —
 * the before/after of the release-gating predicate, no deploy required. @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { evaluateTranscriptFidelity, HARVARD_FIXTURE_FIDELITY } from '../transcriptFidelity';

// The legacy release-gating predicate (one keyword anywhere) — for the before/after comparison.
const LEGACY_ONE_KEYWORD = /\b(stale|beer|pepper|beef|swan|park|twister|wild|puppy|quick|brown|fox)\b/i;

const COMPLETE = 'The stale smell of old beer lingers, a dash of pepper spoils beef stew. Well, the swan.';
// #891 failure: opening clause ("The stale smell of old") dropped; later words survive.
const CLIPPED_OPENING = 'beer lingers, a dash of pepper spoils beef stew. Well, the swan.';
const ONE_KEYWORD_ONLY = 'um so anyway the beer was there';

describe('#892 transcript-fidelity gate', () => {
  it('accepts a complete fixture transcript', () => {
    const r = evaluateTranscriptFidelity(COMPLETE, HARVARD_FIXTURE_FIDELITY);
    expect(r.ok).toBe(true);
    expect(r.openingFound).toBe(true);
  });

  it('REJECTS a clipped opening — the #891 failure the old gate missed', () => {
    // The old gate would PASS this (a later keyword survives) — that is exactly the silent-pass bug.
    expect(LEGACY_ONE_KEYWORD.test(CLIPPED_OPENING)).toBe(true);
    // The new gate FAILS it on the missing opening anchor.
    const r = evaluateTranscriptFidelity(CLIPPED_OPENING, HARVARD_FIXTURE_FIDELITY);
    expect(r.openingFound).toBe(false);
    expect(r.ok).toBe(false);
  });

  it('REJECTS one-keyword-anywhere (kills the weak coverage gate)', () => {
    expect(LEGACY_ONE_KEYWORD.test(ONE_KEYWORD_ONLY)).toBe(true); // old gate passes
    const r = evaluateTranscriptFidelity(ONE_KEYWORD_ONLY, HARVARD_FIXTURE_FIDELITY);
    expect(r.ok).toBe(false); // new gate fails: no opening + coverage < 3
  });

  it('is engine-version agnostic and punctuation/casing tolerant', () => {
    const messyButComplete = '  THE   stale, SMELL of OLD beer... a DASH of pepper; beef!!! swan?? ';
    expect(evaluateTranscriptFidelity(messyButComplete, HARVARD_FIXTURE_FIDELITY).ok).toBe(true);
    expect(evaluateTranscriptFidelity('', HARVARD_FIXTURE_FIDELITY).ok).toBe(false);
    expect(evaluateTranscriptFidelity(null, HARVARD_FIXTURE_FIDELITY).ok).toBe(false);
  });

  it('REJECTS a verbatim phrase loop (v4 q4 duplication)', () => {
    // opening + coverage pass, so the ONLY failure is the repeated 5+-word span.
    const looped = 'stale beer pepper beef swan and give me one clear thing to improve give me one clear thing to improve';
    const r = evaluateTranscriptFidelity(looped, HARVARD_FIXTURE_FIDELITY);
    expect(r.loopDetected).toBe(true);
    expect(r.ok).toBe(false);
  });

  it('catches a near-verbatim loop despite casing/punctuation drift (normalized before compare)', () => {
    // Whisper loops sometimes drift in casing/punctuation; normalization must collapse them.
    const drifted = 'stale beer pepper beef swan Release validation, native Chrome microphone. release validation native chrome microphone';
    const r = evaluateTranscriptFidelity(drifted, HARVARD_FIXTURE_FIDELITY);
    expect(r.loopDetected).toBe(true);
  });

  it('does NOT flag a short natural self-correction', () => {
    // "a technical detail, technical idea" — a 1-2 word correction, not a >=5-word loop.
    const natural = 'stale beer pepper beef swan i explain a technical detail technical idea and i tend to speak fast';
    const r = evaluateTranscriptFidelity(natural, HARVARD_FIXTURE_FIDELITY);
    expect(r.loopDetected).toBe(false);
    expect(r.ok).toBe(true);
  });
});
