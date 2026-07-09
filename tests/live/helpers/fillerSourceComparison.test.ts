import { describe, it, expect } from 'vitest';
import {
  buildComparisonRow,
  summarizeComparison,
  detailMatchesExpected,
  KNOWN_SCRIPT_EXPECTED_DETAIL,
  type FillerDivergenceArtifact,
  type ComparisonRow,
} from './fillerSourceComparison';

// Minimal numbers-only artifact factory (mirrors the sanitized fillerDivergence shape).
const artifact = (over: Partial<FillerDivergenceArtifact> = {}): FillerDivergenceArtifact => ({
  engine: 'private',
  selectedSource: 'service_result',
  liveFillerCount: 0,
  recountFillerCount: 0,
  delta: 0,
  clarityLive: 0, clarityRecount: 0, clarityDelta: 0,
  scoreLive: 0, scoreRecount: 0, scoreDelta: 0,
  usedCustomWords: false,
  liveDetail: {},
  recountDetail: {},
  ...over,
});

describe('fillerSourceComparison — buildComparisonRow (numbers only, no pre-decided winner)', () => {
  it('recount closest to ground truth, live over-counts → hint recount-candidate', () => {
    // GT 9; live over-tallied 12 from garbled partials; clean recount = 9 (the Script 1 distribution).
    const row = buildComparisonRow({
      groundTruth: 9,
      script: '1',
      artifact: artifact({
        liveFillerCount: 12, recountFillerCount: 9,
        liveDetail: { um: 5, so: 3, like: 2, uh: 1, basically: 1 },  // Σ = 12
        recountDetail: { um: 3, so: 2, like: 2, uh: 1, basically: 1 }, // Σ = 9 (matches expected)
      }),
    });
    expect(row.liveDelta).toBe(3);
    expect(row.recountDelta).toBe(0);
    expect(row.closerSource).toBe('recount');
    expect(row.liveOverReports).toBe(true);
    expect(row.recountUnderReports).toBe(false);
    expect(row.liveDetailCoherent).toBe(true);
    expect(row.recountDetailCoherent).toBe(true);
    expect(row.recountDetailMatchesExpected).toBe(true);  // recount reproduces the true distribution
    expect(row.liveDetailMatchesExpected).toBe(false);    // live over-counted um
    expect(row.hint).toBe('recount-candidate');
  });

  it('recount UNDER-reports (Whisper cleaned real fillers) → hint recount-under-reports (disqualifying)', () => {
    const row = buildComparisonRow({
      groundTruth: 9,
      script: '1',
      artifact: artifact({ liveFillerCount: 8, recountFillerCount: 3, liveDetail: { um: 8 }, recountDetail: { um: 3 } }),
    });
    expect(row.recountDelta).toBe(-6);
    expect(row.recountUnderReports).toBe(true);
    expect(row.recountDetailMatchesExpected).toBe(false);
    expect(row.hint).toBe('recount-under-reports'); // dominates regardless of closeness
  });

  it('live closest to ground truth + coherent → hint live-primary (incumbent stays)', () => {
    const row = buildComparisonRow({
      groundTruth: 3,
      script: '2',
      cardRowCountCoherent: true,
      artifact: artifact({ liveFillerCount: 3, recountFillerCount: 5, liveDetail: { custom_1: 3 }, recountDetail: { custom_1: 5 } }),
    });
    expect(row.liveDelta).toBe(0);
    expect(row.recountDelta).toBe(2);
    expect(row.closerSource).toBe('live');
    expect(row.cardRowCountCoherent).toBe(true);
    expect(row.liveDetailMatchesExpected).toBe(true);   // custom_1:3 matches Script 2 expected
    expect(row.recountDetailMatchesExpected).toBe(false); // custom_1:5 ≠ expected 3
    expect(row.hint).toBe('live-primary');
  });

  it('no-filler control (Script 3): both zero, ground truth zero → tie, matches expected empty', () => {
    const row = buildComparisonRow({
      groundTruth: 0, script: '3',
      artifact: artifact({ liveFillerCount: 0, recountFillerCount: 0 }),
    });
    expect(row.closerSource).toBe('tie');
    expect(row.recountUnderReports).toBe(false);
    expect(row.liveDetailMatchesExpected).toBe(true);
    expect(row.recountDetailMatchesExpected).toBe(true);
    expect(row.hint).toBe('inconclusive');
  });

  it('unknown script → expected-match fields are null (cannot validate)', () => {
    const row = buildComparisonRow({
      groundTruth: 5, script: 'unknown',
      artifact: artifact({ liveFillerCount: 5, recountFillerCount: 5, liveDetail: { um: 5 }, recountDetail: { um: 5 } }),
    });
    expect(row.liveDetailMatchesExpected).toBeNull();
    expect(row.recountDetailMatchesExpected).toBeNull();
  });

  it('flags incoherent detail rows (Σ(detail) ≠ count) independently of expected-match', () => {
    const row = buildComparisonRow({
      groundTruth: 9, script: '1',
      artifact: artifact({ liveFillerCount: 12, recountFillerCount: 9, liveDetail: { um: 4 }, recountDetail: { um: 3, so: 2, like: 2, uh: 1, basically: 1 } }),
    });
    expect(row.liveDetailCoherent).toBe(false); // 4 ≠ 12
    expect(row.recountDetailCoherent).toBe(true); // 9 === 9
    expect(row.recountDetailMatchesExpected).toBe(true);
  });

  it('carries no transcript text or raw custom words (numbers/enum only)', () => {
    const row = buildComparisonRow({
      groundTruth: 3, script: '2',
      artifact: artifact({ liveFillerCount: 3, recountFillerCount: 3, liveDetail: { custom_1: 3 }, recountDetail: { custom_1: 3 } }),
    });
    const json = JSON.stringify(row);
    expect(json).not.toContain('honestly');
    expect(json).not.toContain('transcript');
    expect(typeof row.engine).toBe('string');
    expect(['live', 'recount', 'tie']).toContain(row.closerSource);
  });
});

