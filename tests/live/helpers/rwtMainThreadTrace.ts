import type { Browser, CDPSession } from '@playwright/test';

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

export class MainThreadTrace {
    private readonly events: TraceEvent[] = [];
    private received = 0;
    private readonly startedAtUs: number;

    private constructor(private readonly cdp: CDPSession) {
        this.startedAtUs = Date.now() * 1000;
        // No argument spreading (#1547 Codex P1 r4152479943): a chunk can be large; append element by element.
        cdp.on('Tracing.dataCollected', (e) => {
            for (const ev of e.value as unknown as TraceEvent[]) { this.received += 1; if (keepTraceEvent(ev)) this.events.push(ev); }
        });
    }

    /** Starts tracing; returns null (and records nothing) if the browser refuses, so the journey is never blocked. */
    static async start(browser: Browser): Promise<MainThreadTrace | null> {
        try {
            const cdp = await browser.newBrowserCDPSession();
            const trace = new MainThreadTrace(cdp);
            await cdp.send('Tracing.start', { transferMode: 'ReportEvents', traceConfig: { includedCategories: CATEGORIES } });
            return trace;
        } catch {
            return null;
        }
    }

    /** Ends tracing (bounded) and returns the content-free summary. */
    async stop(timeoutMs = 60_000): Promise<TraceSummary> {
        try {
            const complete = new Promise<void>((resolve) => this.cdp.once('Tracing.tracingComplete', () => resolve()));
            await this.cdp.send('Tracing.end');
            await Promise.race([complete, new Promise((resolve) => setTimeout(resolve, timeoutMs))]);
        } catch { /* summarize whatever arrived */ }
        try {
            return { ...summarizeTrace(this.events), trace_events_received: this.received };
        } catch (error) {
            // The summary must never replace the Stop outcome; report that it failed, content-free.
            return { trace_events: this.events.length, trace_events_received: this.received, trace_note: `summary failed: ${error instanceof Error ? error.name : 'error'}` };
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
 * never settles (an unresponsive page). The original failure is rethrown after the trace is recorded.
 */
export async function boundedStopWithTrace(stop: () => Promise<unknown>, boundMs: number, recordTrace: () => Promise<void>): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const outcome = await Promise.race([
        stop().then(() => ({ kind: 'stopped' as const }), (error: unknown) => ({ kind: 'rejected' as const, error })),
        new Promise<{ kind: 'timed_out' }>((resolve) => { timer = setTimeout(() => resolve({ kind: 'timed_out' }), boundMs); }),
    ]);
    if (timer) clearTimeout(timer);
    // Recording the trace must never replace the Stop outcome (#1547 Codex P1 r4152479943).
    try { await recordTrace(); } catch { /* the receipt simply lacks trace meta; the Stop outcome stands */ }
    if (outcome.kind === 'rejected') throw outcome.error;
    if (outcome.kind === 'timed_out') throw new Error(`Stop did not complete within ${boundMs / 1000} s (page unresponsive); trace summary recorded in receipt meta`);
}
