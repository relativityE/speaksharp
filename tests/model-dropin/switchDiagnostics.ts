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
