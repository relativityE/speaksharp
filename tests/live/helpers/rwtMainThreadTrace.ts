import type { CDPSession } from '@playwright/test';

/**
 * #1258 Open Mic Stop stall — ONE content-free diagnostic (PM rule after a refuted H1).
 *
 * A BROWSER-level Chrome trace (it is collected by the browser process, so it still ends when the page's main thread is
 * blocked), with timeline categories only: no screenshots, DOM snapshots or network bodies, so no transcript text. Only
 * a numeric summary leaves this module — per-thread busy share, the longest top-level task, and how long each thread
 * has been silent at the end — plus generic trace event names. It is written into the receipt `meta`, so it changes
 * no verdict.
 */
// `disabled-by-default-v8.cpu_profiler`: V8 samples the call stack from its own sampling thread, so it still reports the
// code location while the main thread is stuck inside a function that never returns (which emits no complete event).
const CATEGORIES = ['toplevel', 'devtools.timeline', 'v8', 'disabled-by-default-v8.cpu_profiler', '__metadata'];

type CallFrame = { functionName?: string; url?: string; lineNumber?: number; columnNumber?: number };
type ProfileNode = { id: number; callFrame?: CallFrame };
type TraceEvent = {
    name: string; ph: string; ts: number; dur?: number; pid: number; tid: number; id?: string;
    args?: { name?: string; data?: { startTime?: number; cpuProfile?: { nodes?: ProfileNode[]; samples?: number[] }; timeDeltas?: number[] } };
};

export type TraceSummary = Record<string, string | number | null>;

/**
 * Memory bound (#1547): a 1–4 minute timeline + CPU-sampler trace can reach millions of events. Keep only what the
 * summary reads — thread-name metadata, top-level tasks, child events of at least 1 ms, and V8 profile events — as they
 * arrive, so the trace cannot exhaust the test runner's memory and lose the run. Every task-based field is unaffected;
 * `trace_main_longest_task_top_events` then attributes only child events of at least 1 ms (code location comes from the
 * V8 sampler, which is independent of event size).
 */
export function keepTraceEvent(e: { name?: string; ph?: string; dur?: number }): boolean {
    if (e.ph === 'M') return e.name === 'thread_name';
    if (e.name === 'RunTask' || e.name === 'Profile' || e.name === 'ProfileChunk') return true;
    return e.ph === 'X' && typeof e.dur === 'number' && e.dur >= 1_000;
}

/**
 * #1258 follow-up (run 36863804680 returned no receipt): every operation that waits on the BROWSER process is bounded on
 * its own, because a hung browser never rejects a browser-session CDP call — not even when the test's page is closed.
 * Each outcome is a closed-shape `trace_state`, recorded instead of blocking evidence emission.
 */
export type TraceState =
    | 'trace_started' | 'trace_start_timeout' | 'trace_start_failed'
    | 'trace_summarized' | 'trace_end_command_timeout' | 'trace_end_failed' | 'trace_complete_timeout' | 'trace_summary_failed';
/** Per-operation bound for start, the end command, and the wait for tracing-complete. */
export const TRACE_OP_TIMEOUT_MS = 30_000;
/** Hard cap on kept events, so the synchronous summary stays linear over a bounded array. */
export const MAX_KEPT_EVENTS = 1_500_000;

/** The CDP surface this module uses — the Playwright browser session, or a stub in tests. */
export type TraceCdp = Pick<CDPSession, 'send' | 'on' | 'once' | 'off' | 'detach'>;

/**
 * #1549 Codex P1 r4157529403: what happened to a trace session whose start did not succeed in time. A timed-out CDP
 * command is not cancelled, so the session is never simply dropped: it is unsubscribed and detached (bounded, once).
 */
export type TraceCleanup = 'not_needed' | 'detached' | 'detach_timeout' | 'detach_failed' | 'late_session_detach_scheduled';

/** Settles within `ms`: the value, the rejection, or a timeout — never a pending promise. */
export type Settled<T> = { kind: 'ok'; value: T } | { kind: 'rejected'; error: unknown } | { kind: 'timeout' };
export async function withDeadline<T>(work: () => Promise<T>, ms: number): Promise<Settled<T>> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            Promise.resolve().then(work).then((value) => ({ kind: 'ok' as const, value }), (error: unknown) => ({ kind: 'rejected' as const, error })),
            new Promise<{ kind: 'timeout' }>((resolve) => { timer = setTimeout(() => resolve({ kind: 'timeout' }), ms); }),
        ]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

