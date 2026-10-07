/**
 * #1258 PR 4 diagnostic — the pure parts of `back-from-progress.diagnostic.live.spec.ts`, unit-tested on their own.
 */
import { APPROVED_ORIGIN, RWT_WRITES_ACK_VALUE } from './rwtJourney';
import { MIC_CONTROL_BY_STATUS, RECORDER_BAR } from '../../helpers/micControls';

/** The controls the session page can render, from the component-tested map (never the retired combined id). */
export const SESSION_CONTROL_IDS: readonly string[] = [...new Set([...Object.values(MIC_CONTROL_BY_STATUS), RECORDER_BAR])];
/** A fresh, nothing-recorded session page offers one of these. */
const START_CONTROLS: ReadonlySet<string> = new Set([MIC_CONTROL_BY_STATUS.ready, MIC_CONTROL_BY_STATUS['download-required']]);

/** The release binding of RWT suites is deliberately absent here (a branch dispatch is not the deployed SHA). */
export function backDiagnosticPreconditionFailures(env: NodeJS.ProcessEnv = process.env): string[] {
    const failures: string[] = [];
    let origin = '';
    try { origin = new URL(env.BASE_URL ?? '').origin; } catch { origin = ''; }
    if (origin !== APPROVED_ORIGIN) failures.push(`ORIGIN GATE: BASE_URL origin must be exactly ${APPROVED_ORIGIN}`);
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) failures.push('CAPABILITY GATE: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are required for UID-scoped cleanup');
    if (env.RWT_WRITES_ACK !== RWT_WRITES_ACK_VALUE) failures.push('AUTHORIZATION GATE: RWT_WRITES_ACK is not the exact acknowledgement; no Production write is attempted');
    return failures;
}

/** Content-free classification of what the session page shows. */
export type SessionView = {
    path: string;
    verdict: boolean;
    thisRun: boolean;
    transcript: boolean;
    /** The visible session control's test id (`mic-start`, `mic-download`, `mic-retry`, `recorder-bar`), or null. */
    control: string | null;
    runtimeState: string | null;
    persisted: string | null;
    persistedId: string | null;
};
export function classifySessionView(view: SessionView, savedId: string): 'completed_session_shown' | 'blank_start' | 'other' {
    const completed = (view.verdict || view.thisRun) && (view.persistedId === savedId || view.path.includes(savedId));
    if (completed) return 'completed_session_shown';
    if (!view.verdict && !view.thisRun && view.control !== null && START_CONTROLS.has(view.control)) return 'blank_start';
    return 'other';
}
