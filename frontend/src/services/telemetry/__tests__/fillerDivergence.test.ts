import { describe, it, expect } from 'vitest';
import {
  measureFillerDivergence,
  summarizeFillerDivergence,
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
    transcript: 'um so the update is ready',
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

    // Private finalize replacement: clean re-decode has 1 filler; live over-counted 4. The clarity/score
    // impact is MATERIAL (not cosmetic): clarity +50, score +1.3 when moving to the recount.
    expect(reports[0].recountFillerCount).toBe(1);
    expect(reports[0].liveFillerCount).toBe(4);
    expect(reports[0].delta).toBe(-3);
    expect(reports[0].match).toBe(false);
    expect(reports[0].clarityLive).toBe(18);
    expect(reports[0].clarityRecount).toBe(68);
    expect(reports[0].clarityDelta).toBe(50);
    expect(reports[0].scoreDelta).toBe(1.3);

    // Cloud partial overlap: recount 'so' + 'basically' = 2; live double-counted 4. clarity +35, score +0.7.
    expect(reports[1].recountFillerCount).toBe(2);
    expect(reports[1].delta).toBe(-2);
    expect(reports[1].match).toBe(false);
    expect(reports[1].clarityDelta).toBe(35);
    expect(reports[1].scoreDelta).toBe(0.7);

    // Match: um + so = 2, live agrees → zero downstream impact.
    expect(reports[2].recountFillerCount).toBe(2);
    expect(reports[2].delta).toBe(0);
    expect(reports[2].match).toBe(true);
    expect(reports[2].clarityDelta).toBe(0);
    expect(reports[2].scoreDelta).toBe(0);

    // Custom-word drift: recount (with userWords) catches "actually" + "honestly"×2 = 3; live saw 1.
    // Recount here scores LOWER (more fillers found): clarity −37, score −0.8.
    expect(reports[3].recountFillerCount).toBe(3);
    expect(reports[3].delta).toBe(2);
    expect(reports[3].usedCustomWords).toBe(true);
    expect(reports[3].clarityDelta).toBe(-37);
    expect(reports[3].scoreDelta).toBe(-0.8);
    // Without userWords the recount would miss the custom filler → proves custom-word coverage matters.
    expect(measureFillerDivergence({ ...FIXTURES[3], userWords: [] }).recountFillerCount).toBe(1);

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
    expect(summary.avgDelta).toBe(-0.75);   // (-3 -2 +0 +2)/4
    expect(summary.avgAbsDelta).toBe(1.75); // (3 +2 +0 +2)/4
    expect(summary.maxAbsDelta).toBe(3);
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
});