export class MainThreadTrace {
    private readonly events: TraceEvent[] = [];
    private received = 0;
    private dropped = 0;
    private stopping: Promise<TraceSummary> | null = null;
    private abandoning: Promise<TraceCleanup> | null = null;

    // No argument spreading (#1547 Codex P1 r4152479943): a chunk can be large; append element by element.
    private readonly onData = (e: { value: unknown[] }): void => {
        for (const ev of e.value as unknown as TraceEvent[]) {
            this.received += 1;
            if (!keepTraceEvent(ev)) continue;
            if (this.events.length < MAX_KEPT_EVENTS) this.events.push(ev); else this.dropped += 1;
        }
    };

    private constructor(private readonly cdp: TraceCdp, private readonly opMs: number) {
        cdp.on('Tracing.dataCollected', this.onData as never);
    }

    /**
     * Starts tracing with the session open and the start command each bounded. A refusal or a timeout returns no trace
     * and a closed `trace_state`, so the journey is never blocked by the diagnostic.
     */
    static async start(
        browser: { newBrowserCDPSession(): Promise<TraceCdp> },
        opMs = TRACE_OP_TIMEOUT_MS,
    ): Promise<{ trace: MainThreadTrace | null; trace_state: TraceState; trace_cleanup: TraceCleanup }> {
        const opening = Promise.resolve().then(() => browser.newBrowserCDPSession());
        const session = await withDeadline(() => opening, opMs);
        if (session.kind === 'rejected') return { trace: null, trace_state: 'trace_start_failed', trace_cleanup: 'not_needed' };
        if (session.kind === 'timeout') {
            // A session that opens after we gave up is detached the moment it appears: nothing may stay attached.
            void opening.then((late) => withDeadline(() => late.detach(), opMs), () => undefined);
            return { trace: null, trace_state: 'trace_start_timeout', trace_cleanup: 'late_session_detach_scheduled' };
        }
        const trace = new MainThreadTrace(session.value, opMs);
        const starting = session.value.send('Tracing.start', {
            transferMode: 'ReportEvents', traceConfig: { includedCategories: CATEGORIES },
        });
        const started = await withDeadline(() => starting, opMs);
        if (started.kind === 'ok') return { trace, trace_state: 'trace_started', trace_cleanup: 'not_needed' };
        // The command may still complete after the deadline; it must not leave tracing or our listener running.
        starting.catch(() => undefined);
        const trace_cleanup = await trace.abandon();
        return { trace: null, trace_state: started.kind === 'timeout' ? 'trace_start_timeout' : 'trace_start_failed', trace_cleanup };
    }

    /**
     * Exactly once, bounded: stop listening, then detach the browser session. Chromium's tracing handler stops a recording
     * its session started when that session detaches, and a late reply to the start command lands on a detached session.
     */
    private abandon(): Promise<TraceCleanup> {
        this.abandoning ??= (async (): Promise<TraceCleanup> => {
            this.cdp.off('Tracing.dataCollected', this.onData as never);
            const detached = await withDeadline(() => this.cdp.detach(), this.opMs);
            return detached.kind === 'ok' ? 'detached' : detached.kind === 'timeout' ? 'detach_timeout' : 'detach_failed';
        })();
        return this.abandoning;
    }

    /**
     * Ends tracing and returns the content-free summary. Idempotent: the Stop path and the window deadline may both ask,
     * and both get the same single attempt. Never throws and never waits longer than two bounded operations.
     */
    stop(): Promise<TraceSummary> {
        this.stopping ??= this.stopOnce();
        return this.stopping;
    }

    private async stopOnce(): Promise<TraceSummary> {
        let state: TraceState = 'trace_summarized';
        const complete = new Promise<void>((resolve) => this.cdp.once('Tracing.tracingComplete', () => resolve()));
        const ended = await withDeadline(() => this.cdp.send('Tracing.end'), this.opMs);
        if (ended.kind === 'timeout') state = 'trace_end_command_timeout';
        else if (ended.kind === 'rejected') state = 'trace_end_failed';
        else if ((await withDeadline(() => complete, this.opMs)).kind === 'timeout') state = 'trace_complete_timeout';
        const counts = { trace_events_received: this.received, trace_events_dropped_cap: this.dropped };
        try {
            // An incomplete trace is still summarized: whatever arrived is evidence; `trace_state` says it is partial.
            return { ...summarizeTrace(this.events), ...counts, trace_state: state };
        } catch (error) {
            // The summary must never replace the Stop outcome; report that it failed, content-free.
            return { trace_events: this.events.length, ...counts, trace_state: 'trace_summary_failed', trace_note: `summary failed: ${error instanceof Error ? error.name : 'error'}` };
        }
    }
}

