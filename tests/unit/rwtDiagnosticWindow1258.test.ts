// @vitest-environment node
/**
 * #1258 follow-up to run 36863804680 (hung after the take began; no receipt, no trace): the diagnostic window is bounded
 * from Node, its evidence is durable before and during the window, and the external process sampler keeps reporting
 * without the page or the browser protocol. Everything written is content-free by construction.
 */
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { TRACE_START_WORST_CASE_MS, TRACE_STOP_WORST_CASE_MS, TRACE_OP_TIMEOUT_MS, boundedStopWithTrace } from '../live/helpers/rwtMainThreadTrace';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DiagnosticRecord,
  InsufficientTestBudgetError,
  ProcessSampler,
  WindowDeadlineError,
  diagnosticWindowFor,
  planWindowBound,
  requireWindowBudget,
  processType,
  runBoundedWindow,
  sanitizeDiagnostic,
  type ProcFs,
} from '../live/helpers/rwtDiagnosticWindow';

const SPEC = readFileSync(path.resolve(__dirname, '../live/rwt-open-mic-first-session.live.spec.ts'), 'utf8');
const RELEASE = 'a'.repeat(40);
const newRecord = () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'rwt-diag-'));
  const lines: string[] = [];
  const record = new DiagnosticRecord('open-mic-first-session', { dir, log: (l) => lines.push(l), release: RELEASE });
  return { dir, lines, record, onDisk: () => JSON.parse(readFileSync(record.file, 'utf8')) as Record<string, unknown> };
};

