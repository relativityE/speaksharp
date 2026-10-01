import { appendFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { withDeadline } from './rwtMainThreadTrace';

/**
 * #1258 follow-up to run 36863804680 (no receipt, no trace): evidence for the Open Mic recording hang that survives the
 * hang itself.
 *
 * - `DiagnosticRecord` is written to disk and printed to the job log BEFORE the risky window and on every update, so a
 *   test that never reaches its normal receipt still leaves a classification behind.
 * - `runBoundedWindow` puts a Node-side deadline around the traced take → Stop window; it does not depend on the page or
 *   the browser answering.
 * - `ProcessSampler` reads the runner's /proc and cgroup files from Node — outside the page and outside the browser
 *   protocol — so it keeps reporting while the browser is unresponsive.
 *
 * Content-free by construction: closed keys, numbers, booleans and closed-shape strings only. No command line, URL,
 * environment value, page text, transcript, audio, header, token or raw identifier can be written.
 */

export type DiagValue = string | number | boolean | null;

const KEY = /^[a-z][a-z0-9_]{0,63}$/;
/** The shapes this module and the trace summary produce (states, markers, error names, code locations, counts). */
const SAFE_TEXT = /^[A-Za-z0-9_.:%=;,()$ +-]{0,300}$/;

/** Drops anything that is not a closed key with a number, boolean, null or closed-shape string value. */
export function sanitizeDiagnostic(fields: Record<string, unknown>): Record<string, DiagValue> {
    const out: Record<string, DiagValue> = {};
    for (const [key, value] of Object.entries(fields)) {
        if (!KEY.test(key)) continue;
        if (value === null || typeof value === 'boolean') out[key] = value;
        else if (typeof value === 'number') out[key] = Number.isFinite(value) ? value : null;
        else if (typeof value === 'string') out[key] = SAFE_TEXT.test(value) ? value : '(redacted)';
    }
    return out;
}

/** An error reduced to its class name — never its message, which can carry a selector, URL or page text. */
export function errorName(error: unknown): string {
    const name = error instanceof Error ? error.name : 'error';
    return /^[A-Za-z]{1,40}$/.test(name) ? name : 'error';
}

export class DiagnosticRecord {
    readonly file: string;
    private fields: Record<string, DiagValue>;
    private readonly startedAt = Date.now();
    private readonly log: (line: string) => void;

    constructor(suite: string, opts: { dir?: string; log?: (line: string) => void; release?: string } = {}) {
        this.file = path.join(opts.dir ?? path.resolve('test-results', 'rwt'), `${suite}.diagnostic.json`);
        this.log = opts.log ?? ((line) => console.log(line));
        this.fields = sanitizeDiagnostic({
            diag_schema: 'rwt-diagnostic-v1',
            diag_suite: suite,
            diag_release: /^[0-9a-f]{40}$/.test(opts.release ?? '') ? opts.release : null,
            diag_last_marker: 'created',
        });
    }

    /** Merges closed fields and persists at once. `log: false` writes the file only (used for per-sample peaks). */
    update(fields: Record<string, unknown>, opts: { log?: boolean } = {}): void {
        this.fields = { ...this.fields, ...sanitizeDiagnostic(fields), diag_elapsed_ms: Date.now() - this.startedAt };
        const line = JSON.stringify(this.fields);
        try {
            mkdirSync(path.dirname(this.file), { recursive: true });
            writeFileSync(this.file, line);
        } catch {
            this.fields.diag_file_write_failed = true;
        }
        if (opts.log === false) return;
        try { this.log(`RWT_DIAGNOSTIC ${line}`); } catch { /* the file still holds it */ }
    }

    /** Records the last step that completed, and when — the hang is between it and the next marker. */
    mark(marker: string): void {
        const m = KEY.test(marker) ? marker : 'invalid_marker';
        this.update({ diag_last_marker: m, [`diag_at_${m}_ms`]: Date.now() - this.startedAt });
    }

    get lastMarker(): string {
        return String(this.fields.diag_last_marker ?? 'created');
    }

    snapshot(): Readonly<Record<string, DiagValue>> {
        return { ...this.fields };
    }
}

export class WindowDeadlineError extends Error {
    constructor(readonly lastMarker: string, readonly boundMs: number) {
        super(`diagnostic window did not complete within ${Math.round(boundMs / 1000)} s; last completed step: ${lastMarker}`);
        this.name = 'WindowDeadlineError';
    }
}

export class InsufficientTestBudgetError extends Error {
    constructor(readonly budgetMs: number, readonly minUsefulMs: number) {
        super(`diagnostic window not entered: ${Math.round(budgetMs / 1000)} s of test budget left after the cleanup reserve, below the ${Math.round(minUsefulMs / 1000)} s minimum useful window`);
        this.name = 'InsufficientTestBudgetError';
    }
}

/**
 * The two window bounds for a take of `speechSeconds` (#1549 Codex P2 r4157983399): both include the worst-case trace
 * start, because `MainThreadTrace.start` runs INSIDE the window. An admitted window can therefore always finish the speech
 * wait and reach Stop even when the trace start uses its whole allowance.
 * - `minUsefulMs`: trace start + speech wait (speech + 4 s) + 30 s to reach and begin Stop.
 * - `wantedMs`: trace start + speech wait + the full Stop bound + 60 s margin.
 */
export function diagnosticWindowFor(speechSeconds: number, o: { stopBoundMs: number; traceStartWorstCaseMs: number }):
    { wantedMs: number; minUsefulMs: number } {
    const speechWaitMs = Math.round((speechSeconds + 4) * 1000);
    return {
        wantedMs: o.traceStartWorstCaseMs + speechWaitMs + o.stopBoundMs + 60_000,
        minUsefulMs: o.traceStartWorstCaseMs + speechWaitMs + 30_000,
    };
}

/**
 * #1549 Codex P1 r4157529415: the window bound NEVER exceeds what the outer test timeout leaves after the cleanup reserve
 * — no floor. Below the minimum useful window the window is not entered at all, so the outer timeout can never pre-empt
 * the deadline handler and the receipt.
 */
export function planWindowBound(o: { wantedMs: number; remainingMs: number; reserveMs: number; minUsefulMs: number }):
    { kind: 'ok'; boundMs: number } | { kind: 'insufficient_test_budget'; budgetMs: number } {
    const budgetMs = Math.floor(o.remainingMs - o.reserveMs);
    const boundMs = Math.min(o.wantedMs, budgetMs);
    return boundMs >= o.minUsefulMs ? { kind: 'ok', boundMs } : { kind: 'insufficient_test_budget', budgetMs: Math.max(0, budgetMs) };
}

/** Returns the bound, or records `insufficient_test_budget` durably and fails at once, before any risky await. */
export function requireWindowBudget(record: DiagnosticRecord, o: Parameters<typeof planWindowBound>[0]): number {
    const plan = planWindowBound(o);
    if (plan.kind === 'ok') return plan.boundMs;
    record.update({ diag_window: 'insufficient_test_budget', diag_window_budget_ms: plan.budgetMs, diag_window_min_useful_ms: o.minUsefulMs });
    throw new InsufficientTestBudgetError(plan.budgetMs, o.minUsefulMs);
}

/**
 * Runs `body` under a Node-side deadline that fires whether or not the page or browser answers.
 * - completes → recorded, value returned;
 * - rejects → recorded (error class only), the ORIGINAL error rethrown unchanged;
 * - deadline → recorded with the last completed marker, then `onDeadline` (itself bounded) collects what it can, then a
 *   `WindowDeadlineError` naming that marker. The abandoned body is left for `onDeadline` to fence.
 */
export async function runBoundedWindow<T>(opts: {
    boundMs: number;
    record: DiagnosticRecord;
    body: () => Promise<T>;
    onDeadline: () => Promise<void>;
    onDeadlineBoundMs?: number;
}): Promise<T> {
    const { boundMs, record } = opts;
    record.update({ diag_window: 'entered', diag_window_bound_ms: boundMs });
    const outcome = await withDeadline(opts.body, boundMs);
    if (outcome.kind === 'ok') {
        record.update({ diag_window: 'completed' });
        return outcome.value;
    }
    if (outcome.kind === 'rejected') {
        record.update({ diag_window: 'failed', diag_window_error: errorName(outcome.error) });
        throw outcome.error;
    }
    const last = record.lastMarker;
    record.update({ diag_window: 'deadline', diag_window_deadline_after: last });
    const collected = await withDeadline(opts.onDeadline, opts.onDeadlineBoundMs ?? 120_000);
    record.update({ diag_window_deadline_collection: collected.kind });
    throw new WindowDeadlineError(last, boundMs);
}

/** The /proc reads the sampler needs — the real Linux filesystem, or a stub in tests. */
export interface ProcFs {
    read(file: string): string | null;
    pids(): number[];
}

export const linuxProcFs: ProcFs = {
    read: (file) => { try { return readFileSync(file, 'utf8'); } catch { return null; } },
    pids: () => { try { return readdirSync('/proc').filter((n) => /^\d+$/.test(n)).map(Number); } catch { return []; } },
};

/** Chromium process names as /proc reports them (`comm` is truncated to 15 characters). */
const BROWSER_COMM = /^(chrome|chromium|headless_shell|chrome_crashpad)/;
const PROC_TYPES = ['browser', 'renderer', 'gpu', 'utility', 'zygote', 'crashpad', 'other'] as const;
type ProcType = typeof PROC_TYPES[number];
/** Linux USER_HZ: utime/stime are reported in these ticks on the hosted runners. */
const CLOCK_TICKS = 100;

/** Only the `--type=` token is read from the command line, and only a closed enum leaves this function. */
export function processType(cmdline: string): ProcType {
    const m = /--type=([a-z-]+)/.exec(cmdline);
    if (!m) return 'browser';
    switch (m[1]) {
        case 'renderer': return 'renderer';
        case 'gpu-process': return 'gpu';
        case 'utility': return 'utility';
        case 'zygote': return 'zygote';
        case 'crashpad-handler': return 'crashpad';
        default: return 'other';
    }
}

const kb = (text: string | null, key: string): number | null => {
    const m = new RegExp(`^${key}:\\s+(\\d+)\\s*kB`, 'm').exec(text ?? '');
    return m ? Number(m[1]) : null;
};
const mb = (kib: number | null): number | null => (kib === null ? null : Math.round(kib / 1024));
const psi = (text: string | null, kind: 'some' | 'full'): number | null => {
    const m = new RegExp(`^${kind} avg10=([0-9.]+)`, 'm').exec(text ?? '');
    return m ? Number(m[1]) : null;
};
const bytesMb = (text: string | null): number | null => {
    const v = (text ?? '').trim();
    return /^\d+$/.test(v) ? Math.round(Number(v) / 1048576) : null;
};

export type ProcessSample = Record<string, number | null>;

/**
 * Samples runner memory/pressure, the job's cgroup, and the Chromium process tree every few seconds from Node.
 * Each sample is appended to `<suite>.process-samples.jsonl` and printed as one `RWT_PROC` job-log line as it is taken,
 * so samples survive a browser or test hang; peaks and the last sample are folded into the `DiagnosticRecord`.
 * High RSS alone is not OOM: the samples are evidence for growth, pressure or CPU, and the reader classifies.
 */
export class ProcessSampler {
    private timer: ReturnType<typeof setInterval> | null = null;
    private readonly startedAt: number;
    private lastCpu = new Map<number, number>();
    private lastCpuAt: number | null = null;
    private readonly peaks: Record<string, number | null> = {};
    private count = 0;
    private readonly samplesFile: string;

    constructor(
        private readonly record: DiagnosticRecord,
        private readonly opts: { fs?: ProcFs; log?: (line: string) => void; now?: () => number; dir?: string; suite?: string } = {},
    ) {
        this.samplesFile = path.join(opts.dir ?? path.dirname(record.file), `${opts.suite ?? 'rwt'}.process-samples.jsonl`);
        this.startedAt = this.now();
    }

    private get fs(): ProcFs { return this.opts.fs ?? linuxProcFs; }
    private now(): number { return (this.opts.now ?? Date.now)(); }

    /** Starts sampling, or records `proc_sampler=unsupported` where there is no /proc (a developer's Mac). */
    start(intervalMs = 5_000): void {
        if (this.fs.read('/proc/meminfo') === null) {
            this.record.update({ proc_sampler: 'unsupported' });
            return;
        }
        this.record.update({ proc_sampler: 'running', proc_interval_ms: intervalMs });
        this.sampleNow();
        this.timer = setInterval(() => this.sampleNow(), intervalMs);
        // Never keeps the test worker alive on its own.
        (this.timer as { unref?: () => void }).unref?.();
    }

    /** Takes one sample; never throws (a failed read is a null field). */
    sampleNow(): ProcessSample {
        let sample: ProcessSample = {};
        try {
            sample = this.read();
        } catch {
            sample = { t_s: Math.round((this.now() - this.startedAt) / 1000), sample_failed: 1 };
        }
        this.count += 1;
        this.fold(sample);
        const line = JSON.stringify(sanitizeDiagnostic(sample));
        try {
            mkdirSync(path.dirname(this.samplesFile), { recursive: true });
            appendFileSync(this.samplesFile, `${line}\n`);
        } catch { /* the job-log line below still carries it */ }
        try { (this.opts.log ?? ((l: string) => console.log(l)))(`RWT_PROC ${line}`); } catch { /* best effort */ }
        this.record.update({ proc_samples: this.count, ...this.prefixed('proc_peak_', this.peaks), ...this.prefixed('proc_last_', sample) }, { log: false });
        return sample;
    }

    /** Stops sampling, takes a final sample, and logs the folded summary once. Safe to call more than once. */
    stop(): void {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
            this.sampleNow();
        }
        if (this.count > 0) this.record.update({ proc_sampler: 'stopped' });
    }

    private prefixed(prefix: string, values: Record<string, number | null>): Record<string, number | null> {
        const out: Record<string, number | null> = {};
        for (const [k, v] of Object.entries(values)) out[`${prefix}${k}`] = v;
        return out;
    }

    /** Peaks for growth/pressure/CPU, and the MINIMUM for available memory. */
    private fold(sample: ProcessSample): void {
        for (const [k, v] of Object.entries(sample)) {
            if (typeof v !== 'number' || k === 't_s') continue;
            const prev = this.peaks[k];
            if (k === 'mem_avail_mb') this.peaks[k] = prev === undefined || prev === null ? v : Math.min(prev, v);
            else this.peaks[k] = prev === undefined || prev === null ? v : Math.max(prev, v);
        }
    }

    private read(): ProcessSample {
        const now = this.now();
        const meminfo = this.fs.read('/proc/meminfo');
        const swapTotal = kb(meminfo, 'SwapTotal');
        const swapFree = kb(meminfo, 'SwapFree');
        const sample: ProcessSample = {
            t_s: Math.round((now - this.startedAt) / 1000),
            mem_total_mb: mb(kb(meminfo, 'MemTotal')),
            mem_avail_mb: mb(kb(meminfo, 'MemAvailable')),
            swap_used_mb: swapTotal !== null && swapFree !== null ? mb(swapTotal - swapFree) : null,
            psi_mem_some10: psi(this.fs.read('/proc/pressure/memory'), 'some'),
            psi_mem_full10: psi(this.fs.read('/proc/pressure/memory'), 'full'),
            psi_cpu_some10: psi(this.fs.read('/proc/pressure/cpu'), 'some'),
            load1: (() => { const v = Number((this.fs.read('/proc/loadavg') ?? '').split(' ')[0]); return Number.isFinite(v) ? v : null; })(),
        };
        // cgroup v2 of THIS process (the job); the path is used to read files and is never written out.
        const cg = /^0::(\/[^\n]*)$/m.exec(this.fs.read('/proc/self/cgroup') ?? '')?.[1] ?? '/';
        const cgDir = path.posix.join('/sys/fs/cgroup', cg);
        sample.cg_mem_mb = bytesMb(this.fs.read(`${cgDir}/memory.current`));
        sample.cg_max_mb = bytesMb(this.fs.read(`${cgDir}/memory.max`)); // "max" (no limit) → null
        const events = this.fs.read(`${cgDir}/memory.events`);
        const oomKill = /^oom_kill (\d+)$/m.exec(events ?? '');
        sample.cg_oom_kill = oomKill ? Number(oomKill[1]) : null;

        const rss: Record<ProcType, number> = { browser: 0, renderer: 0, gpu: 0, utility: 0, zygote: 0, crashpad: 0, other: 0 };
        const cpuTicks: Record<ProcType, number> = { browser: 0, renderer: 0, gpu: 0, utility: 0, zygote: 0, crashpad: 0, other: 0 };
        let procs = 0;
        const seen = new Map<number, number>();
        for (const pid of this.fs.pids()) {
            const comm = (this.fs.read(`/proc/${pid}/comm`) ?? '').trim();
            if (!BROWSER_COMM.test(comm)) continue;
            const type = processType((this.fs.read(`/proc/${pid}/cmdline`) ?? '').replace(/\0/g, ' '));
            procs += 1;
            rss[type] += kb(this.fs.read(`/proc/${pid}/status`), 'VmRSS') ?? 0;
            // stat fields after the "(comm)" field: utime and stime are the 12th and 13th.
            const stat = this.fs.read(`/proc/${pid}/stat`) ?? '';
            const rest = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
            const ticks = Number(rest[11]) + Number(rest[12]);
            if (!Number.isFinite(ticks)) continue;
            seen.set(pid, ticks);
            const prev = this.lastCpu.get(pid);
            if (prev !== undefined && ticks >= prev) cpuTicks[type] += ticks - prev;
        }
        const elapsedS = this.lastCpuAt !== null && now > this.lastCpuAt ? (now - this.lastCpuAt) / 1000 : 0;
        this.lastCpu = seen;
        this.lastCpuAt = now;
        sample.br_procs = procs;
        sample.br_rss_mb = mb(Object.values(rss).reduce((a, b) => a + b, 0));
        for (const type of PROC_TYPES) {
            if (rss[type] > 0) sample[`rss_${type}_mb`] = mb(rss[type]);
            // Percent of ONE core over the interval (can exceed 100 for a multi-threaded process).
            if (elapsedS > 0 && cpuTicks[type] > 0) sample[`cpu_${type}_pct`] = Math.round((100 * cpuTicks[type]) / (CLOCK_TICKS * elapsedS));
        }
        return sample;
    }
}
