// @vitest-environment node
/**
 * AHT-01 / #1812 (Sam: the 45-min job margin was unproven). What this guard CHECKS, recomputed from source on every change:
 *   1. every Gate 3 step that can run on the single-spec (diagnostic) path has its own positive `timeout-minutes`;
 *   2. the job `timeout-minutes` >= the sum of those step limits + POST_ACTION_ALLOWANCE_MIN;
 *   3. CONFIGURED ENVELOPE COVERAGE: the spec step's limit >= the Open Mic body timeout + the finalizer's declared worst case
 *      (summed from its `steps.step(...)` third arguments, plus the owned-cleanup proof and settle) + DECLARED_PLAYWRIGHT_ENVELOPE_MS;
 *   4. the interrupted-run recovery age floor is coupled to the job limit (it never spends its safety margin).
 * What it does NOT prove (UNPROVEN allowances, stated explicitly): Playwright preflight/process/browser start and teardown are not
 * bounded by an enforced deadline here (DECLARED_PLAYWRIGHT_ENVELOPE_MS is an allowance), the post-action margin is an allowance,
 * and runner loss or cancellation can still skip cleanup — that residue is the interrupted-run recovery's job.
 * Playwright runs afterEach (the finalizer drain) in its own slot of max(project, test) timeout (accepted separately).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { FINALIZE_CLEANUP_MS, FINALIZE_SETTLE_MS, FINALIZE_STEP_MS } from '../live/helpers/rwtWatchdog';
import { GATE3_JOB_TIMEOUT_MS } from '../live/helpers/rwtInterruptedRunRecovery';

const ROOT = resolve(__dirname, '../..');
/** UNPROVEN allowance: implicit post-action steps (action posts, job teardown). */
const POST_ACTION_ALLOWANCE_MIN = 4;
/** UNPROVEN allowance: Playwright preflight, process/browser start and teardown inside the spec step. */
const DECLARED_PLAYWRIGHT_ENVELOPE_MS = 60_000;
const SPEC = 'tests/live/rwt-open-mic-first-session.live.spec.ts';
const SPEC_STEP = 'Run DAST Live Gate (DIAGNOSTIC single spec — NOT a Gate 3 pass)';

type Step = { name?: string; uses?: string; if?: string; 'timeout-minutes'?: unknown };
const workflow = parse(readFileSync(resolve(ROOT, '.github/workflows/rc-gates.yml'), 'utf8')) as { jobs: Record<string, { 'timeout-minutes': number; steps: Step[] }> };
const gate3 = workflow.jobs['gate-3-dast'];
const label = (s: Step) => s.name ?? s.uses ?? '?';
/** A step is off the single-spec path only when its condition requires an EMPTY diagnostic_dast_spec. */
const onDiagnosticPath = (s: Step) => !(s.if ?? '').includes("diagnostic_dast_spec == ''");
const positiveMinutes = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;

/** Top-level arguments of the call whose `(` ends at `open`; returns them and the index after the closing `)`. */
function callArgs(source: string, open: number): { args: string[]; end: number } {
    let depth = 1, i = open, quote: string | null = null, from = open;
    const args: string[] = [];
    for (; i < source.length && depth > 0; i++) {
        const c = source[i];
        if (quote) { if (c === '\\') i++; else if (c === quote) quote = null; continue; }
        if (c === "'" || c === '"' || c === '`') quote = c;
        else if ('([{'.includes(c)) depth++;
        else if (')]}'.includes(c)) { depth--; if (depth === 0) args.push(source.slice(from, i)); }
        else if (c === ',' && depth === 1) { args.push(source.slice(from, i)); from = i + 1; }
    }
    if (depth !== 0) throw new Error('unbalanced steps.step call');
    return { args: args.map((a) => a.trim()).filter((a, k, all) => !(k === all.length - 1 && a === '')), end: i };
}

/**
 * The declared bound of each `steps.step(name, work, bound?, options?)` call: its THIRD argument when present — a known
 * `*_MS` constant (module constants or `const X_MS = <digits>;` in the source) or a plain numeric literal — else the
 * FinalizationSteps default. Anything else (an expression, an unknown name, a non-positive or non-finite value) FAILS CLOSED.
 */
