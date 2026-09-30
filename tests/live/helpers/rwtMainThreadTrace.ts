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
const CATEGORIES = ['toplevel', 'devtools.timeline', 'v8', '__metadata'];

type TraceEvent = { name: string; ph: string; ts: number; dur?: number; pid: number; tid: number; args?: { name?: string } };

export type TraceSummary = Record<string, string | number | null>;

export class MainThreadTrace {
    private readonly events: TraceEvent[] = [];
    private readonly startedAtUs: number;

    private constructor(private readonly cdp: CDPSession) {
        this.startedAtUs = Date.now() * 1000;
        cdp.on('Tracing.dataCollected', (e) => { this.events.push(...(e.value as unknown as TraceEvent[])); });
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
        return summarizeTrace(this.events);
    }
}

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
    const t0 = Math.min(...timed.map((e) => e.ts));
    const t1 = Math.max(...events.filter((e) => typeof e.ts === 'number' && e.ts > 0).map((e) => e.ts + (e.dur ?? 0)));
    const windowUs = Math.max(1, t1 - t0);
    out.trace_window_ms = Math.round(windowUs / 1000);
    for (const [r] of THREAD_ROLES) {
        const tasks = timed.filter((e) => role.get(`${e.pid}:${e.tid}`) === r && e.name === 'RunTask');
        if (!tasks.length) { out[`trace_${r}_tasks`] = 0; continue; }
        const busyUs = tasks.reduce((a, e) => a + (e.dur ?? 0), 0);
        const longest = tasks.reduce((a, e) => ((e.dur ?? 0) > (a.dur ?? 0) ? e : a));
        const lastEnd = Math.max(...tasks.map((e) => e.ts + (e.dur ?? 0)));
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
    return out;
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
    await recordTrace();
    if (outcome.kind === 'rejected') throw outcome.error;
    if (outcome.kind === 'timed_out') throw new Error(`Stop did not complete within ${boundMs / 1000} s (page unresponsive); trace summary recorded in receipt meta`);
}
