/**
 * Default-off meaning matcher — FLAG ON. The model is used only when already ready, capped at 3 s; every other
 * outcome keeps the keyword verdict and says why. Finalize never creates a matcher or starts a download.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TalkingPointCoverage } from '@/services/rehearsal/outcomeScorecard';

const hoisted = vi.hoisted(() => ({
    matcher: null as null | {
        isReady: () => boolean;
        match: (...a: unknown[]) => Promise<TalkingPointCoverage[] | null>;
        ensureLoaded: () => Promise<void>;
        warmFromCache: () => Promise<void>;
    },
}));
vi.mock('../meaning/MeaningMatcher', () => ({ peekMeaningMatcher: () => hoisted.matcher }));

const registerObjectiveSource = vi.fn();
const startObjectiveSession = vi.fn();
const finalizeObjectiveEvidence = vi.fn();
vi.mock('../objectiveSessionService', () => ({
    registerObjectiveSource: (...a: unknown[]) => registerObjectiveSource(...a),
    startObjectiveSession: (...a: unknown[]) => startObjectiveSession(...a),
    finalizeObjectiveEvidence: (...a: unknown[]) => finalizeObjectiveEvidence(...a),
}));
const order = vi.fn(() => Promise.resolve({
    data: [{ id: 'p1', label: 'Customers want faster checkout', cue: null, sort_order: 0 }], error: null,
}));
vi.mock('@/lib/supabaseClient', () => ({
    getSupabaseClient: () => ({ from: () => ({ select: () => ({ eq: () => ({ order }) }) }) }),
}));
vi.mock('@/lib/logger', () => ({ default: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn(), trace: vi.fn() } }));

import { finalizeObjectiveSessionOnSave } from '../finalizeObjectiveSessionOnSave';
import { MEANING_MATCH_TIMEOUT_MS } from '../objectiveCoverage';

// A paraphrase: the keyword matcher finds nothing, so an 'nli' verdict is visibly the model's.
const SEGMENTS = [{ text: 'The people who buy from us keep asking for a quicker way to pay.', startSec: 8.4 }];
const INPUT = { projectId: 'proj', briefId: 'brief', sourceSessionId: 'src', idempotencyKey: 'idem', segments: SEGMENTS, durationSeconds: 60 };
const KEYWORD_SIGNALS = [{ brief_point_id: 'p1', detected_at_seconds: null }];

function stubMatcher(ready: boolean, match: (...a: unknown[]) => Promise<TalkingPointCoverage[] | null>) {
    const m = { isReady: vi.fn(() => ready), match: vi.fn(match), ensureLoaded: vi.fn(async () => undefined), warmFromCache: vi.fn(async () => undefined) };
    hoisted.matcher = m;
    return m;
}

describe('meaning matcher flag ON — finalize', () => {
    const WorkerSpy = vi.fn();
    const fetchSpy = vi.fn();
    beforeEach(() => {
        vi.stubEnv('VITE_FOCUS_MEANING_MATCHER_ENABLED', 'true');
        vi.stubGlobal('Worker', WorkerSpy);
        vi.stubGlobal('fetch', fetchSpy);
        registerObjectiveSource.mockReset().mockResolvedValue({ ok: true });
        startObjectiveSession.mockReset().mockResolvedValue({ ok: true, sessionId: 'objsess-1' });
        finalizeObjectiveEvidence.mockReset().mockResolvedValue(1);
        hoisted.matcher = null;
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllEnvs();
        vi.unstubAllGlobals();
    });

    it('the cap is 3000 ms', () => {
        expect(MEANING_MATCH_TIMEOUT_MS).toBe(3000);
    });

    it('no matcher created yet (user never opted in) → keyword verdict, not_ready, nothing created or fetched', async () => {
        const res = await finalizeObjectiveSessionOnSave(INPUT);
        expect(res).toMatchObject({ ok: true, engine: 'keyword', engineFallback: 'not_ready' });
        expect(res.coverage?.[0]).toMatchObject({ briefPointId: 'p1', status: 'missing' });
        expect(finalizeObjectiveEvidence).toHaveBeenCalledWith('objsess-1', KEYWORD_SIGNALS);
        expect(WorkerSpy).not.toHaveBeenCalled();
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('matcher exists but not ready → keyword verdict, never asks it to match, load or download', async () => {
        const m = stubMatcher(false, async () => null);
        const res = await finalizeObjectiveSessionOnSave(INPUT);
        expect(res).toMatchObject({ ok: true, engine: 'keyword', engineFallback: 'not_ready' });
        expect(m.match).not.toHaveBeenCalled();
        expect(m.ensureLoaded).not.toHaveBeenCalled();
        expect(m.warmFromCache).not.toHaveBeenCalled();
        expect(WorkerSpy).not.toHaveBeenCalled();
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('ready → the model verdict, engine nli, signals from its evidence', async () => {
        const m = stubMatcher(true, async () => [{
            point: 'Customers want faster checkout', status: 'covered', matchRatio: 1,
            evidence: { quote: SEGMENTS[0].text, timestampSec: 8.4 },
        }]);
        const res = await finalizeObjectiveSessionOnSave(INPUT);
        expect(res.ok).toBe(true);
        expect(res.engine).toBe('nli');
        expect(res).not.toHaveProperty('engineFallback');
        expect(res.coverage?.[0]).toMatchObject({ briefPointId: 'p1', point: 'Customers want faster checkout', status: 'covered' });
        expect(finalizeObjectiveEvidence).toHaveBeenCalledWith('objsess-1', [{ brief_point_id: 'p1', detected_at_seconds: 8 }]);
        expect(m.match).toHaveBeenCalledWith(['Customers want faster checkout'], SEGMENTS, { timeoutMs: 3000 });
        expect(m.ensureLoaded).not.toHaveBeenCalled();
    });

    it('no answer within 3000 ms → keyword verdict with a timeout marker', async () => {
        vi.useFakeTimers();
        stubMatcher(true, () => new Promise<never>(() => undefined));
        let settled = false;
        const pending = finalizeObjectiveSessionOnSave(INPUT).then((r) => { settled = true; return r; });
        await vi.advanceTimersByTimeAsync(2999);
        expect(settled).toBe(false);
        await vi.advanceTimersByTimeAsync(2);
        const res = await pending;
        expect(res).toMatchObject({ ok: true, engine: 'keyword', engineFallback: 'timeout' });
        expect(res.coverage?.[0].status).toBe('missing');
        expect(finalizeObjectiveEvidence).toHaveBeenCalledWith('objsess-1', KEYWORD_SIGNALS);
    });

    it('matcher throws → keyword verdict with an error marker', async () => {
        stubMatcher(true, async () => { throw new Error('MEANING_WORKER_ERROR'); });
        const res = await finalizeObjectiveSessionOnSave(INPUT);
        expect(res).toMatchObject({ ok: true, engine: 'keyword', engineFallback: 'error' });
        expect(finalizeObjectiveEvidence).toHaveBeenCalledWith('objsess-1', KEYWORD_SIGNALS);
    });

    it('matcher returns null or a misaligned result → keyword verdict with a no_result marker', async () => {
        stubMatcher(true, async () => null);
        expect(await finalizeObjectiveSessionOnSave(INPUT)).toMatchObject({ engine: 'keyword', engineFallback: 'no_result' });
        stubMatcher(true, async () => []);
        expect(await finalizeObjectiveSessionOnSave(INPUT)).toMatchObject({ engine: 'keyword', engineFallback: 'no_result' });
    });

    it('a failing earlier stage is unchanged by the flag (no matcher consulted)', async () => {
        const m = stubMatcher(true, async () => null);
        registerObjectiveSource.mockResolvedValue({ ok: false, reason: 'ineligible' });
        expect(await finalizeObjectiveSessionOnSave(INPUT)).toEqual({ ok: false, stage: 'register', reason: 'ineligible', registered: false });
        expect(m.match).not.toHaveBeenCalled();
    });
});
