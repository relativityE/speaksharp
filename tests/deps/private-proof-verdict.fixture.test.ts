// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  REQUIREMENTS,
  evaluateProof,
  evaluateRelease,
  hasDeprecatedRawDiagnosticFields,
} from '../../scripts/lib/private-proof-verdict.mjs';

// #1314 Phase B — FIXTURE tests for the Private-STT proof verdict.
//
// The point is not that a good run passes. It is that each specific way the PREVIOUS harness produced silent
// non-evidence now produces an explicit FAIL. Every one of these fixtures is modelled on something that actually
// happened in the 2026-08-19 run.

const DEPLOYED = '307462931905ddcaac1eac303821c4291b7e0257';
const OLD = 'db6d9ccef8a14bc0d1e2f3a4b5c6d7e8f9012345';

const tick = (o: Record<string, unknown> = {}) => ({
  release: DEPLOYED, serviceMode: 'private', controllerState: 'RECORDING',
  dom_transcript_present: true, dom_transcript_len: 0, transcriptLength: 0,
  saveCandidate_present: false, diagLongStringFields: [] as string[],
  nextActionValid: 0, nextActionIntegrityError: 0, nextActionNone: 0, ...o,
});

/** A complete, healthy run: record -> transcript grows -> terminal -> purged -> one valid next action. */
const goodRun = () => ({
  release: DEPLOYED,
  expectedRelease: DEPLOYED,
  samples: [
    tick({ controllerState: 'IDLE', dom_transcript_present: false }),
    tick({ dom_transcript_len: 40, transcriptLength: 40 }),
    tick({ dom_transcript_len: 120, transcriptLength: 120 }),
    tick({ dom_transcript_len: 209, transcriptLength: 209 }),
    tick({ controllerState: 'READY', dom_transcript_len: 0, transcriptLength: 0, nextActionValid: 1 }),
  ],
  persistenceCalls: [{ endpoint: '/rest/v1/rpc/complete_session', status: 200, ok: true }],
  cloudHits: [],
  benchmark: { recognizedLen: 209 },
});

/** Collapse a verdict to the three things every failure fixture asserts, so the assertions stay in the tests. */
const summarize = (result: ReturnType<typeof evaluateProof>, requirement: string) => ({
  pass: result.pass,
  requirementMet: result.met[requirement],
  reasons: result.reasons.join(' | '),
});

describe('#1314 verdict fixture — the control', () => {
  it('a complete healthy run PASSES, so the failures below mean something', () => {
    const r = evaluateProof(goodRun());
    expect(r.reasons).toEqual([]);
    expect(r.pass).toBe(true);
    for (const req of REQUIREMENTS) expect(r.met[req], `${req} should be met`).toBe(true);
  });
});

describe('#1314 verdict fixture — a stale release cannot yield PASS', () => {
  it('rejects a superseded bundle', () => {
    expect(evaluateRelease(OLD, DEPLOYED)).toMatchObject({ ok: false, code: 'STALE_BUNDLE' });
    const s_ = summarize(evaluateProof({ ...goodRun(), release: OLD }), 'exact_release');
    expect(s_.pass).toBe(false);
    expect(s_.requirementMet).toBe(false);
    expect(s_.reasons).toContain('STALE_BUNDLE');
  });

  it('rejects an unreadable release rather than assuming it is current', () => {
    expect(evaluateRelease(null, DEPLOYED).ok).toBe(false);
  });

  it('catches a stale bundle by its DIAGNOSTIC SHAPE even if the release string matched', () => {
    // The pre-cutover build exposed raw transcript STRINGS where the cutover exposes ...Length NUMBERS. This is
    // precisely how the 2026-08-19 run was identified after the fact.
    const raw = ['debug.selectedTranscriptForSave[len=209]', 'debug.saveCandidate.selectedForSave[len=209]'];
    expect(hasDeprecatedRawDiagnosticFields({ diagLongStringFields: raw })).toBe(true);
    const run = goodRun();
    run.samples[2] = tick({ dom_transcript_len: 120, transcriptLength: 120, diagLongStringFields: raw });
    const r = evaluateProof(run);
    expect(r.pass).toBe(false);
    expect(r.reasons.join(' | ')).toContain('DEPRECATED_RAW_DIAGNOSTIC_FIELDS');
  });
});

describe('#1314 verdict fixture — missing selectors cannot yield PASS', () => {
  it('a transcript element that is never present FAILS instead of reading as an empty transcript', () => {
    // The old harness scraped `transcript-container`, which nothing renders. It always saw "" and said nothing.
    const run = goodRun();
    run.samples = run.samples.map((s) => ({ ...s, dom_transcript_present: false, dom_transcript_len: 0 }));
    const r = evaluateProof(run);
    const s_ = summarize(r, 'live_transcript');
    expect(s_.pass).toBe(false);
    expect(s_.requirementMet).toBe(false);
    expect(s_.reasons).toContain('LIVE_TRANSCRIPT_NOT_OBSERVED');
    expect(r.reasons.join(' | ')).toContain('selector likely wrong');
  });

  it('a present-but-never-growing transcript FAILS the cumulative requirement', () => {
    const run = goodRun();
    run.samples = run.samples.map((s) => ({ ...s, dom_transcript_len: 12 }));
    const s_ = summarize(evaluateProof(run), 'live_transcript');
    expect(s_.pass).toBe(false);
    expect(s_.requirementMet).toBe(false);
    expect(s_.reasons).toContain('never grew');
  });
});

