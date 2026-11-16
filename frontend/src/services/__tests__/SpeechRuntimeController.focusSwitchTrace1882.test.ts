// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useSessionStore } from '@/stores/useSessionStore';
import { SpeechRuntimeController } from '../SpeechRuntimeController';

vi.mock('../../lib/logger', () => ({
    default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../lib/storage', () => ({
    saveSession: vi.fn().mockResolvedValue({ session: null, usageExceeded: false }),
    heartbeatSession: vi.fn().mockResolvedValue({ success: true }),
    completeSession: vi.fn().mockResolvedValue({}),
}));
vi.mock('@/services/objective/finalizeObjectiveSessionOnSave', () => ({
    finalizeObjectiveSessionOnSave: vi.fn().mockResolvedValue({
        ok: true,
        coverage: [{ briefPointId: 'fp-0', point: 'Name the price', status: 'covered' }],
    }),
}));
vi.mock('../../lib/supabaseClient', () => ({
    getSupabaseClient: vi.fn(() => ({
        auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) },
    })),
}));

/**
 * #1882: the live journey can only name why the rail is wrong after a product switch if these three
 * trace events actually fire. A live run costs a production release, so prove them here first.
 * The trace is written only when the harness arms `window.__NATIVE_BROWSER_TRACE__`; unarmed, nothing changes.
 */
type TraceWindow = Window & { __NATIVE_BROWSER_TRACE__?: Array<Record<string, unknown>> };
type PrivateController = {
    capturedUserId: string | null;
    snapshotProgressModeAtRecordingBoundary: () => { mode: string };
    completeProgressForRecording: (
        context: unknown, sessionId: string, attributionStatus: string | undefined,
        metricsPersisted: boolean, canPublishShared: () => boolean,
    ) => Promise<{ kind: string; reason?: string }>;
};

const newController = (): PrivateController => {
    const Controller = SpeechRuntimeController as unknown as new () => SpeechRuntimeController;
    const c = new Controller() as unknown as PrivateController;
    c.capturedUserId = 'owner-1';
    return c;
};

const brief = { projectId: 'p-1', briefId: 'b-1', points: ['Name the price'], topic: 't', paceGuideSecPerPoint: 60 };
const focusContext = {
    mode: 'focus_points',
    brief: { projectId: 'p-1', briefId: 'b-1' },
    segments: [{ text: 'name the price', startSec: 0 }],
    durationSeconds: 30,
};
const traceWindow = () => window as TraceWindow;
const events = (name: string) => (traceWindow().__NATIVE_BROWSER_TRACE__ ?? []).filter((e) => e.event === name);

describe('#1882 Focus switch-take trace', () => {
    beforeEach(() => {
        const store = useSessionStore.getState();
        store.setActiveObjectiveBrief(null);
        store.setCompletedObjectiveBrief(null);
        store.setObjectiveCoverageResult(null);
        delete traceWindow().__NATIVE_BROWSER_TRACE__;
    });
    afterEach(() => {
        delete traceWindow().__NATIVE_BROWSER_TRACE__;
    });

    it('records nothing when the harness has not armed the trace', async () => {
        const outcome = await newController().completeProgressForRecording(focusContext, 's-1', 'verified', false, () => true);

        expect(outcome).toEqual({ kind: 'unresolved', reason: 'metrics_not_persisted' });
        expect(traceWindow().__NATIVE_BROWSER_TRACE__).toBeUndefined();
    });

    it('records the product decided at Start', () => {
        traceWindow().__NATIVE_BROWSER_TRACE__ = [];
        const c = newController();

        expect(c.snapshotProgressModeAtRecordingBoundary().mode).toBe('open_mic');
        useSessionStore.getState().setActiveObjectiveBrief(brief as never);
        expect(c.snapshotProgressModeAtRecordingBoundary().mode).toBe('focus_points');

        expect(events('controller_progress_mode_snapshot').map((e) => [e.mode, e.pointCount])).toEqual([
            ['open_mic', 0],
            ['focus_points', 1],
        ]);
    });

    it('records a Focus take that returns before saving its metrics, and never publishes its completed brief', async () => {
        traceWindow().__NATIVE_BROWSER_TRACE__ = [];

        await newController().completeProgressForRecording(focusContext, 's-2', 'verified', false, () => true);

        expect(events('controller_progress_unresolved')).toEqual([
            expect.objectContaining({ mode: 'focus_points', reason: 'metrics_not_persisted' }),
        ]);
        expect(events('controller_completed_brief')).toEqual([]);
        expect(useSessionStore.getState().completedObjectiveBrief).toBeNull();
    });

    it('records an unknown retry context as unresolved', async () => {
        traceWindow().__NATIVE_BROWSER_TRACE__ = [];

        await newController().completeProgressForRecording({ mode: 'unknown' }, 's-3', 'verified', true, () => true);

        expect(events('controller_progress_unresolved')).toEqual([
            expect.objectContaining({ mode: 'unknown', reason: 'unknown_mode' }),
        ]);
    });

    it('records whether the completed brief was published, for an owned and a stale take', async () => {
        traceWindow().__NATIVE_BROWSER_TRACE__ = [];
        useSessionStore.getState().setActiveObjectiveBrief(brief as never);

        await newController().completeProgressForRecording(focusContext, 's-4', 'verified', true, () => true);
        await newController().completeProgressForRecording(focusContext, 's-5', 'verified', true, () => false);

        expect(events('controller_completed_brief').map((e) => e.published)).toEqual([true, false]);
    });

    it('records states and counts only: no ids, transcript, audio or tokens', async () => {
        traceWindow().__NATIVE_BROWSER_TRACE__ = [];
        useSessionStore.getState().setActiveObjectiveBrief(brief as never);
        const c = newController();

        c.snapshotProgressModeAtRecordingBoundary();
        await c.completeProgressForRecording(focusContext, 's-6', 'verified', false, () => true);
        await c.completeProgressForRecording({ mode: 'unknown' }, 's-7', 'verified', true, () => true);
        await c.completeProgressForRecording(focusContext, 's-8', 'verified', true, () => true);

        const allowed: Record<string, string[]> = {
            controller_progress_mode_snapshot: ['t', 'event', 'mode', 'pointCount'],
            controller_progress_unresolved: ['t', 'event', 'mode', 'reason'],
            controller_completed_brief: ['t', 'event', 'published'],
        };
        const ours = (traceWindow().__NATIVE_BROWSER_TRACE__ ?? []).filter((e) => String(e.event) in allowed);
        expect(new Set(ours.map((e) => e.event))).toEqual(new Set(Object.keys(allowed)));
        for (const e of ours) expect([String(e.event), Object.keys(e).sort()]).toEqual([String(e.event), [...allowed[String(e.event)]].sort()]);
    });
});
