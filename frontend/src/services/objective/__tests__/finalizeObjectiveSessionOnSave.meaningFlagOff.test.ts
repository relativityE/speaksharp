/**
 * Default-off meaning matcher — FLAG OFF ISOLATION. With `VITE_FOCUS_MEANING_MATCHER_ENABLED` anything but the exact
 * string 'true', finalize is today's keyword path: the meaning module is never imported, no worker is constructed,
 * nothing is fetched, and the result carries no engine fields.
 *
 * Its own file on purpose: a module-import counter is only meaningful before anything in the file imports it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({ meaningModuleImports: 0 }));
vi.mock('../meaning/MeaningMatcher', () => {
    hoisted.meaningModuleImports += 1;
    return { peekMeaningMatcher: () => null };
});

const registerObjectiveSource = vi.fn();
const startObjectiveSession = vi.fn();
const finalizeObjectiveEvidence = vi.fn();
vi.mock('../objectiveSessionService', () => ({
    registerObjectiveSource: (...a: unknown[]) => registerObjectiveSource(...a),
    startObjectiveSession: (...a: unknown[]) => startObjectiveSession(...a),
    finalizeObjectiveEvidence: (...a: unknown[]) => finalizeObjectiveEvidence(...a),
}));
const order = vi.fn(() => Promise.resolve({ data: [{ id: 'p1', label: 'pricing cost', cue: null, sort_order: 0 }], error: null }));
vi.mock('@/lib/supabaseClient', () => ({
    getSupabaseClient: () => ({ from: () => ({ select: () => ({ eq: () => ({ order }) }) }) }),
}));
vi.mock('@/lib/logger', () => ({ default: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn(), trace: vi.fn() } }));

import { finalizeObjectiveSessionOnSave } from '../finalizeObjectiveSessionOnSave';
import { computeObjectiveCoverage } from '../objectiveCoverage';

const SEGMENTS = [{ text: 'we cover pricing and cost clearly', startSec: 8 }];
const INPUT = { projectId: 'proj', briefId: 'brief', sourceSessionId: 'src', idempotencyKey: 'idem', segments: SEGMENTS, durationSeconds: 60 };

describe('meaning matcher flag OFF — finalize is the keyword path, untouched', () => {
    const WorkerSpy = vi.fn();
    const fetchSpy = vi.fn();
    beforeEach(() => {
        registerObjectiveSource.mockResolvedValue({ ok: true });
        startObjectiveSession.mockResolvedValue({ ok: true, sessionId: 'objsess-1' });
        finalizeObjectiveEvidence.mockResolvedValue(1);
        vi.stubGlobal('Worker', WorkerSpy);
        vi.stubGlobal('fetch', fetchSpy);
    });
    afterEach(() => {
        vi.unstubAllEnvs();
        vi.unstubAllGlobals();
    });

    it.each([undefined, '', 'false', 'TRUE', '1', ' true'])('flag=%j: keyword verdict, no engine fields, no meaning module/worker/fetch', async (value) => {
        if (value === undefined) vi.stubEnv('VITE_FOCUS_MEANING_MATCHER_ENABLED', undefined as unknown as string);
        else vi.stubEnv('VITE_FOCUS_MEANING_MATCHER_ENABLED', value);

        const res = await finalizeObjectiveSessionOnSave(INPUT);

        const expected = computeObjectiveCoverage([{ id: 'p1', label: 'pricing cost', cue: null }], SEGMENTS, 60);
        expect(res).toEqual({ ok: true, objectiveSessionId: 'objsess-1', evidenceCount: 1, coverage: expected.coverage, registered: true });
        expect(Object.keys(res).sort()).toEqual(['coverage', 'evidenceCount', 'objectiveSessionId', 'ok', 'registered']);
        expect(finalizeObjectiveEvidence).toHaveBeenLastCalledWith('objsess-1', expected.signals);
        expect(hoisted.meaningModuleImports).toBe(0);
        expect(WorkerSpy).not.toHaveBeenCalled();
        expect(fetchSpy).not.toHaveBeenCalled();
    });
});