export function finalizerWorstMs(source: string): { steps: number; worstMs: number } {
    const constants: Record<string, number> = { FINALIZE_STEP_MS, FINALIZE_SETTLE_MS, FINALIZE_CLEANUP_MS };
    for (const m of source.matchAll(/const ([A-Z_]+_MS) = ([\d_]+);/g)) constants[m[1]] = Number(m[2].replace(/_/g, ''));
    let worstMs = 0, steps = 0;
    for (const m of source.matchAll(/steps\.step\(/g)) {
        const { args } = callArgs(source, m.index! + m[0].length);
        const third = args[2];
        let bound: number;
        if (third === undefined) bound = FINALIZE_STEP_MS;
        else if (/^[A-Z_]+_MS$/.test(third)) {
            if (!(third in constants)) throw new Error(`unknown step bound ${third}`);
            bound = constants[third];
        } else if (/^[\d_]+$/.test(third)) bound = Number(third.replace(/_/g, ''));
        else throw new Error(`unsupported step bound expression: ${third}`);
        if (!Number.isFinite(bound) || bound <= 0) throw new Error(`non-positive step bound: ${third}`);
        worstMs += bound;
        steps++;
    }
    // finalizeOwnedCleanup: the cleanup-proof step plus the deletion settle, each up to FINALIZE_CLEANUP_MS.
    if (/finalizeOwnedCleanup\(/.test(source)) worstMs += 2 * FINALIZE_CLEANUP_MS;
    return { steps, worstMs };
}

describe('rc-gates Gate 3 time budget (configured envelope; unproven allowances stated)', () => {
    it('every step on the single-spec path has its own finite positive limit', () => {
        const unbounded = gate3.steps.filter(onDiagnosticPath).filter((s) => !positiveMinutes(s['timeout-minutes'])).map(label);
        expect(unbounded).toEqual([]);
    });
    it('the job limit covers the sum of those step limits plus the post-action allowance', () => {
        const sum = gate3.steps.filter(onDiagnosticPath).reduce((n, s) => n + (s['timeout-minutes'] as number), 0);
        expect(gate3['timeout-minutes']).toBeGreaterThanOrEqual(sum + POST_ACTION_ALLOWANCE_MIN);
    });
    it('configured envelope: the spec step covers the body timeout + the finalizer declared worst case + the declared Playwright envelope', () => {
        const source = readFileSync(resolve(ROOT, SPEC), 'utf8');
        const body = Number(/test\.setTimeout\(([\d_]+)\)/.exec(source)![1].replace(/_/g, ''));
        const { steps, worstMs } = finalizerWorstMs(source);
        expect(steps).toBeGreaterThan(0);
        const step = gate3.steps.find((s) => s.name === SPEC_STEP)!;
        expect((step['timeout-minutes'] as number) * 60_000).toBeGreaterThanOrEqual(body + worstMs + DECLARED_PLAYWRIGHT_ENVELOPE_MS);
    });
    it('the interrupted-run recovery age floor is coupled to the job limit', () => {
        expect(GATE3_JOB_TIMEOUT_MS).toBe(gate3['timeout-minutes'] * 60_000);
    });
    it('parser controls: the THIRD argument decides; a 4th argument is ignored; expressions, unknown names and non-positive bounds fail closed', () => {
        const src = `const X_MS = 5_000; steps.step('a', () => f(1, 2)); steps.step('b', (x) => { g(', )'); }, X_MS); steps.step('c', () => h(), FINALIZE_SETTLE_MS);`;
        expect(finalizerWorstMs(src)).toEqual({ steps: 3, worstMs: FINALIZE_STEP_MS + 5_000 + FINALIZE_SETTLE_MS });
        expect(finalizerWorstMs(`${src} finalizeOwnedCleanup(steps)`).worstMs).toBe(FINALIZE_STEP_MS + 5_000 + FINALIZE_SETTLE_MS + 2 * FINALIZE_CLEANUP_MS);
        // a 4th options argument no longer hides the 3rd bound (r1 counted the LAST argument)
        expect(finalizerWorstMs(`steps.step('x', work, 180_000, { critical: true })`)).toEqual({ steps: 1, worstMs: 180_000 });
        expect(finalizerWorstMs(`steps.step('x', work, FINALIZE_CLEANUP_MS, { critical: true })`).worstMs).toBe(FINALIZE_CLEANUP_MS);
        expect(() => finalizerWorstMs(`steps.step('x', work, 180_000 * 2)`)).toThrow(/unsupported step bound expression/);
        expect(() => finalizerWorstMs(`steps.step('x', work, -1)`)).toThrow(/unsupported/);
        expect(() => finalizerWorstMs(`steps.step('x', work, 0)`)).toThrow(/non-positive/);
        expect(() => finalizerWorstMs(`steps.step('d', () => 1, UNKNOWN_MS)`)).toThrow(/unknown step bound/);
        expect(() => finalizerWorstMs(`steps.step('d', () => (1`)).toThrow(/unbalanced/);
    });
});