describe('fillerSourceComparison — detailMatchesExpected + known-script table', () => {
  it('Script 1 expected distribution is um:3, so:2, like:2, uh:1, basically:1 (Σ=9)', () => {
    expect(KNOWN_SCRIPT_EXPECTED_DETAIL['1']).toEqual({ um: 3, so: 2, like: 2, uh: 1, basically: 1 });
    expect(Object.values(KNOWN_SCRIPT_EXPECTED_DETAIL['1']).reduce((a, b) => a + b, 0)).toBe(9);
  });
  it('exact match ignores order and zero entries; rejects any count mismatch or extra label', () => {
    const exp = KNOWN_SCRIPT_EXPECTED_DETAIL['1'];
    expect(detailMatchesExpected({ basically: 1, uh: 1, like: 2, so: 2, um: 3, ah: 0 }, exp)).toBe(true);
    expect(detailMatchesExpected({ um: 3, so: 2, like: 2, uh: 1 }, exp)).toBe(false);        // missing basically
    expect(detailMatchesExpected({ um: 4, so: 2, like: 2, uh: 1, basically: 1 }, exp)).toBe(false); // um off by one
    expect(detailMatchesExpected({ um: 3, so: 2, like: 2, uh: 1, basically: 1, oh: 1 }, exp)).toBe(false); // extra label
  });
  it('Script 3 expected is empty', () => {
    expect(detailMatchesExpected({}, KNOWN_SCRIPT_EXPECTED_DETAIL['3'])).toBe(true);
    expect(detailMatchesExpected({ um: 1 }, KNOWN_SCRIPT_EXPECTED_DETAIL['3'])).toBe(false);
  });
});

describe('fillerSourceComparison — summarizeComparison (mode-specific divergence surfaced)', () => {
  it('aggregates closeness + surfaces any under-report + card-row incoherence + detail matches', () => {
    const rows: ComparisonRow[] = [
      buildComparisonRow({ groundTruth: 9, script: '1', cardRowCountCoherent: true,
        artifact: artifact({ liveFillerCount: 12, recountFillerCount: 9, liveDetail: { um: 12 }, recountDetail: { um: 3, so: 2, like: 2, uh: 1, basically: 1 } }) }),
      buildComparisonRow({ groundTruth: 3, script: '2', cardRowCountCoherent: false,
        artifact: artifact({ liveFillerCount: 3, recountFillerCount: 5, liveDetail: { custom_1: 3 }, recountDetail: { custom_1: 5 } }) }),
      buildComparisonRow({ groundTruth: 9, script: '1', cardRowCountCoherent: true,
        artifact: artifact({ liveFillerCount: 8, recountFillerCount: 3, liveDetail: { um: 8 }, recountDetail: { um: 3 } }) }),
    ];
    const s = summarizeComparison(rows);
    expect(s.total).toBe(3);
    expect(s.recountCloserCount).toBe(1);   // row 1
    expect(s.liveCloserCount).toBe(2);       // rows 2 & 3
    expect(s.recountUnderReportsAny).toBe(true); // row 3
    expect(s.cardRowCountIncoherentCount).toBe(1);  // row 2
    expect(s.recountDetailMatchCount).toBe(1); // row 1 recount matches Script 1 expected
    expect(s.liveDetailMatchCount).toBe(1);    // row 2 live custom_1:3 matches Script 2 expected
  });
});
