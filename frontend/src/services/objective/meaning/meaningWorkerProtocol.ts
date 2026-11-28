/** Messages between `MeaningMatcher` (main thread) and `meaning.worker.ts`. Types only. */
import type { MeaningResponsePin } from './meaningAssetPins';

/**
 * `download`   — fetch any pinned file missing from the cache (only after the user's explicit opt-in).
 * `cache-only` — load from the verified cache; a missing file is an error (`MEANING_MODEL_NOT_CACHED`), never a
 *                network request. Used to make a previously downloaded model ready on a later visit.
 */
export type MeaningLoadMode = 'download' | 'cache-only';

export type MeaningWorkerRequest =
    | { id: number; type: 'load'; mode: MeaningLoadMode; modelId: string; pins: MeaningResponsePin[]; scope: string }
    | { id: number; type: 'nli'; premise: string; hypothesis: string }
    | { id: number; type: 'destroy' };

export type MeaningWorkerResponse =
    | { id: number; type: 'progress'; pct: number }
    | { id: number; type: 'loaded'; loadTimeMs: number }
    | { id: number; type: 'nli-result'; entail: number; contradict: number }
    | { id: number; type: 'destroyed' }
    | { id: number; type: 'error'; code: string };

export const MEANING_NOT_CACHED = 'MEANING_MODEL_NOT_CACHED';
