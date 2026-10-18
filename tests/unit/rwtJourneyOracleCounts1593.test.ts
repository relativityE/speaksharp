// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { completedTakeIds, newRowsSince } from '../live/helpers/rwtAbandonTakeover';
import { knownSessionCount, navigationWritesVerdict } from '../live/helpers/rwtNavigationCounts';
import { coachingRequestBudgetRow } from '../live/helpers/rwtCoachingCollector';
import type { CoachingExchange } from '../live/helpers/coachingGenerationTap';

describe('case9 includes the saved left take in the per-take coaching budget', () => {
    const before = [{ id: 'existing', status: 'completed' }];
    const atReturn = [...before, { id: 'left', status: 'completed' }];
    const takes = [...completedTakeIds(newRowsSince(before, atReturn)), 'next'];
    const exchange = (sessionId: string): CoachingExchange => ({
        sent: { sessionId, product: 'open_mic', requestId: 'request', attemptId: 'attempt', clientAttempt: 1, clientReleaseId: 'release' },
        status: 200, diagnostics: { provider_attempts: 1 }, suggestions: null, clientMs: 1, at: 1, outcome: 'answered',
    });
    function budget(exchanges: CoachingExchange[]) {
        const rows: { verdict: string; evidence: Record<string, unknown> | undefined }[] = [];
        coachingRequestBudgetRow({ row: (_step, verdict, _detail, evidence) => { rows.push({ verdict, evidence }); } },
            { sentCount: exchanges.length, exchanges }, { maximum: 2, oneRequestPerSession: takes });
        return rows[0];
    }
    it('two left requests and zero next requests FAIL even though the whole-scenario maximum is two', () => {
        expect(budget([exchange('left'), exchange('left')])).toMatchObject({ verdict: 'FAIL', evidence: { maxRequestsForOneTake: 2 } });
    });
    it('one request for each distinct saved take PASSes', () => {
        expect(budget([exchange('left'), exchange('next')])).toMatchObject({ verdict: 'PASS', evidence: { maxRequestsForOneTake: 1 } });
    });
    it('includes every newly completed left row and excludes pre-existing, failed or active rows', () => {
        expect(completedTakeIds(newRowsSince(before, [...atReturn, { id: 'duplicate', status: 'completed' },
            { id: 'active', status: 'active' }, { id: 'failed', status: 'failed' }]))).toEqual(['left', 'duplicate']);
    });
});

describe('case15 requires observed nonnegative safe-integer session counts', () => {
    it.each([null, undefined, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1, '0', false])(
        'unavailable or invalid count %s never proves history or no writes', count => {
            expect(knownSessionCount(count)).toBe(false);
            expect(navigationWritesVerdict(count, count).status).toBe('HOLD');
            expect(navigationWritesVerdict(0, count).status).toBe('HOLD');
            expect(navigationWritesVerdict(count, 0).status).toBe('HOLD');
        });
    it('null total with completed1 and null after cannot become zero/no-writes PASS', () => {
        expect(knownSessionCount(null) && knownSessionCount(1)).toBe(false);
        expect(navigationWritesVerdict(null, null).status).toBe('HOLD');
    });
    it('equal observed counts including zero PASS; changed counts FAIL', () => {
        for (const count of [0, 1, Number.MAX_SAFE_INTEGER]) {
            expect(knownSessionCount(count)).toBe(true);
            expect(navigationWritesVerdict(count, count).status).toBe('PASS');
        }
        expect(navigationWritesVerdict(1, 2).status).toBe('FAIL');
        expect(navigationWritesVerdict(2, 1).status).toBe('FAIL');
    });
});
