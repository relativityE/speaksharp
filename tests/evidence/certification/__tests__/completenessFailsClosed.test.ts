import { describe, expect, it } from 'vitest';
import {
    classifyRow, isCompleteRow, validateCompleteness, UNSCOREABLE_DISPOSITIONS,
    RELIABILITY_COUNTERS, MEASURED_RELIABILITY_CONTRACT,
} from '../checkpoint';
import { NOT_EXECUTED_REASONS } from '../arms/registry';

/**
 * #1304 — completeness must FAIL CLOSED.
 *
 * The previous gate accepted `executed:false` with any reason or none, any non-empty `skipped` string,
 * and a backend-proven verdict with NO counts (a trailing `return true`). A row could be preserved as
 * complete while recording nothing about what it did, and resuming would skip that arm for good.
 */
const rel = (over: Record<string, number> = {}) => ({
    decoded: 600, expectedClips: 600, threw: 0, emptyOutput: 0, missing: 0, ...over,
});
const measured = (over: Record<string, unknown> = {}) => ({
    id: 'v2:base.en', verdict: { ok: true }, backendProven: true,
    expectedClips: 600, decodedClips: 600, reliability: rel(), ...over,
});

describe('a MEASURED row needs real, agreeing counts', () => {
    it('POSITIVE CONTROL: a genuinely complete row is accepted as measured', () => {
        expect(classifyRow(measured())).toEqual({ complete: true, kind: 'measured' });
    });

    it.each([
        ['expectedClips absent', { expectedClips: undefined }, /expectedClips missing/],
        ['decodedClips absent', { decodedClips: undefined }, /decodedClips missing/],
        ['reliability record absent', { reliability: undefined }, /reliability record missing/],
        ['reliability.decoded absent', { reliability: rel({ decoded: NaN }) }, /reliability\.decoded missing/],
        ['reliability.threw absent', { reliability: { decoded: 600, expectedClips: 600, emptyOutput: 0, missing: 0 } }, /reliability\.threw missing/],
    ])('REJECTS %s', (_label, over, pattern) => {
        const r = classifyRow(measured(over));
        expect(r.complete).toBe(false);
        expect((r as { reason: string }).reason).toMatch(pattern);
    });

    it('REJECTS counts that disagree with the reliability record', () => {
        // The exact 148-throw shape: the row claims 600 decoded, the record says 452.
        const r = classifyRow(measured({ decodedClips: 600, reliability: rel({ decoded: 452, threw: 148 }) }));
        expect(r.complete).toBe(false);
        expect((r as { reason: string }).reason).toMatch(/disagree with the reliability record/);
    });

    it.each([
        ['threw', rel({ threw: 1, decoded: 599 })],
        ['emptyOutput', rel({ emptyOutput: 4 })],
        ['missing', rel({ missing: 2 })],
    ])('REJECTS a row failing the reliability contract on %s', (_l, reliability) => {
        expect(isCompleteRow(measured({
            reliability, decodedClips: reliability.decoded, expectedClips: reliability.expectedClips,
        }))).toBe(false);
    });

    it('REJECTS a verdict without a proven backend, and one with no verdict at all', () => {
        expect(isCompleteRow(measured({ backendProven: false }))).toBe(false);
        expect(isCompleteRow(measured({ verdict: null }))).toBe(false);
    });
});

describe('NOT-EXECUTED rows need the EXACT registered reason', () => {
    it('POSITIVE CONTROL: the registered reason for the arm is accepted', () => {
        const id = 'v4:base:q8-decoder:cpu';
        expect(classifyRow({ id, executed: false, reason: NOT_EXECUTED_REASONS[id] }, NOT_EXECUTED_REASONS[id]))
            .toEqual({ complete: true, kind: 'not_executed' });
    });

    it('REJECTS a not-executed row with no reason', () => {
        expect(isCompleteRow({ id: 'x', executed: false })).toBe(false);
    });

    it('REJECTS an arbitrary, unregistered reason', () => {
        expect(isCompleteRow({ id: 'x', executed: false, reason: 'we ran out of time' })).toBe(false);
    });

    it("REJECTS a registered reason belonging to a DIFFERENT arm", () => {
        // 'alias_of_int8' is real, but not the reason registered for the webgpu arm. A valid-looking
        // string from the registry is not the same as the right one.
        const id = 'v4:base:q4-decoder:webgpu';
        expect(isCompleteRow({ id, executed: false, reason: 'alias_of_int8' }, NOT_EXECUTED_REASONS[id])).toBe(false);
    });
});

