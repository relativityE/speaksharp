import { describe, it, expect } from 'vitest';
import {
  measureFillerDivergence,
  summarizeFillerDivergence,
  cloneFillerCounts,
  sanitizeFillerDetail,
  buildSanitizedFillerArtifact,
  type FillerDivergenceInputs,
  type FillerDivergenceReport,
} from '../fillerDivergence';
import { countFillerWords, type FillerCounts } from '@/utils/fillerWordUtils';

const live = (count: number): FillerCounts => ({ total: { count, color: '' } });

// Deterministic fixtures reproducing each divergence category. `liveFillerData` simulates the live
// useFillerWords tally; the transcript is the committed final that the recount runs over. NO raw text
// leaves the report — only the transcript strings here in the test drive the pure functions.
const FIXTURES: Array<FillerDivergenceInputs & { name: string }> = [
  {
    name: 'private-finalize-replacement',
    // Live counter over-tallied fillers from the garbled streaming preview; the committed re-decode is clean.
    transcript: 'um the quarterly plan is ready for the board',
    elapsedSeconds: 20,
    liveFillerData: live(4),
    engine: 'private',
    category: 'private-finalize-replacement',
  },
  {
    name: 'cloud-partial-overlap',
    // Live counter double-counted fillers across overlapping partial/final segments.
    transcript: 'so the launch is basically ready',
    elapsedSeconds: 15,
    liveFillerData: live(4),
    engine: 'cloud',
    category: 'cloud-partial-overlap',
  },
  {
    name: 'match',
    // #1231: two TRUE fillers (um + uh) so the recount agrees with the live count under true-filler tiering.
    transcript: 'um uh the update is ready',
    elapsedSeconds: 12,
    liveFillerData: live(2),
    engine: 'native',
    category: 'match',
  },
  {
    name: 'custom-word-drift',
    // Live counter tracked only static fillers; the recount (with userWords) also catches "honestly".
    transcript: 'honestly this is honestly the right actually call',
    elapsedSeconds: 18,
    liveFillerData: live(1),
    engine: 'private',
    userWords: ['honestly'],
    category: 'live-counter-drift',
  },
];

describe('Phase 5.8 precursor — filler divergence measurement (numbers only)', () => {
  it('measures live filler vs transcript recount + clarity/score impact per category', () => {
    const reports: FillerDivergenceReport[] = FIXTURES.map((f) => measureFillerDivergence(f));

    // Private finalize replacement: clean re-decode has 1 TRUE filler (um); live over-counted 4. The
    // clarity/score impact is MATERIAL (not cosmetic): clarity +50, score +1.3 when moving to the recount.
    expect(reports[0].recountFillerCount).toBe(1);
    expect(reports[0].liveFillerCount).toBe(4);
    expect(reports[0].delta).toBe(-3);
    expect(reports[0].match).toBe(false);
    expect(reports[0].clarityLive).toBe(18);
    expect(reports[0].clarityRecount).toBe(68);
    expect(reports[0].clarityDelta).toBe(50);
    expect(reports[0].scoreDelta).toBe(1.3);

    // Cloud partial overlap: #1231 — the recount's only "fillers" are discourse markers ('so'/'basically'),
    // which are NOT counted by default, so the true-filler recount is 0; live double-counted 4. The gap is
    // even wider now: clarity +85, score +2.4 (the live over-count was penalising legitimate speech).
    expect(reports[1].recountFillerCount).toBe(0);
    expect(reports[1].delta).toBe(-4);
    expect(reports[1].match).toBe(false);
    expect(reports[1].clarityDelta).toBe(85);
    expect(reports[1].scoreDelta).toBe(2.4);

    // Match: two TRUE fillers (um + uh) = 2, live agrees → zero downstream impact.
    expect(reports[2].recountFillerCount).toBe(2);
    expect(reports[2].delta).toBe(0);
    expect(reports[2].match).toBe(true);
    expect(reports[2].clarityDelta).toBe(0);
    expect(reports[2].scoreDelta).toBe(0);

    // Custom-word drift: #1231 — the recount (with userWords) counts the user's word "honestly"×2 (custom
    // words always count) but NOT "actually" (a default-excluded discourse marker) = 2; live saw 1.
    // Recount scores LOWER (more real fillers found): clarity −18, score −0.4.
    expect(reports[3].recountFillerCount).toBe(2);
    expect(reports[3].delta).toBe(1);
    expect(reports[3].usedCustomWords).toBe(true);
    expect(reports[3].clarityDelta).toBe(-18);
    expect(reports[3].scoreDelta).toBe(-0.4);
    // Without userWords the recount misses the custom filler AND "actually" is discourse → 0 true fillers.
    expect(measureFillerDivergence({ ...FIXTURES[3], userWords: [] }).recountFillerCount).toBe(0);

    // No transcript text in any report (privacy).
    const json = JSON.stringify(reports);
    expect(json).not.toContain('quarterly');
    expect(json).not.toContain('honestly');
  });

  it('summarizes divergence across fixtures (numbers only)', () => {
    const reports = FIXTURES.map((f) => measureFillerDivergence(f));
    const summary = summarizeFillerDivergence(reports);

    expect(summary.total).toBe(4);
    expect(summary.exactMatches).toBe(1);
    expect(summary.divergent).toBe(3);
    expect(summary.avgDelta).toBe(-1.5);   // (-3 -4 +0 +1)/4
    expect(summary.avgAbsDelta).toBe(2);   // (3 +4 +0 +1)/4
    expect(summary.maxAbsDelta).toBe(4);
    expect(summary.byCategory['private-finalize-replacement']).toBe(1);
    expect(summary.byCategory['cloud-partial-overlap']).toBe(1);
    expect(summary.byCategory['live-counter-drift']).toBe(1);
    expect(summary.byCategory['match']).toBe(1);
  });
});

