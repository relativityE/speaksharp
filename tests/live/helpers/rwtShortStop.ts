/**
 * J1.c (Sam, 21 Nov): a short Stop saves nothing. One Start, then Stop well inside the product's minimum take
 * (MIN_SESSION_DURATION_SECONDS, 5 s), on J1.a's account after J1.a's takes. The browser step that drives it is
 * `shortStopEvidence` in the shared runner (rwtJourney.ts); this file holds its in-page probe, its save tap, its row reader
 * and its row. The verdict is NOT re-implemented here: every observation is handed, as is, to the nightly oracle
 * `shortStopVerdict` (tools/cloud-test/nightly/oracles/payment-wall.cjs). An observation this step could not make is
 * passed as null, so the oracle holds it as "not observed" and never guesses it.
 *
 * Content-free: the row carries counts, booleans and one duration. Session ids stay in memory for the oracle only.
 */
import { createRequire } from 'node:module';
import type { BrowserContext, Page, Request } from '@playwright/test';
import { SAVE_WRITE_URL, START_CONTROL } from './rwtHarnessParity';

/** The leg and the new row of the design this step proves (journey-plan.cjs NEW_ROWS). */
export const J1C_LEG = 'J1.c';
export const J1C_ROW = 'short-stop-no-save';
/**
 * The longest Start-click-to-Stop-click interval that still counts as a short Stop. The product judges the take from its own
 * start time, which is set only after the Start click, so this interval is an upper bound on the product's elapsed time; 4 s
 * leaves a full second inside the 5 s minimum for the Stop handler to run.
 */
export const SHORT_STOP_MAX_MS = 4_000;
/** How long the page has after Stop to stop recording, answer its save requests and tell the user. */
export const SHORT_STOP_SETTLE_MS = 30_000;
/** One bounded read of the account's session rows. */
export const SESSION_ROWS_READ_MS = 10_000;
const COACHING_URL = /\/functions\/v1\/get-ai-suggestions(?:\?|$)/;
const RECORDER_STOP_SELECTOR = '[data-testid="recorder-stop"]';
const RECORDER_BAR_SELECTOR = '[data-testid="recorder-bar"]';

export type SessionRow = { id: string; status: string | null };
export type Verdict = 'PASS' | 'FAIL' | 'HOLD';
interface RowSink { row: (step: string, verdict: Verdict, detail: string, evidence?: Record<string, string | number | boolean | null>) => void }

/** What the short-Stop step saw. null = not observed (the oracle holds it). */
export interface ShortStopObservation {
    /** A Start press of this step reached the page (seen by the page's own click recorder). */
    startPressed: boolean | null;
    settled: boolean;
    rowsBefore: SessionRow[] | null;
    rowsAfter: SessionRow[] | null;
    acceptedCompletingSaves: number | null;
    acceptedFailedMarks: number | null;
    /** Accepted saves whose status could not be read: they may have completed the take, so the oracle counts them as completing. */
    acceptedUnreadableSaves: number | null;
    pendingSaves: number | null;
    stopPressedWhileRecording: boolean | null;
    startToStopMs: number | null;
    savedConfirmationShown: boolean | null;
    notSavedShown: boolean | null;
    unsettledDiscardShown: boolean | null;
    coachingRequests: number | null;
    liveTracksAfterStop: number | null;
    /** Why the step ended early, in closed words; never a Playwright message (it can carry ids). */
    reason: string | null;
}

export function emptyShortStopObservation(): ShortStopObservation {
    return {
        startPressed: null, settled: false, rowsBefore: null, rowsAfter: null, acceptedCompletingSaves: null, acceptedFailedMarks: null, acceptedUnreadableSaves: null,
        pendingSaves: null, stopPressedWhileRecording: null, startToStopMs: null, savedConfirmationShown: null, notSavedShown: null,
        unsettledDiscardShown: null, coachingRequests: null, liveTracksAfterStop: null, reason: null,
    };
}

/** The product's two too-short messages (useSessionLifecycle.ts), as the status bar renders them (leading emoji removed). */
export const SETTLED_DISCARD_TEXT = /Session too short \(\d+s\)\. Minimum \d+s required\./;
export const UNSETTLED_DISCARD_TEXT = /Session too short \(\d+s\)\. It wasn't saved, but we couldn't finish clearing it\./;

