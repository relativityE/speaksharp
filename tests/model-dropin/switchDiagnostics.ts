/** The comparison receipt keeps only allowlisted switch facts. A failure `reason` is free text (an Error message) that can
 * carry URLs, paths or transcript text, so it is never copied; an unrecognised code is recorded as such, never verbatim. */
import type { SwitchFailureCode, SwitchOutcome } from '../../frontend/src/services/transcription/runtimeCandidateSwitch';

const FAILURE_CODES = ['not_armed', 'unknown_candidate', 'not_comparison_candidate', 'engine_not_integrated',
    'candidate_not_comparison_ready', 'busy', 'switch_in_progress', 'no_executor', 'teardown_failed', 'init_failed',
    'identity_mismatch'] as const satisfies readonly SwitchFailureCode[];
// Fails to compile when SwitchFailureCode gains a code this allowlist does not name.
type Unlisted = Exclude<SwitchFailureCode, typeof FAILURE_CODES[number]>;
const allCodesListed: [Unlisted] extends [never] ? true : never = true;
void allCodesListed;

export type SwitchDiagnostic =
    | { ok: true; candidateMatchesRequest: boolean }
    | { ok: false; code: SwitchFailureCode | 'unrecognized_code' };

export function sanitizeSwitchOutcome(outcome: unknown, requested: string): SwitchDiagnostic {
    const o = outcome as Partial<SwitchOutcome> | null;
    if (o && o.ok === true) return { ok: true, candidateMatchesRequest: 'candidate' in o && o.candidate === requested };
    const code = o && o.ok === false && 'code' in o ? o.code : undefined;
    return { ok: false, code: (FAILURE_CODES as readonly unknown[]).includes(code) ? code as SwitchFailureCode : 'unrecognized_code' };
}

/** A failed switch reports only `identity_mismatch` today; the engine's real cause (budget timeout, missing WebGPU,
 * pin violation, worker error) is dropped. This content-free projection of page state is recorded with the failure so
 * the next failure is diagnosable. Every field is a closed token, a boolean or a bounded number; nothing is copied
 * verbatim, so no URL, path, message or transcript text can enter the receipt. */
const ACQUISITION_ERROR_CODES = ['network', 'integrity', 'unsupported', 'aborted', 'storage', 'timeout', 'unknown'] as const;
const CACHE_RESULTS = ['hit', 'miss', 'partial', 'unobserved'] as const;
export type SelectionFailureState = {
    runtimeState: string; modelStatus: string; crossOriginIsolated: boolean | null; webgpuPresent: boolean | null;
    acquisitionFailures: Array<{ errorCode: typeof ACQUISITION_ERROR_CODES[number] | 'unrecognized'; cache: typeof CACHE_RESULTS[number] | null;
        totalMs: number | null }>;
};
export function sanitizeSelectionFailure(raw: unknown): SelectionFailureState {
    const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const token = (v: unknown, pattern: RegExp) => typeof v === 'string' && pattern.test(v) ? v : (v == null ? 'absent' : 'other');
    const bool = (v: unknown) => typeof v === 'boolean' ? v : null;
    const rows = Array.isArray(r.acquisitionFailures) ? r.acquisitionFailures.slice(0, 8) : [];
    return {
        runtimeState: token(r.runtimeState, /^[A-Z_]{1,32}$/),
        modelStatus: token(r.modelStatus, /^[a-z-]{1,32}$/),
        crossOriginIsolated: bool(r.crossOriginIsolated),
        webgpuPresent: bool(r.webgpuPresent),
        acquisitionFailures: rows.map(row => {
            const x = (row && typeof row === 'object' ? row : {}) as Record<string, unknown>;
            const code = (ACQUISITION_ERROR_CODES as readonly unknown[]).includes(x.errorCode) ? x.errorCode as typeof ACQUISITION_ERROR_CODES[number] : 'unrecognized';
            const cache = (CACHE_RESULTS as readonly unknown[]).includes(x.cache) ? x.cache as typeof CACHE_RESULTS[number] : null;
            const totalMs = typeof x.totalMs === 'number' && Number.isFinite(x.totalMs) && x.totalMs >= 0 ? Math.round(x.totalMs) : null;
            return { errorCode: code, cache, totalMs };
        }),
    };
}