describe('#1258 follow-up: a Node-side deadline around the whole traced take → Stop window', () => {
  it('RED on #1547: a Row-4 page await that never settles → the deadline fires, names the last completed step, collects, and fails', async () => {
    const { record, onDisk } = newRecord();
    const collected: string[] = [];
    const run = runBoundedWindow({
      boundMs: 40,
      record,
      body: async () => { record.mark('row4_speech_wait_done'); await new Promise(() => {}); },
      onDeadline: async () => { collected.push('trace recorded', 'page fenced'); },
    });
    await expect(run).rejects.toBeInstanceOf(WindowDeadlineError);
    await expect(run).rejects.toThrow(/last completed step: row4_speech_wait_done/);
    expect(collected).toEqual(['trace recorded', 'page fenced']);
    expect(onDisk()).toMatchObject({ diag_window: 'deadline', diag_window_deadline_after: 'row4_speech_wait_done', diag_window_deadline_collection: 'ok' });
  });

  it('a deadline collection that itself never settles is bounded too, and the deadline still fails the window', async () => {
    const { record, onDisk } = newRecord();
    await expect(runBoundedWindow({ boundMs: 20, onDeadlineBoundMs: 20, record, body: () => new Promise(() => {}), onDeadline: () => new Promise(() => {}) }))
      .rejects.toBeInstanceOf(WindowDeadlineError);
    expect(onDisk()).toMatchObject({ diag_window: 'deadline', diag_window_deadline_collection: 'timeout' });
  });

  it('the ORIGINAL failure is preserved: a rejecting window rethrows the same error, recorded by class name only', async () => {
    const { record, onDisk } = newRecord();
    const original = new Error('recorder-stop toBeEnabled failed for "some selector" with page text');
    await expect(runBoundedWindow({ boundMs: 1_000, record, body: async () => { throw original; }, onDeadline: async () => {} })).rejects.toBe(original);
    expect(onDisk()).toMatchObject({ diag_window: 'failed', diag_window_error: 'Error' });
    expect(JSON.stringify(onDisk())).not.toMatch(/selector|page text/);
  });

  it('normal path unchanged: a window that completes returns its value and never runs the deadline collection', async () => {
    const { record, onDisk } = newRecord();
    const onDeadline = vi.fn(async () => {});
    await expect(runBoundedWindow({ boundMs: 1_000, record, body: async () => 'stopped', onDeadline })).resolves.toBe('stopped');
    expect(onDeadline).not.toHaveBeenCalled();
    expect(onDisk()).toMatchObject({ diag_window: 'completed' });
  });

  it('RED on #1547: the spec runs trace start, Row 4 and Stop INSIDE the bounded window, and the sampler starts before Row 3', () => {
    const windowAt = SPEC.indexOf('await runBoundedWindow({');
    const bodyEnd = SPEC.indexOf('onDeadline: async () => {', windowAt);
    expect(windowAt).toBeGreaterThan(0);
    const body = SPEC.slice(windowAt, bodyEnd);
    expect(body).toContain('MainThreadTrace.start(browser)');
    expect(body).toContain("test.step('row 4 — speak the corpus'");
    expect(body).toContain('boundedStopWithTrace(() => stopBenchmarkRecording(page');
    // The deadline collection records the trace and fences the page; every other exit asks for the trace again.
    expect(SPEC.slice(bodyEnd, bodyEnd + 400)).toMatch(/await recordTrace\(\);[\s\S]*page\.close\(\)/);
    expect(SPEC).toMatch(/} finally {\s*\/\/[^\n]*\n\s*await withDeadline\(recordTrace,/);
    expect(SPEC.indexOf('sampler.start(PROC_SAMPLE_MS)')).toBeLessThan(SPEC.indexOf("test.step('row 3 —"));
    // #1549 P1 r4157529415: the bound comes from the budget planner — no floor that could outlast the test.
    expect(SPEC).not.toMatch(/Math\.max\(60_000/);
    expect(SPEC).toMatch(/requireWindowBudget\(diag, \{[\s\S]*remainingMs: testInfo\.timeout - \(Date\.now\(\) - testStartedAt\),[\s\S]*reserveMs: WINDOW_RESERVE_MS,/);
    expect(SPEC.indexOf('requireWindowBudget(diag')).toBeLessThan(windowAt);
    expect(SPEC).toMatch(/onDeadlineBoundMs: DEADLINE_COLLECTION_MS,/);
    expect(SPEC).toMatch(/const WINDOW_RESERVE_MS = DEADLINE_COLLECTION_MS \+ /);
  });
});

describe('#1549 Codex P1 r4157529415: the window never outlasts the test', () => {
  const MIN = 84_000; // speech wait (≈54 s) + 30 s
  const RESERVE = 150_000;

  it('the bound never exceeds remaining − reserve, for every remaining budget (no 60 s floor)', () => {
    const violations: number[] = [];
    for (let remaining = 0; remaining <= 1_500_000; remaining += 7_000) {
      const plan = planWindowBound({ wantedMs: 354_000, remainingMs: remaining, reserveMs: RESERVE, minUsefulMs: MIN });
      const ok = plan.kind === 'ok'
        ? plan.boundMs <= remaining - RESERVE && plan.boundMs >= MIN
        : remaining - RESERVE < MIN;
      if (!ok) violations.push(remaining);
    }
    expect(violations).toEqual([]);
    // RED on 12ba26d47: max(60 s, min(354 s, 40 s)) = 60 s > the 40 s actually left.
    const old = Math.max(60_000, Math.min(354_000, 190_000 - RESERVE));
    expect(old).toBeGreaterThan(190_000 - RESERVE);
    expect(planWindowBound({ wantedMs: 354_000, remainingMs: 190_000, reserveMs: RESERVE, minUsefulMs: MIN })).toEqual({ kind: 'insufficient_test_budget', budgetMs: 40_000 });
  });

  it('a healthy budget keeps the full wanted window; a tight one shrinks to exactly what is left', () => {
    expect(planWindowBound({ wantedMs: 354_000, remainingMs: 1_200_000, reserveMs: RESERVE, minUsefulMs: MIN })).toEqual({ kind: 'ok', boundMs: 354_000 });
    expect(planWindowBound({ wantedMs: 354_000, remainingMs: 400_000, reserveMs: RESERVE, minUsefulMs: MIN })).toEqual({ kind: 'ok', boundMs: 250_000 });
  });

  it('slow rows 1–3 leave <60 s → the window is never entered: insufficient_test_budget is durable at once and the reserve stays intact', async () => {
    const { record, onDisk } = newRecord();
    const body = vi.fn(async () => {});
    const began = Date.now();
    const enter = async () => {
      const boundMs = requireWindowBudget(record, { wantedMs: 354_000, remainingMs: RESERVE + 45_000, reserveMs: RESERVE, minUsefulMs: MIN });
      await runBoundedWindow({ boundMs, record, body, onDeadline: async () => {} });
    };
    await expect(enter()).rejects.toBeInstanceOf(InsufficientTestBudgetError);
    expect(Date.now() - began).toBeLessThan(500); // fails now, not after a window the test cannot afford
    expect(body).not.toHaveBeenCalled();
    expect(onDisk()).toMatchObject({ diag_window: 'insufficient_test_budget', diag_window_budget_ms: 45_000, diag_window_min_useful_ms: MIN });
  });
});

describe('#1549 Codex P2 r4157983399: an admitted window can always reach Stop', () => {
  const SPEECH = 45.7; // the open_mic_tts fixture (tests/fixtures/rwt/rwt-fixtures.manifest.json)
  const RESERVE = 180_000;
  const bounds = diagnosticWindowFor(SPEECH, { stopBoundMs: 240_000, traceStartWorstCaseMs: TRACE_START_WORST_CASE_MS, traceStopWorstCaseMs: TRACE_STOP_WORST_CASE_MS });

  it('both bounds include the worst-case trace start (session open + start + cleanup = 3 op bounds)', () => {
    expect(TRACE_START_WORST_CASE_MS).toBe(3 * TRACE_OP_TIMEOUT_MS);
    expect(bounds).toEqual({ minUsefulMs: 90_000 + 49_700 + 30_000, wantedMs: 90_000 + 49_700 + 240_000 + 90_000 + 60_000 });
  });

  it('RED on a7e04c557: 140 s of budget used to be admitted although a slow trace start leaves too little to reach Stop', () => {
    const oldMin = Math.round((SPEECH + 4) * 1000) + 30_000; // a7e04c557: no trace-start allowance
    const remaining = RESERVE + 140_000;
    expect(planWindowBound({ wantedMs: 354_000, remainingMs: remaining, reserveMs: RESERVE, minUsefulMs: oldMin })).toEqual({ kind: 'ok', boundMs: 140_000 });
    expect(140_000 - TRACE_START_WORST_CASE_MS).toBeLessThan(Math.round((SPEECH + 4) * 1000) + 30_000); // cannot reach Stop
    expect(planWindowBound({ ...bounds, remainingMs: remaining, reserveMs: RESERVE })).toEqual({ kind: 'insufficient_test_budget', budgetMs: 140_000 });
  });

  it('every admitted bound leaves the speech wait + 30 s AFTER a worst-case trace start', () => {
    const shortfalls: number[] = [];
    for (let budget = 0; budget <= 1_000_000; budget += 5_000) {
      const plan = planWindowBound({ ...bounds, remainingMs: RESERVE + budget, reserveMs: RESERVE });
      if (plan.kind === 'ok' && plan.boundMs - TRACE_START_WORST_CASE_MS < Math.round((SPEECH + 4) * 1000) + 30_000) shortfalls.push(budget);
    }
    expect(shortfalls).toEqual([]);
  });

  it('spec shape: the spec takes both bounds from diagnosticWindowFor with the worst-case trace start, and the collection covers end + complete + cleanup', () => {
    expect(SPEC).toMatch(/diagnosticWindowFor\(speechSeconds, \{\s*stopBoundMs: STOP_BOUND_MS, traceStartWorstCaseMs: TRACE_START_WORST_CASE_MS,/);
    expect(SPEC).toMatch(/\.\.\.windowBounds\(fixture\.entry\.speechSeconds\)/);
    expect(SPEC).not.toMatch(/minUsefulWindowFor|windowBoundFor/);
    expect(SPEC).toMatch(/const DEADLINE_COLLECTION_MS = 3 \* TRACE_OP_TIMEOUT_MS \+ 30_000;/);
  });
});

describe('#1549 Codex P2 r4158574103: the wanted window outlasts Stop AND its bounded trace shutdown', () => {
  const SPEECH = 45.7;
  const SPEECH_WAIT_MS = Math.round((SPEECH + 4) * 1000);
  const STOP_MS = 240_000;
  afterEach(() => { vi.useRealTimers(); });

  it('RED on eb6f02b67: a full Stop bound then a worst-case trace stop ends with the Stop outcome, never WindowDeadlineError', async () => {
    vi.useFakeTimers();
    const { record, onDisk } = newRecord();
    const { wantedMs } = diagnosticWindowFor(SPEECH, { stopBoundMs: STOP_MS, traceStartWorstCaseMs: TRACE_START_WORST_CASE_MS, traceStopWorstCaseMs: TRACE_STOP_WORST_CASE_MS });
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const run = runBoundedWindow({
      boundMs: wantedMs,
      onDeadlineBoundMs: 1_000,
      record,
      body: async () => {
        await sleep(TRACE_START_WORST_CASE_MS); // slowest trace start
        await sleep(SPEECH_WAIT_MS);
        // Stop never settles (uses its whole bound); the trace stop never settles either (uses its whole default bound).
        await boundedStopWithTrace(() => new Promise(() => {}), STOP_MS, () => new Promise(() => {}));
      },
      onDeadline: async () => {},
    });
    const settled = run.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(wantedMs + 5_000);
    const error = await settled;
    expect(error).not.toBeInstanceOf(WindowDeadlineError);
    expect(String(error)).toMatch(/Stop did not complete within 240 s/);
    expect(onDisk()).toMatchObject({ diag_window: 'failed' });
  });

  it('the trace stop allowance is the bound boundedStopWithTrace uses by default (end + complete + cleanup)', () => {
    expect(TRACE_STOP_WORST_CASE_MS).toBe(3 * TRACE_OP_TIMEOUT_MS);
    expect(diagnosticWindowFor(SPEECH, { stopBoundMs: STOP_MS, traceStartWorstCaseMs: TRACE_START_WORST_CASE_MS, traceStopWorstCaseMs: TRACE_STOP_WORST_CASE_MS }))
      .toEqual({ wantedMs: 90_000 + SPEECH_WAIT_MS + STOP_MS + 90_000 + 60_000, minUsefulMs: 90_000 + SPEECH_WAIT_MS + 30_000 });
  });

  it('the remaining-test-budget cap still holds: a larger wanted window never exceeds the budget after the reserve', () => {
    const bounds = diagnosticWindowFor(SPEECH, { stopBoundMs: STOP_MS, traceStartWorstCaseMs: TRACE_START_WORST_CASE_MS, traceStopWorstCaseMs: TRACE_STOP_WORST_CASE_MS });
    const RESERVE = 180_000;
    const overruns: number[] = [];
    for (let budget = 0; budget <= 1_000_000; budget += 5_000) {
      const plan = planWindowBound({ ...bounds, remainingMs: RESERVE + budget, reserveMs: RESERVE });
      if (plan.kind === 'ok' && plan.boundMs > Math.min(budget, bounds.wantedMs)) overruns.push(budget);
    }
    expect(overruns).toEqual([]);
    expect(planWindowBound({ ...bounds, remainingMs: RESERVE + 400_000, reserveMs: RESERVE })).toEqual({ kind: 'ok', boundMs: 400_000 });
  });

  it('spec shape: the spec passes the worst-case trace stop into the window bounds', () => {
    expect(SPEC).toMatch(/traceStopWorstCaseMs: TRACE_STOP_WORST_CASE_MS/);
  });
});

describe('#1549 Codex P1 r4158574092: process peaks describe only the first-take window', () => {
  it('RED on eb6f02b67: the sampler stops right after the bounded window, before save/coaching, PDF and the repeat recording', () => {
    const windowAt = SPEC.indexOf('await runBoundedWindow({');
    const saveAt = SPEC.indexOf("test.step('row 5 — save and two coaching phrases'");
    const innerFinally = SPEC.slice(SPEC.indexOf('} finally {', windowAt), saveAt);
    expect(windowAt).toBeGreaterThan(0);
    expect(innerFinally).toContain('sampler.stop();');
    // After the bounded trace record, so the samples cover the trace shutdown that belongs to the window.
    expect(innerFinally.indexOf('sampler.stop();')).toBeGreaterThan(innerFinally.indexOf('await withDeadline(recordTrace'));
  });

  it('the outer finally and the afterEach backstop still stop it (a failure before the window)', () => {
    expect(SPEC.slice(SPEC.lastIndexOf('} finally {'))).toContain('sampler.stop();');
    expect(SPEC).toMatch(/test\.afterEach\(async \(\) => \{\s*\/\/[^\n]*\n\s*activeSampler\?\.stop\(\);/);
  });

  it('once stopped, later activity cannot move the folded peaks', () => {
    vi.useFakeTimers();
    try {
      const { record, onDisk } = newRecord();
      const proc = fakeProc();
      const sampler = new ProcessSampler(record, { fs: proc.fs, log: () => {}, suite: 'open-mic-first-session' });
      sampler.start(5_000);
      sampler.stop();
      const peaks = onDisk();
      for (let i = 0; i < 5; i += 1) proc.advance(); // a later spike (coaching, PDF, the repeat recording)
      vi.advanceTimersByTime(60_000);
      sampler.stop(); // the later backstops are no-ops for the samples
      expect(onDisk().proc_samples).toBe(peaks.proc_samples);
      expect(onDisk().proc_peak_rss_renderer_mb).toBe(peaks.proc_peak_rss_renderer_mb);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('#1258 follow-up: the diagnostic record is durable before, during and after the window', () => {
  it('exists on disk and in the job log from creation, and after every simulated failure', async () => {
    const { record, lines, onDisk } = newRecord();
    record.update({ diag_window: 'not_entered' });
    expect(existsSync(record.file)).toBe(true);
    expect(onDisk()).toMatchObject({ diag_schema: 'rwt-diagnostic-v1', diag_suite: 'open-mic-first-session', diag_release: RELEASE, diag_window: 'not_entered' });
    for (const body of [() => new Promise<never>(() => {}), async () => { throw new TypeError('x'); }]) {
      await runBoundedWindow({ boundMs: 20, onDeadlineBoundMs: 20, record, body, onDeadline: async () => {} }).catch(() => {});
      expect(['deadline', 'failed']).toContain(onDisk().diag_window);
    }
    expect(lines.length).toBeGreaterThan(2);
    for (const line of lines) expect(line).toMatch(/^RWT_DIAGNOSTIC \{/);
  });

  it('a marker is a closed key; anything else becomes invalid_marker', () => {
    const { record, onDisk } = newRecord();
    record.mark('row4_live_fillers_read');
    expect(onDisk()).toMatchObject({ diag_last_marker: 'row4_live_fillers_read' });
    expect(typeof onDisk().diag_at_row4_live_fillers_read_ms).toBe('number');
    record.mark('https://example.test/?q=secret');
    expect(onDisk().diag_last_marker).toBe('invalid_marker');
  });
});

describe('#1258 follow-up: content-free by construction', () => {
  it('drops non-closed keys and non-scalar values; free text, URLs and emails become (redacted)', () => {
    const out = sanitizeDiagnostic({
      ok_count: 3, ok_state: 'trace_end_command_timeout', 'Bad Key': 1, nested: { a: 1 }, list: [1],
      url: 'https://speaksharp-public.vercel.app/session?x=1', email: 'person@example.com', text: 'um so I was saying "hello"',
      inf: Infinity, loc: 'index-AbC1.js:1:2345 runTask 34%; (script) (fn) 5%', events: 'FunctionCall=700ms, v8.compile=5ms',
    });
    expect(out).toEqual({
      ok_count: 3, ok_state: 'trace_end_command_timeout', url: '(redacted)', email: '(redacted)', text: '(redacted)',
      inf: null, loc: 'index-AbC1.js:1:2345 runTask 34%; (script) (fn) 5%', events: 'FunctionCall=700ms, v8.compile=5ms',
    });
  });

  it('a process type is read from --type only and leaves as a closed enum', () => {
    expect(processType('/opt/chrome --type=renderer --lang=en --secret-flag=https://x.test')).toBe('renderer');
    expect(processType('/opt/chrome --type=gpu-process')).toBe('gpu');
    expect(processType('/opt/chrome --remote-debugging-pipe --user-data-dir=/tmp/profile')).toBe('browser');
    expect(processType('/opt/chrome --type=something-new')).toBe('other');
  });
});

/** A fake /proc: one runner, a browser, a renderer that grows, and an unrelated process that must be ignored. */
const fakeProc = () => {
  let tick = 0;
  const files = (): Record<string, string> => ({
    '/proc/meminfo': `MemTotal:       16384000 kB\nMemAvailable:   ${8_192_000 - tick * 1_024_000} kB\nSwapTotal:       4096000 kB\nSwapFree:        4096000 kB\n`,
    '/proc/pressure/memory': `some avg10=${(tick * 1.5).toFixed(2)} avg60=0.00 avg300=0.00 total=1\nfull avg10=${tick.toFixed(2)} avg60=0.00 avg300=0.00 total=1\n`,
    '/proc/pressure/cpu': 'some avg10=42.00 avg60=0.00 avg300=0.00 total=1\n',
    '/proc/loadavg': '3.50 2.00 1.00 2/300 999\n',
    '/proc/self/cgroup': '0::/system.slice/runner-job.service\n',
    '/sys/fs/cgroup/system.slice/runner-job.service/memory.current': String(2_147_483_648 + tick * 1_073_741_824),
    '/sys/fs/cgroup/system.slice/runner-job.service/memory.max': 'max\n',
    '/sys/fs/cgroup/system.slice/runner-job.service/memory.events': 'low 0\nhigh 0\nmax 0\noom 0\noom_kill 0\n',
    '/proc/100/comm': 'headless_shell\n',
    '/proc/100/cmdline': '/ms-playwright/headless_shell\0--remote-debugging-pipe\0--user-data-dir=/tmp/secret-profile\0',
    '/proc/100/status': 'Name:\theadless_shell\nVmRSS:\t  204800 kB\n',
    '/proc/100/stat': `100 (headless_shell) S 1 1 1 0 -1 0 0 0 0 0 ${100 + tick * 50} ${20 + tick * 10} 0 0 20 0 1 0`,
    '/proc/200/comm': 'headless_shell\n',
    '/proc/200/cmdline': '/ms-playwright/headless_shell\0--type=renderer\0--lang=en-US\0',
    '/proc/200/status': `Name:\theadless_shell\nVmRSS:\t ${409_600 + tick * 512_000} kB\n`,
    '/proc/200/stat': `200 (headless_shell) R 100 1 1 0 -1 0 0 0 0 0 ${1_000 + tick * 450} ${50 + tick * 50} 0 0 20 0 1 0`,
    '/proc/300/comm': 'node\n',
    '/proc/300/cmdline': 'node\0--secret\0',
    '/proc/300/status': 'VmRSS:\t 9999999 kB\n',
    '/proc/300/stat': '300 (node) S 1 1 1 0 -1 0 0 0 0 0 1 1 0 0 20 0 1 0',
  });
  const fs: ProcFs = { read: (f) => files()[f] ?? null, pids: () => [100, 200, 300] };
  return { fs, advance: () => { tick += 1; } };
};

describe('#1258 follow-up: external process/resource sampling from outside the page and browser protocol', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('samples runner memory, pressure, cgroup and the Chromium process tree; ignores other processes', () => {
    const { record, onDisk } = newRecord();
    const proc = fakeProc();
    let now = 0;
    const logs: string[] = [];
    const sampler = new ProcessSampler(record, { fs: proc.fs, now: () => now, log: (l) => logs.push(l), suite: 'open-mic-first-session' });
    sampler.sampleNow();
    proc.advance(); now += 5_000;
    const second = sampler.sampleNow();
    expect(second).toMatchObject({
      t_s: 5, mem_total_mb: 16_000, mem_avail_mb: 7_000, swap_used_mb: 0, psi_mem_some10: 1.5, psi_mem_full10: 1, psi_cpu_some10: 42,
      load1: 3.5, cg_mem_mb: 3_072, cg_max_mb: null, cg_oom_kill: 0, br_procs: 2, rss_browser_mb: 200, rss_renderer_mb: 900, br_rss_mb: 1_100,
      cpu_renderer_pct: 100, cpu_browser_pct: 12,
    });
    // Peaks fold upward; available memory folds to its minimum.
    expect(onDisk()).toMatchObject({ proc_samples: 2, proc_peak_rss_renderer_mb: 900, proc_peak_mem_avail_mb: 7_000, proc_last_br_procs: 2 });
    expect(logs).toHaveLength(2);
  });

  it('writes each sample incrementally (jsonl + one RWT_PROC line) and stops cleanly with a final sample', () => {
    vi.useFakeTimers();
    const { record, dir, onDisk } = newRecord();
    const proc = fakeProc();
    const logs: string[] = [];
    const sampler = new ProcessSampler(record, { fs: proc.fs, log: (l) => logs.push(l), suite: 'open-mic-first-session' });
    sampler.start(5_000);
    expect(onDisk()).toMatchObject({ proc_sampler: 'running', proc_interval_ms: 5_000 });
    const samplesFile = path.join(dir, 'open-mic-first-session.process-samples.jsonl');
    expect(readFileSync(samplesFile, 'utf8').trim().split('\n')).toHaveLength(1);
    vi.advanceTimersByTime(15_000);
    expect(readFileSync(samplesFile, 'utf8').trim().split('\n')).toHaveLength(4);
    sampler.stop();
    sampler.stop(); // idempotent
    vi.advanceTimersByTime(60_000);
    expect(readFileSync(samplesFile, 'utf8').trim().split('\n')).toHaveLength(5);
    expect(onDisk()).toMatchObject({ proc_sampler: 'stopped', proc_samples: 5 });
    expect(logs.filter((l) => l.startsWith('RWT_PROC {'))).toHaveLength(5);
  });

  it('sample output is numbers only — no command line, profile path, process name or other process data', () => {
    const { record, dir } = newRecord();
    const proc = fakeProc();
    const logs: string[] = [];
    const sampler = new ProcessSampler(record, { fs: proc.fs, log: (l) => logs.push(l), suite: 'open-mic-first-session' });
    sampler.sampleNow();
    const written = readFileSync(path.join(dir, 'open-mic-first-session.process-samples.jsonl'), 'utf8') + logs.join('\n') + readFileSync(record.file, 'utf8');
    expect(written).not.toMatch(/headless_shell|secret|remote-debugging|user-data-dir|runner-job|node|9999999|ms-playwright/);
    for (const value of Object.values(JSON.parse(logs[0].replace(/^RWT_PROC /, '')))) expect(value === null || typeof value === 'number').toBe(true);
  });

  it('where there is no /proc (a developer Mac) it records unsupported and never throws', () => {
    const { record, onDisk } = newRecord();
    const sampler = new ProcessSampler(record, { fs: { read: () => null, pids: () => [] } });
    expect(() => sampler.start(5_000)).not.toThrow();
    expect(() => sampler.stop()).not.toThrow();
    expect(onDisk()).toMatchObject({ proc_sampler: 'unsupported' });
  });

  it('a read that throws becomes a failed sample, never an exception', () => {
    const { record } = newRecord();
    const sampler = new ProcessSampler(record, { fs: { read: () => { throw new Error('EACCES'); }, pids: () => [] }, log: () => {} });
    expect(sampler.sampleNow()).toMatchObject({ sample_failed: 1 });
  });
});