/** What the in-page probe recorded. Times are the page's own clock (performance.now), so both clicks share one clock. */
export interface ShortStopProbeState {
    startAt: number | null;
    stopAt: number | null;
    stopWhileRecording: boolean | null;
    saved: boolean;
    settledMessage: boolean;
    unsettledMessage: boolean;
}

/**
 * Arm the probe in the CURRENT document, before Start. A capture-phase click listener runs before the product's own handlers,
 * so the Stop click's recording state is read at the click itself. After Stop, every DOM change re-reads the status bar, so a
 * message that is shown and then replaced is still seen.
 */
export async function armShortStopProbe(page: Page): Promise<void> {
    await page.evaluate(({ start, stop, bar, settled, unsettled }) => {
        const settledRe = new RegExp(settled);
        const unsettledRe = new RegExp(unsettled);
        const state = { startAt: null as number | null, stopAt: null as number | null, stopWhileRecording: null as boolean | null,
            saved: false, settledMessage: false, unsettledMessage: false };
        (window as unknown as { __rwtShortStop?: typeof state }).__rwtShortStop = state;
        const scan = () => {
            if (state.stopAt === null) return;
            const header = document.querySelector('[data-testid="live-session-header"]');
            if (header?.getAttribute('data-session-saved') === 'true') state.saved = true;
            const text = document.querySelector('[data-testid="status-message-text"]')?.textContent ?? '';
            if (settledRe.test(text)) state.settledMessage = true;
            if (unsettledRe.test(text)) state.unsettledMessage = true;
        };
        document.addEventListener('click', (e) => {
            const t = e.target as Element | null;
            if (!t || typeof t.closest !== 'function') return;
            if (state.startAt === null && t.closest(start)) state.startAt = performance.now();
            const stopControl = t.closest(stop);
            if (stopControl && state.stopAt === null) {
                state.stopAt = performance.now();
                const runtime = document.documentElement.getAttribute('data-recording-state');
                state.stopWhileRecording = !(stopControl as HTMLButtonElement).disabled && document.querySelector(bar) !== null
                    && (runtime === null || runtime === 'recording');
                scan();
            }
        }, true);
        new MutationObserver(scan).observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true });
    }, { start: START_CONTROL, stop: RECORDER_STOP_SELECTOR, bar: RECORDER_BAR_SELECTOR, settled: SETTLED_DISCARD_TEXT.source, unsettled: UNSETTLED_DISCARD_TEXT.source });
}

export async function readShortStopProbe(page: Page): Promise<ShortStopProbeState | null> {
    const s = await page.evaluate(() => (window as unknown as { __rwtShortStop?: unknown }).__rwtShortStop ?? null).catch(() => null);
    return isProbeState(s) ? { ...s } : null;
}

function isProbeState(s: unknown): s is ShortStopProbeState {
    const o = s as Record<string, unknown> | null;
    const time = (v: unknown) => v === null || (typeof v === 'number' && Number.isFinite(v));
    return !!o && typeof o === 'object' && time(o.startAt) && time(o.stopAt) && (o.stopWhileRecording === null || typeof o.stopWhileRecording === 'boolean')
        && typeof o.saved === 'boolean' && typeof o.settledMessage === 'boolean' && typeof o.unsettledMessage === 'boolean';
}

/**
 * Pure: the Stop facts from the probe. A short Stop needs both clicks on one clock, the Stop pressed while the recorder was
 * recording, and the interval under SHORT_STOP_MAX_MS. An unreadable probe is unknown (null), never true.
 */
export function stopFacts(probe: ShortStopProbeState | null): Pick<ShortStopObservation, 'startPressed' | 'stopPressedWhileRecording' | 'startToStopMs'> {
    if (!probe) return { startPressed: null, stopPressedWhileRecording: null, startToStopMs: null };
    const startPressed = probe.startAt !== null;
    if (probe.startAt === null || probe.stopAt === null) return { startPressed, stopPressedWhileRecording: false, startToStopMs: null };
    const startToStopMs = Math.round(probe.stopAt - probe.startAt);
    return { startPressed, startToStopMs, stopPressedWhileRecording: probe.stopWhileRecording === true && startToStopMs >= 0 && startToStopMs < SHORT_STOP_MAX_MS };
}