describe('#1314 verdict fixture — a missing terminal state cannot yield PASS', () => {
  it('a run that never leaves RECORDING FAILS', () => {
    const run = goodRun();
    run.samples = run.samples.filter((s) => s.controllerState !== 'READY');
    const s_ = summarize(evaluateProof(run), 'terminal_reached');
    expect(s_.pass).toBe(false);
    expect(s_.requirementMet).toBe(false);
    expect(s_.reasons).toContain('TERMINAL_NOT_REACHED');
  });

  it('a terminal state that still holds transcript or a save candidate FAILS the purge', () => {
    const run = goodRun();
    run.samples[4] = tick({ controllerState: 'READY', transcriptLength: 220, saveCandidate_present: true, nextActionValid: 1 });
    const s_ = summarize(evaluateProof(run), 'working_memory_purged');
    expect(s_.pass).toBe(false);
    expect(s_.requirementMet).toBe(false);
    expect(s_.reasons).toContain('WORKING_MEMORY_NOT_PURGED');
  });

  it('an empty timeline FAILS every requirement rather than passing vacuously', () => {
    const r = evaluateProof({ release: DEPLOYED, expectedRelease: DEPLOYED, samples: [] });
    expect(r.pass).toBe(false);
    for (const req of REQUIREMENTS.filter((x: string) => x !== 'exact_release')) expect(r.met[req]).toBe(false);
  });
});

describe('#1314 verdict fixture — missing recognition cannot yield PASS', () => {
  it('no recognized text means no WER, which means no qualification', () => {
    const s_ = summarize(evaluateProof({ ...goodRun(), benchmark: { recognizedLen: 0 } }), 'recognition_captured');
    expect(s_.pass).toBe(false);
    expect(s_.requirementMet).toBe(false);
    expect(s_.reasons).toContain('NO_RECOGNIZED_TEXT');
  });
});

describe('#1314 verdict fixture — an integrity-error element cannot yield PASS', () => {
  it('an integrity error is a rendered FAILURE, never a next action', () => {
    const run = goodRun();
    run.samples[4] = tick({ controllerState: 'READY', nextActionValid: 0, nextActionIntegrityError: 1 });
    const s_ = summarize(evaluateProof(run), 'one_valid_next_action');
    expect(s_.pass).toBe(false);
    expect(s_.requirementMet).toBe(false);
    expect(s_.reasons).toContain('NEXT_ACTION_INTEGRITY_ERROR');
  });

  it('an integrity error alongside a valid next action still FAILS', () => {
    // Guards the old `[data-testid^="session-next-action"]` conflation, where a count of 1 hid which one it was.
    const run = goodRun();
    run.samples[4] = tick({ controllerState: 'READY', nextActionValid: 1, nextActionIntegrityError: 1 });
    const s_ = summarize(evaluateProof(run), 'one_valid_next_action');
    expect(s_.pass).toBe(false);
    expect(s_.requirementMet).toBe(false);
    expect(s_.reasons).toContain('NEXT_ACTION_INTEGRITY_ERROR');
  });
});

describe('#1314 verdict fixture — save boundary and cloud', () => {
  it('a failed PATCH/RPC FAILS and reports the sanitized PG code', () => {
    const r = evaluateProof({
      ...goodRun(),
      persistenceCalls: [{ endpoint: '/rest/v1/sessions', status: 400, ok: false, error: { code: '23514' } }],
    });
    const s_ = summarize(r, 'metrics_persisted');
    expect(s_.pass).toBe(false);
    expect(s_.requirementMet).toBe(false);
    expect(s_.reasons).toContain('PERSISTENCE_FAILED');
    expect(r.reasons.join(' | ')).toContain('23514');
  });

  it('capturing NO save call at all FAILS — silence is not success', () => {
    const s_ = summarize(evaluateProof({ ...goodRun(), persistenceCalls: [] }), 'metrics_persisted');
    expect(s_.pass).toBe(false);
    expect(s_.requirementMet).toBe(false);
    expect(s_.reasons).toContain('NO_PERSISTENCE_CALLS');
  });

  it('any provider transcription request FAILS the zero-cloud requirement', () => {
    const s_ = summarize(evaluateProof({ ...goodRun(), cloudHits: [{ host: 'api.assemblyai.com' }] }), 'zero_cloud');
    expect(s_.pass).toBe(false);
    expect(s_.requirementMet).toBe(false);
    expect(s_.reasons).toContain('CLOUD_REQUESTS');
  });

  it('diagnostics carrying text at ANY phase FAILS, not only after READY', () => {
    const run = goodRun();
    run.samples[3] = tick({ controllerState: 'STOPPING', dom_transcript_len: 209, diagLongStringFields: ['debug.someBuffer[len=209]'] });
    const s_ = summarize(evaluateProof(run), 'diagnostics_text_free');
    expect(s_.pass).toBe(false);
    expect(s_.requirementMet).toBe(false);
    expect(s_.reasons).toContain('DIAGNOSTICS_CARRIED_TEXT');
  });
});
