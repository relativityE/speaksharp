import { describe, expect, it } from 'vitest';
import { classifyRow, isCompleteRow, UNSCOREABLE_DISPOSITIONS } from '../checkpoint';
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
