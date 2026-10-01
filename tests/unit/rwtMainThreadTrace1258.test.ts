// @vitest-environment node
/**
 * #1258 Open Mic Stop-stall diagnostic — the trace summary is numeric and generic-name only, and it detects a main
 * thread that stopped reporting (a long task that never completed leaves a long silent tail).
 */
import { describe, expect, it } from 'vitest';
import { MainThreadTrace, boundedStopWithTrace, frameLabel, keepTraceEvent, summarizeTrace, withDeadline } from '../live/helpers/rwtMainThreadTrace';

const meta = (pid: number, tid: number, name: string) => ({ name: 'thread_name', ph: 'M', ts: 0, pid, tid, args: { name } });
const task = (tid: number, tsMs: number, durMs: number, name = 'RunTask') => ({ name, ph: 'X', ts: tsMs * 1000, dur: durMs * 1000, pid: 1, tid });

describe('#1258 main-thread trace summary', () => {
  it('reports per-thread busy share, the longest task, and its heaviest generic events', () => {
    const s = summarizeTrace([
      meta(1, 10, 'CrRendererMain'), meta(1, 20, 'DedicatedWorker thread'),
      task(10, 0, 100), task(10, 200, 800), task(10, 250, 700, 'FunctionCall'), task(10, 1000, 50),
      task(20, 0, 900), task(20, 950, 50),
    ]);
    expect(s).toMatchObject({ trace_window_ms: 1050, trace_main_tasks: 3, trace_main_longest_task_ms: 800, trace_main_tasks_over_500ms: 1, trace_worker_tasks: 2 });
    expect(s.trace_main_busy_pct).toBeCloseTo(90.5, 0);
    expect(s.trace_main_longest_task_top_events).toBe('FunctionCall=700ms');
  });

  it('a main thread that stopped reporting shows a long silent tail while the worker keeps running', () => {
    const s = summarizeTrace([
      meta(1, 10, 'CrRendererMain'), meta(1, 20, 'DedicatedWorker thread'),
      task(10, 0, 10), task(20, 0, 30_000), task(20, 30_000, 30_000),
    ]);
    expect(s.trace_main_silent_tail_ms).toBe(59_990);
    expect(s.trace_worker_silent_tail_ms).toBe(0);
  });

  it('is content-free: only numbers, nulls and generic event-name summaries', () => {
    const s = summarizeTrace([meta(1, 10, 'CrRendererMain'), task(10, 0, 600), task(10, 0, 500, 'EvaluateScript "secret text"')]);
    for (const v of Object.values(s)) expect(['number', 'string'].includes(typeof v) || v === null).toBe(true);
    expect(String(s.trace_main_longest_task_top_events)).not.toMatch(/[" ]/);
  });

  it('with nothing captured it says so instead of inventing numbers', () => {
    expect(summarizeTrace([])).toMatchObject({ trace_events: 0, trace_note: 'no renderer or worker tasks captured' });
  });
});

describe('#1547 Codex P1: the trace is recorded whatever Stop does', () => {
  const recorder = () => { const calls: string[] = []; return { calls, record: async () => { calls.push('recorded'); } }; };

  it('Stop succeeds → trace recorded, no error', async () => {
    const r = recorder();
    await expect(boundedStopWithTrace(async () => 'ok', 1_000, r.record)).resolves.toBeUndefined();
    expect(r.calls).toEqual(['recorded']);
  });

  it('CASUALTY: Stop REJECTS on a responsive page → trace recorded, the original error rethrown', async () => {
    const r = recorder();
    const original = new Error('recorder bar did not clear');
    await expect(boundedStopWithTrace(async () => { throw original; }, 1_000, r.record)).rejects.toBe(original);
    expect(r.calls).toEqual(['recorded']);
  });

  it('Stop never settles (frozen page) → trace recorded at the bound, then a bounded failure', async () => {
    const r = recorder();
    await expect(boundedStopWithTrace(() => new Promise(() => {}), 50, r.record)).rejects.toThrow(/did not complete within 0.05 s/);
    expect(r.calls).toEqual(['recorded']);
  });
});

describe('#1258 code locations from V8 samples (content-free)', () => {
  const profile = (tid: number) => ({ name: 'Profile', ph: 'P', ts: 0, pid: 1, tid, id: '0x1', args: { data: { startTime: 0 } } });
  const chunk = (samples: number[], deltasUs: number[]) => ({
    name: 'ProfileChunk', ph: 'P', ts: 0, pid: 1, tid: 99, id: '0x1',
    args: { data: {
      cpuProfile: { nodes: [
        { id: 1, callFrame: { functionName: '(idle)', url: '' } },
        { id: 2, callFrame: { functionName: 'analyzeFillers', url: 'https://speaksharp-public.vercel.app/assets/index-AbC123.js', lineNumber: 0, columnNumber: 4567 } },
        { id: 3, callFrame: { functionName: 'render', url: 'https://speaksharp-public.vercel.app/assets/vendor-XyZ.js?v=1', lineNumber: 9, columnNumber: 0 } },
      ], samples },
      timeDeltas: deltasUs,
    } },
  });

  it('names the most-sampled main-thread location, overall and in the last 10 s, as file:line:col function', () => {
    const s = summarizeTrace([
      meta(1, 10, 'CrRendererMain'), task(10, 0, 30_000), profile(10),
      // 2 s of mixed work, then 20 s stuck in analyzeFillers
      chunk([3, 1, 3, ...Array(20).fill(2)], [0, 1_000_000, 1_000_000, ...Array(20).fill(1_000_000)]),
    ]);
    expect(s.trace_main_samples).toBe(22);
    expect(String(s.trace_main_top_js)).toMatch(/^index-AbC123\.js:1:4568 analyzeFillers 91%/);
    expect(String(s.trace_main_tail10s_top_js)).toMatch(/^index-AbC123\.js:1:4568 analyzeFillers 100%/);
    expect(String(s.trace_main_top_js)).toContain('vendor-XyZ.js:10:1 render');
    expect(String(s.trace_main_top_js)).not.toMatch(/https?:|\?v=/);
  });

  it('with no main-thread profile it reports zero samples instead of a location', () => {
    expect(summarizeTrace([meta(1, 10, 'CrRendererMain'), task(10, 0, 10)])).toMatchObject({ trace_main_samples: 0 });
  });
});

describe('#1547 privacy/shape: code locations cannot carry free text or URL/query content (PM 5919893573)', () => {
  const SHAPE = /^(\(script\)|[A-Za-z0-9_.-]{1,60}\.m?js)(:\d+:\d+)? (\(fn\)|[A-Za-z_$][A-Za-z0-9_$.]{0,40})$/;

  it.each([
    ['query string and hash stripped', { url: 'https://speaksharp-public.vercel.app/assets/index-A1.js?token=abc#frag', functionName: 'run', lineNumber: 0, columnNumber: 9 }, 'index-A1.js:1:10 run'],
    ['credentials/userinfo URL → no file identity leak beyond base name', { url: 'https://user:secret@host/x/app.mjs', functionName: 'f', lineNumber: 2, columnNumber: 0 }, 'app.mjs:3:1 f'],
    ['free text in the function name → (fn)', { url: 'https://h/a.js', functionName: 'you said hello world', lineNumber: 0, columnNumber: 0 }, 'a.js:1:1 (fn)'],
    ['data: URL with inline source → (script)', { url: 'data:text/javascript,alert("transcript")', functionName: 'x', lineNumber: 0, columnNumber: 0 }, '(script):1:1 x'],
    ['blob: URL → (script)', { url: 'blob:https://h/1234-uuid', functionName: 'w', lineNumber: 5, columnNumber: 5 }, '(script):6:6 w'],
    ['non-JS resource name → (script)', { url: 'https://h/page.html', functionName: 'g', lineNumber: 0, columnNumber: 0 }, '(script):1:1 g'],
    ['over-long identifier → (fn)', { url: 'https://h/a.js', functionName: 'a'.repeat(60), lineNumber: 0, columnNumber: 0 }, 'a.js:1:1 (fn)'],
    ['no position → no line:col', { url: 'https://h/a.js', functionName: 'g' }, 'a.js g'],
    ['native frame', { url: '', functionName: 'JSON.parse' }, '(script) JSON.parse'],
  ])('%s', (_label, frame, expected) => {
    const out = frameLabel(frame);
    expect(out).toBe(expected);
    expect(out).toMatch(SHAPE);
    expect(out).not.toMatch(/https?:|[?#=@]|secret|token|transcript|hello/);
  });
});

describe('#1547 Codex P1 r4152479943: production-scale traces never throw', () => {
  it('summarizes 300,000 events without exceeding the argument limit', () => {
    const events: Array<Record<string, unknown>> = [meta(1, 10, 'CrRendererMain'), meta(1, 20, 'DedicatedWorker thread')];
    for (let i = 0; i < 150_000; i++) events.push(task(10, i, 1), task(20, i, 1));
    const s = summarizeTrace(events as never);
    expect(s.trace_events).toBe(300_002);
    expect(s.trace_main_tasks).toBe(150_000);
    expect(s.trace_worker_tasks).toBe(150_000);
  });

  it('a failure while recording the trace never replaces the original Stop failure', async () => {
    const original = new Error('recorder bar did not clear');
    await expect(boundedStopWithTrace(async () => { throw original; }, 1_000, async () => { throw new RangeError('boom'); })).rejects.toBe(original);
  });
});

describe('#1547 memory bound: only what the summary reads is kept as events arrive', () => {
  it('keeps thread names, top-level tasks, >= 1 ms child events and V8 profile events; drops the rest', () => {
    expect(keepTraceEvent({ name: 'thread_name', ph: 'M' })).toBe(true);
    expect(keepTraceEvent({ name: 'process_labels', ph: 'M' })).toBe(false);
    expect(keepTraceEvent({ name: 'RunTask', ph: 'X', dur: 5 })).toBe(true);
    expect(keepTraceEvent({ name: 'Profile', ph: 'P' })).toBe(true);
    expect(keepTraceEvent({ name: 'ProfileChunk', ph: 'P' })).toBe(true);
    expect(keepTraceEvent({ name: 'FunctionCall', ph: 'X', dur: 1_000 })).toBe(true);
    expect(keepTraceEvent({ name: 'FunctionCall', ph: 'X', dur: 999 })).toBe(false);
    expect(keepTraceEvent({ name: 'UpdateCounters', ph: 'I' })).toBe(false);
  });

  it('filtering preserves every task-based field; top_events then counts only child events of at least 1 ms', () => {
    const events: Array<Record<string, unknown>> = [meta(1, 10, 'CrRendererMain'), meta(1, 20, 'DedicatedWorker thread')];
    events.push(task(10, 0, 800), task(10, 100, 600, 'FunctionCall'), task(20, 0, 900));
    for (let i = 0; i < 50_000; i++) events.push({ name: 'Tiny', ph: 'X', ts: i, dur: 10, pid: 1, tid: 10 }, { name: 'Counter', ph: 'C', ts: i, pid: 1, tid: 10 });
    const filtered = events.filter((e) => keepTraceEvent(e as never));
    expect(filtered.length).toBeLessThan(10);
    const a = summarizeTrace(events as never);
    const b = summarizeTrace(filtered as never);
    for (const k of ['trace_main_tasks', 'trace_main_busy_pct', 'trace_main_longest_task_ms', 'trace_main_tasks_over_500ms', 'trace_main_silent_tail_ms', 'trace_worker_tasks', 'trace_worker_busy_pct']) expect(b[k]).toEqual(a[k]);
    // Documented trade-off: sub-millisecond children are not attributed (memory bound); the >= 1 ms child still is.
    expect(b.trace_main_longest_task_top_events).toBe('FunctionCall=600ms');
  });
});

/**
 * #1258 follow-up — run 36863804680 hung after the take began and wrote no receipt and no trace. A browser-session CDP
 * call is never rejected by closing the test's page, so every call that waits on the browser process is bounded on its
 * own and ends in a closed `trace_state`.
 */
type Behaviour = 'ok' | 'hang' | 'reject';
class StubCdp {
  readonly sent: string[] = [];
  private readonly handlers = new Map<string, Array<(e: { value: unknown[] }) => void>>();
  constructor(private readonly b: { start?: Behaviour; end?: Behaviour; complete?: boolean; events?: unknown[] } = {}) {}
  on(event: string, fn: (e: { value: unknown[] }) => void) { this.handlers.set(event, [...(this.handlers.get(event) ?? []), fn]); return this; }
  once(event: string, fn: (e: { value: unknown[] }) => void) { return this.on(event, fn); }
  private emit(event: string, payload: { value: unknown[] }) { for (const fn of this.handlers.get(event) ?? []) fn(payload); }
  send(method: string): Promise<unknown> {
    this.sent.push(method);
    const behaviour = method === 'Tracing.start' ? this.b.start ?? 'ok' : this.b.end ?? 'ok';
    if (behaviour === 'hang') return new Promise(() => {});
    if (behaviour === 'reject') return Promise.reject(new Error('Target closed'));
    if (method === 'Tracing.end') {
      setTimeout(() => {
        this.emit('Tracing.dataCollected', { value: this.b.events ?? [meta(1, 10, 'CrRendererMain'), task(10, 0, 600)] });
        if (this.b.complete !== false) this.emit('Tracing.tracingComplete', { value: [] });
      }, 0);
    }
    return Promise.resolve({});
  }
}
const browserWith = (cdp: StubCdp | 'hang' | 'reject') => ({
  newBrowserCDPSession: () => (cdp === 'hang' ? new Promise<never>(() => {}) : cdp === 'reject' ? Promise.reject(new Error('no')) : Promise.resolve(cdp as never)),
});
const OP_MS = 40;

describe('#1258 follow-up: every browser-level trace operation is bounded', () => {
  it('normal path unchanged: start → end → complete → summary, trace_state trace_summarized', async () => {
    const cdp = new StubCdp();
    const { trace, trace_state } = await MainThreadTrace.start(browserWith(cdp), OP_MS);
    expect(trace_state).toBe('trace_started');
    const s = await trace!.stop();
    expect(s).toMatchObject({ trace_state: 'trace_summarized', trace_main_tasks: 1, trace_main_longest_task_ms: 600, trace_events_received: 2 });
    expect(cdp.sent).toEqual(['Tracing.start', 'Tracing.end']);
  });

  it('opening the browser session never settles → trace_start_timeout, no trace, the journey continues', async () => {
    await expect(MainThreadTrace.start(browserWith('hang'), OP_MS)).resolves.toEqual({ trace: null, trace_state: 'trace_start_timeout' });
  });

  it('Tracing.start never settles → trace_start_timeout; a refusal → trace_start_failed', async () => {
    await expect(MainThreadTrace.start(browserWith(new StubCdp({ start: 'hang' })), OP_MS)).resolves.toMatchObject({ trace: null, trace_state: 'trace_start_timeout' });
    await expect(MainThreadTrace.start(browserWith(new StubCdp({ start: 'reject' })), OP_MS)).resolves.toMatchObject({ trace: null, trace_state: 'trace_start_failed' });
    await expect(MainThreadTrace.start(browserWith('reject'), OP_MS)).resolves.toMatchObject({ trace: null, trace_state: 'trace_start_failed' });
  });

  it('RED on #1547: the Tracing.end COMMAND never settles → bounded, trace_end_command_timeout, still summarized', async () => {
    const { trace } = await MainThreadTrace.start(browserWith(new StubCdp({ end: 'hang' })), OP_MS);
    const began = Date.now();
    const s = await trace!.stop();
    expect(Date.now() - began).toBeLessThan(1_000);
    expect(s).toMatchObject({ trace_state: 'trace_end_command_timeout', trace_events: 0 });
  });

  it('tracing-complete never arrives → trace_complete_timeout, and what did arrive is summarized', async () => {
    const { trace } = await MainThreadTrace.start(browserWith(new StubCdp({ complete: false })), OP_MS);
    const s = await trace!.stop();
    expect(s).toMatchObject({ trace_state: 'trace_complete_timeout', trace_main_longest_task_ms: 600 });
  });

  it('the end command rejecting (browser gone) → trace_end_failed, never a throw', async () => {
    const { trace } = await MainThreadTrace.start(browserWith(new StubCdp({ end: 'reject' })), OP_MS);
    await expect(trace!.stop()).resolves.toMatchObject({ trace_state: 'trace_end_failed' });
  });

  it('a summary that throws → trace_summary_failed with counts only', async () => {
    const { trace } = await MainThreadTrace.start(browserWith(new StubCdp({ events: [meta(1, 10, 'CrRendererMain'), { name: 'RunTask', ph: 'X', dur: 1_000, pid: 1, tid: 10, get ts(): number { throw new TypeError('bad'); } }] })), OP_MS);
    const s = await trace!.stop();
    expect(s).toMatchObject({ trace_state: 'trace_summary_failed', trace_note: 'summary failed: TypeError' });
  });

  it('stop is idempotent: the Stop path and the window deadline share ONE end attempt', async () => {
    const cdp = new StubCdp();
    const { trace } = await MainThreadTrace.start(browserWith(cdp), OP_MS);
    const [a, b] = await Promise.all([trace!.stop(), trace!.stop()]);
    expect(a).toBe(b);
    expect(cdp.sent.filter((m) => m === 'Tracing.end')).toHaveLength(1);
  });

  it('RED on #1547: a trace recording that never settles cannot hold the Stop outcome hostage', async () => {
    const original = new Error('recorder bar did not clear');
    await expect(boundedStopWithTrace(async () => { throw original; }, 1_000, () => new Promise(() => {}), OP_MS)).rejects.toBe(original);
    await expect(boundedStopWithTrace(async () => 'ok', 1_000, () => new Promise(() => {}), OP_MS)).resolves.toBeUndefined();
  });

  it('withDeadline settles every way, including a synchronous throw', async () => {
    await expect(withDeadline(async () => 1, 50)).resolves.toEqual({ kind: 'ok', value: 1 });
    await expect(withDeadline(() => new Promise(() => {}), 10)).resolves.toEqual({ kind: 'timeout' });
    const e = new Error('x');
    await expect(withDeadline(() => { throw e; }, 50)).resolves.toEqual({ kind: 'rejected', error: e });
  });
});
