import { READINESS_REQUIRED_GLOBAL } from '@/e2e/signalContract';

/**
 * @deprecated The canonical readiness contract lives in
 * frontend/src/e2e/signalContract.ts. This compatibility export remains so any
 * older imports do not silently drift back to the obsolete boot/layout/auth set.
 *
 * Why keep a deprecated file?
 * - It prevents older imports from breaking abruptly.
 * - It forwards those imports to the canonical contract values.
 * - It makes the old path noisy/documented instead of letting it become a
 *   second source of truth again.
 *
 * Do not add new imports from this file. Import from
 * frontend/src/e2e/signalContract.ts instead.
 */
export const CORE_READINESS_SIGNALS = READINESS_REQUIRED_GLOBAL;

export type CoreReadinessSignal = typeof CORE_READINESS_SIGNALS[number];
