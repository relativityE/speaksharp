// @vitest-environment node
/**
 * #1258 Open Mic Stop-stall diagnostic — the trace summary is numeric and generic-name only, and it detects a main
 * thread that stopped reporting (a long task that never completed leaves a long silent tail).
 */
import { describe, expect, it } from 'vitest';
import { boundedStopWithTrace, frameLabel, summarizeTrace } from '../live/helpers/rwtMainThreadTrace';

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
