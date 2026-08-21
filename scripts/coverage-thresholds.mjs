/**
 * #1262 — the SINGLE coverage-threshold authority.
 *
 * Both consumers import from here so the numbers can never drift apart:
 *   - frontend/vitest.config.mjs (local, non-shard runs) via {@link toVitestThresholds};
 *   - scripts/merge-coverage.mjs (CI, sharded runs — the sole gate there, because vitest thresholds
 *     are disabled under CI_SHARD_MODE) via {@link COVERAGE_THRESHOLDS} directly.
 *
 * Keep the shape stable: `global` holds the four repo-wide floors; `files` maps a repo-relative path
 * (matched as a substring of the coverage-summary key) to its own four floors.
 */

/** @typedef {{ statements: number, branches: number, functions: number, lines: number }} ThresholdSet */

/** The four coverage metrics enforced everywhere, in a fixed order. */
export const COVERAGE_METRICS = /** @type {const} */ (['statements', 'branches', 'functions', 'lines']);

/**
 * @type {{ global: ThresholdSet, files: Record<string, ThresholdSet> }}
 *
 * Floor raised 60 -> 75 to lock in current actual coverage so regressions are caught. Branches held at
 * 75 (not 80) for headroom. Per-file floors carry the historically-agreed values for the STT surfaces.
 */
export const COVERAGE_THRESHOLDS = {
  global: {
    statements: 75,
    branches: 75,
    functions: 75,
    lines: 75,
  },
  files: {
    'frontend/src/services/transcription/ModelManager.ts': { statements: 75, branches: 75, functions: 70, lines: 75 },
    'frontend/src/services/transcription/engines/transformers-js.worker.ts': { statements: 80, branches: 60, functions: 75, lines: 80 },
    'frontend/src/services/transcription/utils/AudioProcessor.ts': { statements: 65, branches: 85, functions: 75, lines: 65 },
    'frontend/src/services/transcription/utils/audio-processor.worker.ts': { statements: 60, branches: 80, functions: 75, lines: 60 },
    'frontend/src/utils/sessionAnalysis.ts': { statements: 80, branches: 65, functions: 70, lines: 80 },
    'frontend/src/utils/fillerWordUtils.ts': { statements: 75, branches: 90, functions: 65, lines: 75 },
  },
};

/**
 * Flatten the shared authority into Vitest's `coverage.thresholds` shape: the four global floors at the
 * top level, plus one per-file entry keyed by path. Produced from the SAME object the merge validator
 * uses, so the local gate and the CI gate can never disagree.
 *
 * @returns {Record<string, number | ThresholdSet>}
 */
export function toVitestThresholds() {
  return {
    ...COVERAGE_THRESHOLDS.global,
    ...COVERAGE_THRESHOLDS.files,
  };
}