describe('ADMISSION and DISPOSITION rows are typed, not free text', () => {
    it('POSITIVE CONTROL: a registered admission status with a reason is accepted', () => {
        expect(classifyRow({ id: 'x', skipped: 'pending_harness', reason: 'requires_browser_webgpu' }))
            .toEqual({ complete: true, kind: 'admission' });
    });

    it('REJECTS an arbitrary skipped string — the old gate accepted ANY non-empty value', () => {
        expect(isCompleteRow({ id: 'x', skipped: 'because I said so', reason: 'r' })).toBe(false);
    });

    it('REJECTS an admission row with no reason', () => {
        expect(isCompleteRow({ id: 'x', skipped: 'rejected' })).toBe(false);
    });

    it('accepts every REGISTERED unscoreable disposition, and nothing else', () => {
        for (const d of UNSCOREABLE_DISPOSITIONS) {
            expect(classifyRow({ id: 'x', disposition: d })).toEqual({ complete: true, kind: 'unscoreable' });
        }
        expect(isCompleteRow({ id: 'x', disposition: 'looked_fine_to_me' })).toBe(false);
    });

    it('a FAILED run must disposition itself rather than masquerade as measured', () => {
        // No verdict, no disposition — the arm started and produced nothing. It must not be preserved.
        expect(isCompleteRow({ id: 'x', backendProven: true, expectedClips: 600, decodedClips: 0 })).toBe(false);
    });
});

describe('FINAL promotion applies the same reason discipline as resume', () => {
    // validateCompleteness called isCompleteRow(row) WITHOUT the arm's registered reason, so a row could
    // be promoted into the final artifact carrying a reason belonging to a different arm. Resume already
    // checked this; final promotion — the irreversible step — did not.
    const REQUIRED = ['v4:base:q8-decoder:cpu', 'v4:base:q4-decoder:webgpu'];
    const row = (id: string, reason: string) => ({ id, executed: false, reason });

    it('POSITIVE CONTROL: each arm carrying ITS OWN reason is promotable', () => {
        const rows = REQUIRED.map((id) => row(id, NOT_EXECUTED_REASONS[id]));
        expect(validateCompleteness(rows, REQUIRED)).toMatchObject({ ok: true });
    });

    it('CASUALTY: swapping two VALID registered reasons fails final promotion', () => {
        // Both strings are real registry values, so a check that only asked "is this reason registered?"
        // passed. Neither belongs to the arm carrying it.
        const [a, b] = REQUIRED;
        const swapped = [row(a, NOT_EXECUTED_REASONS[b]), row(b, NOT_EXECUTED_REASONS[a])];
        expect(NOT_EXECUTED_REASONS[a]).not.toBe(NOT_EXECUTED_REASONS[b]);
        const v = validateCompleteness(swapped, REQUIRED);
        expect(v).toMatchObject({ ok: false, reason: 'unfinished_arms' });
        expect((v as { detail: string }).detail).toContain(a);
        expect((v as { detail: string }).detail).toContain(b);
    });
});

describe('EVERY reliability counter is eligibility-gating, not three of them', () => {
    // The frozen-600 `v4:base:q4-decoder:wasm` row carried `truncated=1` and remained selection eligible.
    // A truncated decode measures something other than the clip, so the arm is one to re-measure — not a
    // completed measurement with a footnote.
    const rel = (over: Record<string, number> = {}) => ({
        decoded: 600, expectedClips: 600, threw: 0, emptyOutput: 0, missing: 0,
        timedOut: 0, audioRejected: 0, truncated: 0, ...over,
    });
    const row = (over: Record<string, number> = {}) => ({
        id: 'v4:base:q4-decoder:wasm', verdict: { ok: true }, backendProven: true,
        expectedClips: 600, decodedClips: 600, reliability: rel(over),
    });

    it('POSITIVE CONTROL: all counters zero is a completed measurement', () => {
        expect(classifyRow(row())).toEqual({ complete: true, kind: 'measured' });
    });

    it.each(RELIABILITY_COUNTERS)('CASUALTY: %s > 0 is NOT a completed measurement', (counter) => {
        const r = classifyRow(row({ [counter]: 1 }));
        expect(r.complete).toBe(false);
        expect((r as { reason: string }).reason).toContain(`${counter}=1`);
    });

    it('the truncated casualty is named explicitly — it is the one that shipped', () => {
        const r = classifyRow(row({ truncated: 1 }));
        expect(r.complete).toBe(false);
        expect((r as { reason: string }).reason).toMatch(/truncated=1/);
    });

    it('a truncated arm may still be preserved with a TYPED unscoreable disposition', () => {
        // The row is not lost — it is dispositioned rather than counted.
        expect(classifyRow({ id: 'x', disposition: 'unscoreable_arm' }))
            .toEqual({ complete: true, kind: 'unscoreable' });
    });

    it('the contract names every counter it enforces', () => {
        for (const c of RELIABILITY_COUNTERS) {
            expect(MEASURED_RELIABILITY_CONTRACT.requires).toContain(`${c} === 0`);
        }
    });
});
