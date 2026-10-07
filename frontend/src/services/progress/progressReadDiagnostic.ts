/**
 * #1258 F3 — WHY a Progress read failed, as two closed codes and nothing else.
 *
 * Run 37514078995 showed Practice again stuck on a failed Progress read with no way to tell which read failed or how:
 * every database error collapsed into one generic `error`. This names the read (`stage`) and classifies the error
 * (`code`) against an allowlist. The error's message, details and hint are NEVER forwarded — they can carry
 * relationship names, column values or row content — and anything unlisted is `other`.
 */
export const PROGRESS_READ_STAGES = [
    'none', 'current_evaluation', 'reference_evaluations', 'chronology', 'history_session', 'history_prior',
    'recommendation', 'recommendation_readback', 'latest_attempt', 'query',
] as const;
export type ProgressReadStage = typeof PROGRESS_READ_STAGES[number];

/** PostgREST and Postgres codes a Progress read can plausibly meet, plus three classes of our own. */
const LISTED_CODES = ['PGRST116', 'PGRST200', 'PGRST201', 'PGRST204', 'PGRST301', '42501', '42P01', '42703', '57014'] as const;
export const PROGRESS_READ_CODES = ['none', ...LISTED_CODES, 'network', 'empty', 'threw', 'other'] as const;
export type ProgressReadCode = typeof PROGRESS_READ_CODES[number];

export type ProgressReadDiagnostic = { stage: ProgressReadStage; code: ProgressReadCode };

export const NO_PROGRESS_READ_DIAGNOSTIC: ProgressReadDiagnostic = { stage: 'none', code: 'none' };

/** `error` is whatever the client returned; `null`/`undefined` with no data is `empty`. */
export function progressReadDiagnostic(stage: ProgressReadStage, error: unknown): ProgressReadDiagnostic {
    if (!error) return { stage, code: 'empty' };
    const code = typeof (error as { code?: unknown }).code === 'string' ? (error as { code: string }).code : '';
    if ((LISTED_CODES as readonly string[]).includes(code)) return { stage, code: code as ProgressReadCode };
    // postgrest-js reports a transport failure with an empty code and a `TypeError: fetch failed`-style message. The
    // message is only CLASSIFIED here, never kept.
    const message = typeof (error as { message?: unknown }).message === 'string' ? (error as { message: string }).message : '';
    if (code === '' && /fetch|network|load failed/i.test(message)) return { stage, code: 'network' };
    return { stage, code: 'other' };
}