/** Pure: what the page told the user, from the probe (null when unreadable). */
export function shownFacts(probe: ShortStopProbeState | null): Pick<ShortStopObservation, 'savedConfirmationShown' | 'notSavedShown' | 'unsettledDiscardShown'> {
    if (!probe) return { savedConfirmationShown: null, notSavedShown: null, unsettledDiscardShown: null };
    return { savedConfirmationShown: probe.saved, notSavedShown: probe.settledMessage, unsettledDiscardShown: probe.unsettledMessage };
}

/**
 * Wait, bounded, for the page to settle after Stop: the recorder gone, no save request pending, and the page has said what
 * happened (saved, not saved, or not cleared). A page that says nothing by the bound, with the recorder gone and nothing
 * pending, has settled without telling the user: settled, and the oracle judges what it did not say. An unreadable probe is
 * never settled. Returns the last probe read and whether the page settled.
 */
export async function awaitShortStopSettled(io: {
    readProbe: () => Promise<ShortStopProbeState | null>;
    recorderGone: () => Promise<boolean>;
    pendingSaves: () => number;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
}, boundMs = SHORT_STOP_SETTLE_MS, pollMs = 250): Promise<{ probe: ShortStopProbeState | null; settled: boolean }> {
    const now = io.now ?? Date.now;
    const sleep = io.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    const deadline = now() + boundMs;
    for (;;) {
        const probe = await io.readProbe();
        const gone = await io.recorderGone().catch(() => false);
        const quiet = io.pendingSaves() === 0;
        const told = !!probe && (probe.saved || probe.settledMessage || probe.unsettledMessage);
        if ((gone && quiet && told) || now() >= deadline) return { probe, settled: probe !== null && gone && quiet };
        await sleep(pollMs);
    }
}

/**
 * The product's one take-saving write (`complete_session_v2`) during the step, by its `p_status`: accepted (a 2xx answer) and
 * still pending. A failed request, a redirect or an error answer is not accepted; a request with no finish is pending.
 * Also counts coaching requests (J1.c's design sends none).
 */
export class ShortStopSaveTap {
    private readonly saves = new Map<Request, { status: string | null; accepted: boolean; finished: boolean }>();
    coachingRequests = 0;
    private context: BrowserContext | null = null;
    private readonly onRequest = (r: Request) => {
        if (r.method() !== 'POST') return;
        if (COACHING_URL.test(r.url())) this.coachingRequests += 1;
        if (!SAVE_WRITE_URL.test(r.url())) return;
        let status: unknown = null;
        try { status = (r.postDataJSON() as { p_status?: unknown } | null)?.p_status; } catch { status = null; }
        this.saves.set(r, { status: typeof status === 'string' ? status : null, accepted: false, finished: false });
    };
    private readonly onFinished = (r: Request) => {
        const s = this.saves.get(r);
        if (!s) return;
        void r.response().then((res) => {
            if (res && res.status() >= 200 && res.status() < 300) s.accepted = true;
            s.finished = true;
        }, () => { s.finished = true; });
    };
    private readonly onFailed = (r: Request) => { const s = this.saves.get(r); if (s) s.finished = true; };

    attach(context: BrowserContext): void {
        this.context = context;
        context.on('request', this.onRequest);
        context.on('requestfinished', this.onFinished);
        context.on('requestfailed', this.onFailed);
    }

    detach(): void {
        if (!this.context) return;
        this.context.off('request', this.onRequest);
        this.context.off('requestfinished', this.onFinished);
        this.context.off('requestfailed', this.onFailed);
        this.context = null;
    }

    get pending(): number { return [...this.saves.values()].filter((s) => !s.finished).length; }
    get acceptedCompletingSaves(): number { return [...this.saves.values()].filter((s) => s.accepted && s.status === 'completed').length; }
    get acceptedFailedMarks(): number { return [...this.saves.values()].filter((s) => s.accepted && s.status === 'failed').length; }
    /** An accepted save whose status could not be read: it might have completed the take, so it counts as completing. */
    get acceptedUnreadable(): number { return [...this.saves.values()].filter((s) => s.accepted && s.status !== 'completed' && s.status !== 'failed').length; }
}

type RowsAdmin = { from: (t: 'sessions') => { select: (c: string) => { eq: (k: string, v: string) => PromiseLike<{ data: unknown; error: unknown }> } } };

/**
 * A bounded reader of the account's session rows (id and status only), for the oracle's before/after comparison. Owner-bound by
 * the account's own id. Any error, timeout or malformed answer is null (not observed), never an empty list.
 */
