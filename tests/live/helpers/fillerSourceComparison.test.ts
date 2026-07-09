import { describe, it, expect } from 'vitest';
import {
  buildComparisonRow,
  summarizeComparison,
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
    // GT 9; live over-tallied 12 from garbled partials; clean recount = 9.
    const row = buildComparisonRow({
      groundTruth: 9,
      script: '1',
      artifact: artifact({
        liveFillerCount: 12, recountFillerCount: 9,
        liveDetail: { um: 7, so: 3, like: 2 },       // Σ = 12
        recountDetail: { um: 5, so: 2, like: 2 },     // Σ = 9
      }),
    });
    expect(row.liveDelta).toBe(3);
    expect(row.recountDelta).toBe(0);
    expect(row.closerSource).toBe('recount');
    expect(row.liveOverReports).toBe(true);
    expect(row.recountUnderReports).toBe(false);
    expect(row.liveDetailCoherent).toBe(true);
    expect(row.recountDetailCoherent).toBe(true);
    expect(row.hint).toBe('recount-candidate');
  });

  it('recount UNDER-reports (Whisper cleaned real fillers) → hint recount-under-reports (disqualifying)', () => {
    // GT 9; live saw 8; recount only found 3 because the committed re-decode dropped real disfluency.
    const row = buildComparisonRow({
      groundTruth: 9,
      script: '1',
      artifact: artifact({ liveFillerCount: 8, recountFillerCount: 3, liveDetail: { um: 8 }, recountDetail: { um: 3 } }),
    });
    expect(row.recountDelta).toBe(-6);
    expect(row.recountUnderReports).toBe(true);
    // even though recount is numerically closer here (|−6| vs live |−1|? no: live is closer), the
    // under-report flag dominates the hint regardless of closeness.
    expect(row.hint).toBe('recount-under-reports');
  });

  it('live closest to ground truth + coherent → hint live-primary (incumbent stays)', () => {
    const row = buildComparisonRow({
      groundTruth: 3,
      script: '2',
      colorTableCoherent: true,
      artifact: artifact({ liveFillerCount: 3, recountFillerCount: 5, liveDetail: { custom_1: 3 }, recountDetail: { custom_1: 5 } }),
    });
    expect(row.liveDelta).toBe(0);
    expect(row.recountDelta).toBe(2);
    expect(row.closerSource).toBe('live');
    expect(row.colorTableCoherent).toBe(true);
    expect(row.hint).toBe('live-primary');
  });

  it('no-filler control: both zero, ground truth zero → tie, live-primary-ish inconclusive', () => {
    const row = buildComparisonRow({
      groundTruth: 0, script: '3',
      artifact: artifact({ liveFillerCount: 0, recountFillerCount: 0 }),
    });
    expect(row.closerSource).toBe('tie');
    expect(row.recountUnderReports).toBe(false);
    expect(row.hint).toBe('inconclusive');
  });

  it('flags incoherent detail rows (Σ(detail) ≠ count)', () => {
    const row = buildComparisonRow({
      groundTruth: 9, script: '1',
      artifact: artifact({ liveFillerCount: 12, recountFillerCount: 9, liveDetail: { um: 4 }, recountDetail: { um: 9 } }),
    });
    expect(row.liveDetailCoherent).toBe(false); // 4 ≠ 12
    expect(row.recountDetailCoherent).toBe(true); // 9 === 9
  });

  it('carries no transcript text or raw custom words (numbers/enum only)', () => {
    const row = buildComparisonRow({
      groundTruth: 3, script: '2',
      artifact: artifact({ liveFillerCount: 3, recountFillerCount: 3, liveDetail: { custom_1: 3 }, recountDetail: { custom_1: 3 } }),
    });
    const json = JSON.stringify(row);
    expect(json).not.toContain('honestly');
    expect(json).not.toContain('transcript');
    // only enum-ish string fields
    expect(typeof row.engine).toBe('string');
    expect(['live', 'recount', 'tie']).toContain(row.closerSource);
  });
});

describe('fillerSourceComparison — summarizeComparison (mode-specific divergence surfaced)', () => {
  it('aggregates closeness + surfaces any under-report + color incoherence', () => {
    const rows: ComparisonRow[] = [
      buildComparisonRow({ groundTruth: 9, script: '1', colorTableCoherent: true,
        artifact: artifact({ liveFillerCount: 12, recountFillerCount: 9, liveDetail: { um: 12 }, recountDetail: { um: 9 } }) }),
      buildComparisonRow({ groundTruth: 3, script: '2', colorTableCoherent: false,
        artifact: artifact({ liveFillerCount: 3, recountFillerCount: 5, liveDetail: { custom_1: 3 }, recountDetail: { custom_1: 5 } }) }),
      buildComparisonRow({ groundTruth: 9, script: '1', colorTableCoherent: true,
        artifact: artifact({ liveFillerCount: 8, recountFillerCount: 3, liveDetail: { um: 8 }, recountDetail: { um: 3 } }) }),
    ];
    const s = summarizeComparison(rows);
    expect(s.total).toBe(3);
    expect(s.recountCloserCount).toBe(1);   // row 1
    expect(s.liveCloserCount).toBe(2);       // rows 2 & 3
    expect(s.recountUnderReportsAny).toBe(true); // row 3
    expect(s.colorIncoherentCount).toBe(1);  // row 2
  });
});