/** Iterative extremes: `Math.min(...xs)` / `Math.max(...xs)` throw RangeError past the argument limit (~100k). */
function minOf(xs: Iterable<number>): number { let m = Infinity; for (const x of xs) if (x < m) m = x; return m; }
function maxOf(xs: Iterable<number>): number { let m = -Infinity; for (const x of xs) if (x > m) m = x; return m; }
function* mapIter<T, R>(xs: Iterable<T>, f: (x: T) => R): Iterable<R> { for (const x of xs) yield f(x); }

const THREAD_ROLES: Array<[string, RegExp]> = [['main', /^CrRendererMain$/], ['worker', /^DedicatedWorker/]];

/** Pure: per-role busy share, longest top-level task, silent tail, and the most expensive generic event names. */
export function summarizeTrace(events: TraceEvent[]): TraceSummary {
    const role = new Map<string, string>();
    for (const e of events) {
        if (e.ph === 'M' && e.name === 'thread_name') {
            const name = e.args?.name ?? '';
            const hit = THREAD_ROLES.find(([, re]) => re.test(name));
            if (hit) role.set(`${e.pid}:${e.tid}`, hit[0]);
        }
    }
    const timed = events.filter((e) => e.ph === 'X' && typeof e.dur === 'number' && role.has(`${e.pid}:${e.tid}`));
    const out: TraceSummary = { trace_events: events.length };
    if (!timed.length) return { ...out, trace_note: 'no renderer or worker tasks captured' };
    const t0 = minOf(mapIter(timed, (e) => e.ts));
    // Trace end: every non-metadata event (metadata carries ts 0 and must not define the window).
    const t1 = maxOf(mapIter(events.filter((e) => e.ph !== 'M' && typeof e.ts === 'number'), (e) => e.ts + (e.dur ?? 0)));
    const windowUs = Math.max(1, t1 - t0);
    out.trace_window_ms = Math.round(windowUs / 1000);
    for (const [r] of THREAD_ROLES) {
        const tasks = timed.filter((e) => role.get(`${e.pid}:${e.tid}`) === r && e.name === 'RunTask');
        if (!tasks.length) { out[`trace_${r}_tasks`] = 0; continue; }
        const busyUs = tasks.reduce((a, e) => a + (e.dur ?? 0), 0);
        const longest = tasks.reduce((a, e) => ((e.dur ?? 0) > (a.dur ?? 0) ? e : a));
        const lastEnd = maxOf(mapIter(tasks, (e) => e.ts + (e.dur ?? 0)));
        out[`trace_${r}_tasks`] = tasks.length;
        out[`trace_${r}_busy_pct`] = Math.round((1000 * busyUs) / windowUs) / 10;
        out[`trace_${r}_longest_task_ms`] = Math.round((longest.dur ?? 0) / 1000);
        out[`trace_${r}_tasks_over_500ms`] = tasks.filter((e) => (e.dur ?? 0) > 500_000).length;
        // A task that never finished emits no complete event: a long silent tail means the thread stopped reporting.
        out[`trace_${r}_silent_tail_ms`] = Math.round((t1 - lastEnd) / 1000);
        if (r === 'main') {
            const inside = timed.filter((e) => role.get(`${e.pid}:${e.tid}`) === 'main' && e.name !== 'RunTask'
                && e.ts >= longest.ts && e.ts + (e.dur ?? 0) <= longest.ts + (longest.dur ?? 0));
            const byName = new Map<string, number>();
            for (const e of inside) byName.set(e.name, (byName.get(e.name) ?? 0) + (e.dur ?? 0));
            out.trace_main_longest_task_top_events = [...byName.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
                .map(([n, d]) => `${n.replace(/[^A-Za-z0-9_.:-]/g, '').slice(0, 40)}=${Math.round(d / 1000)}ms`).join(', ') || null;
        }
    }
    Object.assign(out, summarizeMainThreadSamples(events, role, t1));
    return out;
}

/**
 * Content-free code location, CLOSED shapes only (PM 5919893573): a script base name that is a plain `.js`/`.mjs`
 * file name, a JS identifier, and integer line:column. Anything else — blob:/data:/inline scripts, query strings,
 * free text in a "function name" — collapses to `(script)` / `(fn)`, so no URL or page text can reach the receipt.
 */
const SCRIPT_NAME = /^[A-Za-z0-9_.-]{1,60}\.m?js$/;
const FUNCTION_NAME = /^[A-Za-z_$][A-Za-z0-9_$.]{0,40}$/;
export function frameLabel(frame: CallFrame | undefined): string {
    const url = frame?.url ?? '';
    const base = /^https?:\/\//.test(url) ? (url.split(/[?#]/)[0].split('/').pop() ?? '') : '';
    const file = SCRIPT_NAME.test(base) ? base : '(script)';
    const fn = FUNCTION_NAME.test(frame?.functionName ?? '') ? frame!.functionName! : '(fn)';
    const line = Number.isInteger(frame?.lineNumber) && (frame!.lineNumber as number) >= 0 ? (frame!.lineNumber as number) + 1 : null;
    const col = Number.isInteger(frame?.columnNumber) && (frame!.columnNumber as number) >= 0 ? (frame!.columnNumber as number) + 1 : null;
    return `${file}${line !== null ? `:${line}:${col ?? 0}` : ''} ${fn}`;
}

/**
 * The most-sampled code locations (self time) on the page's MAIN thread, over the whole trace and in its last 10 s.
 * Built from V8 `Profile`/`ProfileChunk` events: samples carry node ids; nodes carry call frames.
 */
export function summarizeMainThreadSamples(events: TraceEvent[], role: Map<string, string>, traceEndUs: number): TraceSummary {
    const profiles = new Map<string, { main: boolean; startUs: number; nodes: Map<number, CallFrame | undefined>; samples: Array<{ node: number; ts: number }> }>();
    for (const e of events) {
        if (e.name === 'Profile' && e.id) {
            profiles.set(e.id, { main: role.get(`${e.pid}:${e.tid}`) === 'main', startUs: e.args?.data?.startTime ?? e.ts, nodes: new Map(), samples: [] });
        }
    }
    for (const e of events) {
        if (e.name !== 'ProfileChunk' || !e.id) continue;
        const p = profiles.get(e.id);
        if (!p) continue;
        for (const n of e.args?.data?.cpuProfile?.nodes ?? []) p.nodes.set(n.id, n.callFrame);
        const samples = e.args?.data?.cpuProfile?.samples ?? [];
        const deltas = e.args?.data?.timeDeltas ?? [];
        let t = p.samples.length ? p.samples[p.samples.length - 1].ts : p.startUs;
        samples.forEach((node, i) => { t += deltas[i] ?? 0; p.samples.push({ node, ts: t }); });
    }
    const main = [...profiles.values()].filter((p) => p.main);
    if (!main.length) return { trace_main_samples: 0 };
    const top = (since: number) => {
        const counts = new Map<string, number>();
        let total = 0;
        for (const p of main) {
            for (const smp of p.samples) {
                if (smp.ts < since) continue;
                const frame = p.nodes.get(smp.node);
                if (!frame || frame.functionName === '(idle)' || frame.functionName === '(program)') continue;
                const label = frameLabel(frame);
                counts.set(label, (counts.get(label) ?? 0) + 1);
                total += 1;
            }
        }
        const list = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
            .map(([label, n]) => `${label} ${Math.round((100 * n) / Math.max(1, total))}%`).join('; ');
        return { total, list: list || null };
    };
    const all = top(-Infinity);
    const tail = top(traceEndUs - 10_000_000);
    return { trace_main_samples: all.total, trace_main_top_js: all.list, trace_main_tail10s_samples: tail.total, trace_main_tail10s_top_js: tail.list };
}

/**
 * #1547 Codex P1 r4149205476: run Stop under a bound and ALWAYS settle the trace afterwards — whether Stop resolves,
 * REJECTS (a responsive page whose recorder never clears: the worker-saturated case this diagnostic exists to catch), or
 * never settles (an unresponsive page). The original failure is rethrown after the trace is recorded. Recording the trace
 * is itself bounded (#1258 follow-up), so a hung browser cannot hold the Stop outcome hostage.
 */
export async function boundedStopWithTrace(
    stop: () => Promise<unknown>, boundMs: number, recordTrace: () => Promise<void>, recordBoundMs = 3 * TRACE_OP_TIMEOUT_MS,
): Promise<void> {
    const outcome = await withDeadline(stop, boundMs);
    // Recording the trace must never replace the Stop outcome (#1547 Codex P1 r4152479943).
    await withDeadline(recordTrace, recordBoundMs);
    if (outcome.kind === 'rejected') throw outcome.error;
    if (outcome.kind === 'timeout') throw new Error(`Stop did not complete within ${boundMs / 1000} s (page unresponsive); trace summary recorded in receipt meta`);
}