describe('Phase 5.8 precursor — REAL-FINALIZATION basis: recount uses the save-selected finalTranscript', () => {
  it('recounts over the SELECTED finalTranscript, not the live streaming transcript (Private replacement)', () => {
    // The live counter tallied fillers off the garbled STREAMING transcript...
    const liveStreamingTranscript = 'um um the um plan is uh basically uh ready';
    const liveFillerCount = countFillerWords(liveStreamingTranscript).total.count; // what useFillerWords saw live
    expect(liveFillerCount).toBeGreaterThan(0);

    // ...but the SAVE-SELECTED final transcript is the clean whole-utterance re-decode:
    const selectedFinalTranscript = 'the plan is ready for the board';

    const report = measureFillerDivergence({
      transcript: selectedFinalTranscript,                                   // the save/scoring basis
      elapsedSeconds: 20,
      liveFillerData: { total: { count: liveFillerCount, color: '' } },      // live counter (pre-correction)
      engine: 'private',
      selectedSource: 'service_result',
      category: 'private-finalize-replacement',
    });

    // Recount reflects the CLEAN selected final transcript — NOT the live streaming count.
    expect(report.recountFillerCount).toBe(countFillerWords(selectedFinalTranscript).total.count);
    expect(report.recountFillerCount).toBe(0);
    expect(report.liveFillerCount).toBe(liveFillerCount);
    expect(report.liveFillerCount).toBeGreaterThan(report.recountFillerCount);
    expect(report.delta).toBe(report.recountFillerCount - report.liveFillerCount);
    expect(report.selectedSource).toBe('service_result');
    // Had it (wrongly) recounted the streaming transcript, recount would equal live → delta 0. It must not.
    expect(report.delta).not.toBe(0);
  });

  it('cloneFillerCounts deep-copies so a later in-place store mutation cannot drift the snapshot', () => {
    const original: FillerCounts = { total: { count: 3, color: '' }, um: { count: 3, color: '' } };
    const snapshot = cloneFillerCounts(original)!;
    // Simulate the store mutating fillerData in place AFTER the stop-entry capture.
    original.total.count = 99;
    original.um.count = 99;
    expect(snapshot.total.count).toBe(3);
    expect(snapshot.um.count).toBe(3);
    expect(cloneFillerCounts(null)).toBeNull();
  });
});

describe('Phase 5.8 Step 1 — sanitized filler artifact (numbers-only, custom words anonymized)', () => {
  it('sanitizeFillerDetail: static labels pass through; total + zero-count dropped', () => {
    const data = { total: { count: 5, color: '' }, um: { count: 3, color: '' }, so: { count: 2, color: '' }, uh: { count: 0, color: '' } } as unknown as FillerCounts;
    expect(sanitizeFillerDetail(data)).toEqual({ um: 3, so: 2 });
  });

  it('sanitizeFillerDetail: RAW custom words are anonymized to custom_N — no user text leaks', () => {
    const data = { total: { count: 2, color: '' }, honestly: { count: 2, color: '' } } as unknown as FillerCounts;
    const out = sanitizeFillerDetail(data, ['honestly']);
    expect(out).toEqual({ custom_1: 2 });
    expect(JSON.stringify(out)).not.toContain('honestly');
  });

  it('sanitizeFillerDetail: null → {}', () => {
    expect(sanitizeFillerDetail(null)).toEqual({});
  });

  it('buildSanitizedFillerArtifact: numbers-only — no transcript text, no raw custom word', () => {
    const transcript = 'honestly the plan is honestly ready um so';
    const report = measureFillerDivergence({
      transcript, elapsedSeconds: 20,
      liveFillerData: { total: { count: 9, color: '' } } as unknown as FillerCounts,
      engine: 'private', userWords: ['honestly'], selectedSource: 'service_result',
    });
    const artifact = buildSanitizedFillerArtifact({
      report,
      liveFillerData: { total: { count: 9, color: '' }, honestly: { count: 9, color: '' } } as unknown as FillerCounts,
      recountFillerData: countFillerWords(transcript, ['honestly']),
      userWords: ['honestly'],
    });

    const json = JSON.stringify(artifact);
    expect(json).not.toContain('honestly');   // no raw custom word
    expect(json).not.toContain('the plan');    // no transcript text
    expect(json).not.toContain('ready');
    expect(artifact.selectedSource).toBe('service_result');
    expect(artifact.recountDetail.custom_1).toBe(2); // "honestly" ×2, anonymized
    expect(artifact.liveDetail.custom_1).toBe(9);
    // every detail value is a number
    for (const v of [...Object.values(artifact.liveDetail), ...Object.values(artifact.recountDetail)]) {
      expect(typeof v).toBe('number');
    }
  });
});
