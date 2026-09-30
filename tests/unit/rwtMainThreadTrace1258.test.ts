// @vitest-environment node
/**
 * #1258 Open Mic Stop-stall diagnostic — the trace summary is numeric and generic-name only, and it detects a main
 * thread that stopped reporting (a long task that never completed leaves a long silent tail).
 */
import { describe, expect, it } from 'vitest';
import { boundedStopWithTrace, summarizeTrace } from '../live/helpers/rwtMainThreadTrace';

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
