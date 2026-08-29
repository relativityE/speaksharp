/**
 * #1304 Task 3C — WHAT A RESULT SET CAN BE USED FOR.
 *
 * `selectionEligible` used to mean only "the browser backend was proven". That is a fact about the
 * RUNTIME, and it was being read as a fact about the EVIDENCE — so ten arms measured on Harvard-10
 * were all marked eligible to pick a primary and a fallback from.
 *
 * Harvard-10 cannot do that. Eighty-five reference words means WER quantizes to steps of 1/85, and in
 * the browser run eight of eleven arms landed on exactly 0.0235 — two errors — while three landed on
 * 0.0000. A set that cannot separate the candidates cannot rank them, however well its backend was
 * proven.
 *
 * So eligibility now requires BOTH: proven backend AND a set classified as selection-grade.
 */
export type EvidenceClass = 'smoke' | 'preflight' | 'selection';

export interface EvidenceSet {
    id: string;
    evidenceClass: EvidenceClass;
    /** Why this set is or is not selection-grade. Stated, so a reader need not infer it. */
    rationale: string;
    /** Normalized reference words the set is expected to contain, if known ahead of the run. */
    approximateReferenceWords: number | null;
}

export const EVIDENCE_SETS: Record<string, EvidenceSet> = {
    harvard: {
        id: 'harvard',
        evidenceClass: 'smoke',
        rationale:
            'Ten short clips, ~85 normalized reference words. WER quantizes to 1/85 steps, and most arms '
            + 'separate by a single word — it proves the pipeline runs, and cannot rank models.',
        approximateReferenceWords: 85,
    },
    preflight: {
        id: 'preflight',
        evidenceClass: 'preflight',
        rationale:
            'Unseen clips drawn from the frozen corpus: 23 clips, 459 normalized reference words — 5.4x '
            + 'Harvard, split 12/11 across test-clean and test-other. Strong enough to catch a harness or '
            + 'model-loading defect before the full run; NOT the selection benchmark, which remains the '
            + 'frozen 600. Called the 459-WORD preflight, not the 425-word one: 425 was the planning '
            + 'target and 459 is what the deterministic selection actually produced. Artifacts carry the '
            + 'measured number, because a rounded label invites a reader to assume the set was trimmed to '
            + 'hit it.',
        approximateReferenceWords: 459,
    },
    longform: {
        id: 'longform',
        evidenceClass: 'smoke',
        rationale:
            'One 37.87s clip spanning two decode windows. It exists to expose truncation, a lost tail '
            + 'and looping — failures a pooled WER over short clips averages away — not to rank models.',
        approximateReferenceWords: 95,
    },
    corpus: {
        id: 'corpus',
        evidenceClass: 'selection',
        rationale: 'The frozen 600-clip LibriSpeech subset. The only set a primary/fallback may be chosen from.',
        approximateReferenceWords: null,
    },
};

/** A row may inform the down-select only if its set is selection-grade AND its backend was proven. */
export function isSelectionGrade(setId: string): boolean {
    return EVIDENCE_SETS[setId]?.evidenceClass === 'selection';
}