export function sessionRowsReader(admin: RowsAdmin | null, userId: string, timeoutMs = SESSION_ROWS_READ_MS): () => Promise<SessionRow[] | null> {
    return async () => {
        if (!admin || !userId) return null;
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            const read = Promise.resolve(admin.from('sessions').select('id,status').eq('user_id', userId));
            const timeout = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), timeoutMs); });
            const answer = await Promise.race([read, timeout]);
            if (!answer || answer.error || !Array.isArray(answer.data)) return null;
            const rows = answer.data as unknown[];
            const ok = rows.every((r) => {
                const o = r as Record<string, unknown> | null;
                return !!o && typeof o.id === 'string' && o.id.length > 0 && (o.status === null || typeof o.status === 'string');
            });
            return ok ? (rows as Array<{ id: string; status: string | null }>).map(({ id, status }) => ({ id, status })) : null;
        } catch {
            return null;
        } finally {
            if (timer) clearTimeout(timer);
        }
    };
}

type Oracle = (r: Record<string, unknown>) => { outcome: Verdict; detail: string };
const oracle = (): Oracle => (createRequire(import.meta.url)('../../../tools/cloud-test/nightly/oracles/payment-wall.cjs') as { shortStopVerdict: Oracle }).shortStopVerdict;

/**
 * Pure: the oracle's input, exactly as observed. An accepted save whose status is unreadable counts as completing the take
 * (fail closed). Nulls stay null, so the oracle reports them as not observed.
 */
export function shortStopInput(o: ShortStopObservation): Record<string, unknown> {
    return {
        settled: o.settled,
        rowsBefore: o.rowsBefore,
        rowsAfter: o.rowsAfter,
        acceptedCompletingSaves: o.acceptedCompletingSaves === null || o.acceptedUnreadableSaves === null ? null : o.acceptedCompletingSaves + o.acceptedUnreadableSaves,
        acceptedFailedMarks: o.acceptedFailedMarks,
        stopPressedWhileRecording: o.stopPressedWhileRecording,
        savedConfirmationShown: o.savedConfirmationShown,
        notSavedShown: o.notSavedShown,
        unsettledDiscardShown: o.unsettledDiscardShown,
    };
}

/** J1.c's row: the oracle's verdict on this step's observation, with counts and booleans only. */
export function shortStopRow(receipt: RowSink, o: ShortStopObservation, judge: Oracle = oracle()): Verdict {
    const v = judge(shortStopInput(o));
    const outcome: Verdict = v?.outcome === 'PASS' || v?.outcome === 'FAIL' ? v.outcome : 'HOLD';
    const detail = [typeof v?.detail === 'string' ? v.detail : 'the short-Stop oracle gave no verdict', o.reason].filter(Boolean).join('; ');
    receipt.row(J1C_ROW, outcome, detail, {
        leg: J1C_LEG, settled: o.settled, startPressed: o.startPressed, stopPressedWhileRecording: o.stopPressedWhileRecording,
        startToStopMs: o.startToStopMs, rowsBefore: o.rowsBefore?.length ?? null, rowsAfter: o.rowsAfter?.length ?? null,
        acceptedCompletingSaves: o.acceptedCompletingSaves, acceptedFailedMarks: o.acceptedFailedMarks, acceptedUnreadableSaves: o.acceptedUnreadableSaves,
        pendingSaves: o.pendingSaves, savedConfirmationShown: o.savedConfirmationShown, notSavedShown: o.notSavedShown,
        unsettledDiscardShown: o.unsettledDiscardShown, coachingRequests: o.coachingRequests, liveTracksAfterStop: o.liveTracksAfterStop,
    });
    return outcome;
}

/**
 * What J1.c's take means for AHT-01's probe-save-isolation row: a no-save probe only when the short Stop was exercised; no
 * take when this step pressed nothing; otherwise unknown (a slow Stop may have saved a normal take), which that row holds.
 */
export type ShortStopTake = 'probe' | 'not-started' | 'unknown';
export function shortStopTakeOf(o: ShortStopObservation | null): ShortStopTake {
    if (!o || o.startPressed === null) return 'unknown';
    if (!o.startPressed) return 'not-started';
    return o.stopPressedWhileRecording === true ? 'probe' : 'unknown';
}
