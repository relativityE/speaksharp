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

/** One table cell: no pipes, line breaks or HTML; bounded. An empty phrase reads as an explicit absence. */
export function summaryCell(value: string | null | undefined): string {
    if (typeof value !== 'string' || value.trim() === '') return '_(none)_';
    const flat = value.replace(/[\r\n]+/g, ' ').replace(/\|/g, '\\|').replace(/</g, '&lt;').replace(/>/g, '&gt;').trim();
    return flat.length > 400 ? `${flat.slice(0, 400)}…` : flat;
}

export type CoachingCapture = {
    fixtureKind: string;
    responses: Array<{ at: number; status: number; latencyMs: number | null }>;
    shownWell: string; shownNext: string; savedWell: string; savedNext: string;
};

const same = (a: string, b: string) => a !== '' && a.replace(/\s+/g, ' ').trim() === b.replace(/\s+/g, ' ').trim();
export const shownMatchesSaved = (c: CoachingCapture): boolean => same(c.shownWell, c.savedWell) && same(c.shownNext, c.savedNext);

/**
 * PO 2026-10-07 ("capture ai suggestions gemini response") + the PO's "public run summary" choice: the AI suggestions a
 * SYNTHETIC take produced, as Markdown for $GITHUB_STEP_SUMMARY. A human-voice (or unknown) fixture renders nothing — its
 * coaching paraphrases a real person's speech. The text never goes to the job-log diagnostic record.
 */
export function coachingSummaryMarkdown(c: CoachingCapture): string {
    if (c.fixtureKind !== 'synthetic') return '';
    const responses = c.responses.length === 0 ? '_(no coaching response)_'
        : c.responses.map((r) => `HTTP ${r.status}${r.latencyMs === null ? '' : ` in ${Math.round(r.latencyMs)} ms`}`).join('; ');
    return [
        '## AI suggestions from this run (synthetic-voice take)', '',
        `Coaching responses: ${responses}`, '',
        '| | What went well | What to try next |', '|---|---|---|',
        `| Shown on the page | ${summaryCell(c.shownWell)} | ${summaryCell(c.shownNext)} |`,
        `| Saved on the session | ${summaryCell(c.savedWell)} | ${summaryCell(c.savedNext)} |`, '',
        `Shown matches saved: **${shownMatchesSaved(c) ? 'yes' : 'no'}**`, '',
    ].join('\n');
}

// ── Diagnostic-record encoding ──────────────────────────────────────────────────────────────────────────────────────
// `DiagnosticRecord` keeps only lower-case snake keys with number / boolean / null / closed-character string values, and
// silently DROPS everything else (run 37705211104 lost its whole Back result that way). Everything this diagnostic
// records goes through these encoders, and a unit test proves their output survives `sanitizeDiagnostic` unchanged.
export type DiagScalar = string | number | boolean | null;

/** A value the sanitizer keeps: characters outside its closed set become '_' (never "(redacted)"), at most 300 chars. */
export const safeValue = (value: string): string => value.replace(/[^A-Za-z0-9_.:%=;,()$ +-]/g, '_').slice(0, 300);

/** camelCase / kebab / anything → a lower-case snake key the sanitizer accepts. */
export function snakeKey(raw: string): string {
    const key = raw.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/^[^a-z]+/, '');
    return (key || 'key').slice(0, 64);
}

/** One level of a record as `prefix_key` scalars; nested values are counted, not dropped silently. */
export function flatScalars(prefix: string, record: Record<string, unknown> | null | undefined): Record<string, DiagScalar> {
    if (!record) return { [snakeKey(`${prefix}_present`)]: false };
    const out: Record<string, DiagScalar> = { [snakeKey(`${prefix}_present`)]: true };
    let nested = 0;
    for (const [k, v] of Object.entries(record)) {
        const key = snakeKey(`${prefix}_${snakeKey(k)}`);
        if (v === null || typeof v === 'boolean') out[key] = v;
        else if (typeof v === 'number') out[key] = Number.isFinite(v) ? v : null;
        else if (typeof v === 'string') out[key] = safeValue(v);
        else nested += 1;
    }
    out[snakeKey(`${prefix}_nested_fields`)] = nested;
    return out;
}

/** A session view as `prefix_*` scalars, its classification included. The persisted id is reported only as a match. */
export function sessionViewFields(prefix: string, view: SessionView, savedId: string): Record<string, DiagScalar> {
    const p = snakeKey(prefix);
    return {
        [`${p}_class`]: classifySessionView(view, savedId),
        [`${p}_path`]: safeValue(view.path),
        [`${p}_verdict`]: view.verdict,
        [`${p}_this_run`]: view.thisRun,
        [`${p}_transcript`]: view.transcript,
        [`${p}_control`]: safeValue(view.control ?? 'none'),
        [`${p}_runtime`]: safeValue(view.runtimeState ?? 'none'),
        [`${p}_persisted`]: safeValue(view.persisted ?? 'none'),
        [`${p}_id_match`]: savedId !== '' && view.persistedId === savedId,
    };
}

const TIMELINE_KEY: Readonly<Record<string, string>> = {
    'data-runtime-state': 'rt', 'data-session-persisted': 'ps', 'data-session-save-status': 'ss', 'data-session-persisted-id': 'id',
    'data-engine-ready': 'er', 'data-stt-ready': 'sr', path: 'path', document_load: 'load',
};

/** The timeline as `t:k=v` items in ≤300-char `timeline_N` chunks. The persisted id is reported as saved / other / null. */
export function timelineFields(events: ReadonlyArray<{ t: number; k: string; v: string | null }>, savedId: string): Record<string, DiagScalar> {
    const items = events.map((e) => {
        const value = e.v === null ? 'null'
            : e.k === 'data-session-persisted-id' ? (savedId !== '' && e.v === savedId ? 'saved' : 'other') : e.v;
        return safeValue(`${Math.round(e.t)}:${TIMELINE_KEY[e.k] ?? 'x'}=${value}`).slice(0, 120);
    });
    const out: Record<string, DiagScalar> = { timeline_events: items.length };
    let chunk = '';
    let n = 0;
    for (const item of items) {
        if (chunk && chunk.length + 1 + item.length > 300) { out[`timeline_${++n}`] = chunk; chunk = ''; }
        chunk = chunk ? `${chunk};${item}` : item;
        if (n >= 40) break;
    }
    if (chunk && n < 40) out[`timeline_${++n}`] = chunk;
    out.timeline_chunks = n;
    return out;
}

/**
 * PO 2026-10-07 ("captured any way"): the AI suggestions of a SYNTHETIC take as one job-log line, so they are readable
 * without a signed-in session. A human or unknown fixture prints nothing.
 */
export function aiSuggestionsLogLine(c: CoachingCapture): string {
    if (c.fixtureKind !== 'synthetic') return '';
    return `AI_SUGGESTIONS_SYNTHETIC ${JSON.stringify({
        responses: c.responses.map((r) => ({ at_ms: r.at, status: r.status, latency_ms: r.latencyMs === null ? null : Math.round(r.latencyMs) })),
        shown: { what_went_well: c.shownWell, what_to_try_next: c.shownNext },
        saved: { what_went_well: c.savedWell, what_to_try_next: c.savedNext },
        shown_matches_saved: shownMatchesSaved(c),
    })}`;
}
