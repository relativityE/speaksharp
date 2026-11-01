// @vitest-environment jsdom
//
// #1265 — DIRECT controller proof of the Focus Points Progress-cohort gate. A Focus Points recording's
// Progress must be evaluated ONLY after its objective registration DURABLY lands, so the server cohorts it
// 'objective', never 'freeform'. This exercises the extracted controller seam
// (finalizeObjectiveAndGateProgress) with a stubbed finalize, asserting the gate calls the Progress
// evaluator in exactly the right cases:
//   • register failure (registered=false) -> NO evaluation;
//   • later objective-stage failure but registered=true -> evaluation STILL runs;
//   • ambiguous throw (finalize rejects) -> NO evaluation, swallowed (non-fatal).
// The fourth required case — Open Mic immediate (no brief -> evaluate at once) — is proven by
// '#1045: the completed-save journey wires the Progress evaluation seam' in SpeechRuntimeController.test.ts
// (a private session with no objective brief invokes wireProgressEvaluationOnSave directly).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { SpeechRuntimeController } from '../SpeechRuntimeController';
import { useSessionStore } from '@/stores/useSessionStore';
import { render, screen } from '../../../tests/support/test-utils';
import { SessionOverhaulView } from '@/components/session/SessionOverhaulView';
import type { SttStatus } from '@/types/transcription';

// Most controller-gate cases isolate the seam. The composed cases below switch the same wrapper to the
// REAL finalizer while keeping only its transport/persistence boundaries deterministic.
const objectiveHarness = vi.hoisted(() => ({
    useRealFinalizer: false,
    finalizeOverride: vi.fn(),
    registerObjectiveSource: vi.fn(),
    startObjectiveSession: vi.fn(),
    finalizeObjectiveEvidence: vi.fn(),
    pointsRows: [] as Array<{ id: string; label: string; cue: string | null; sort_order: number }>,
    pointsError: null as unknown,
}));
const finalizeObjectiveSessionOnSave = objectiveHarness.finalizeOverride;
vi.mock('@/services/objective/finalizeObjectiveSessionOnSave', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/services/objective/finalizeObjectiveSessionOnSave')>();
    return {
        ...actual,
        finalizeObjectiveSessionOnSave: (...args: Parameters<typeof actual.finalizeObjectiveSessionOnSave>) => (
            objectiveHarness.useRealFinalizer
                ? actual.finalizeObjectiveSessionOnSave(...args)
                : objectiveHarness.finalizeOverride(...args)
        ),
    };
});
vi.mock('@/services/objective/objectiveSessionService', () => ({
    registerObjectiveSource: (...args: unknown[]) => objectiveHarness.registerObjectiveSource(...args),
    startObjectiveSession: (...args: unknown[]) => objectiveHarness.startObjectiveSession(...args),
    finalizeObjectiveEvidence: (...args: unknown[]) => objectiveHarness.finalizeObjectiveEvidence(...args),
}));
vi.mock('@/lib/supabaseClient', () => ({
    getSupabaseClient: () => ({
        from: () => ({
            select: () => ({
                eq: () => ({
                    order: async () => ({ data: objectiveHarness.pointsRows, error: objectiveHarness.pointsError }),
                }),
            }),
        }),
    }),
}));
vi.mock('../../lib/logger', () => ({
    default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), trace: vi.fn() },
}));

type Gate = (
    brief: { projectId: string; briefId: string },
    sessionId: string,
    segments: { text: string; startSec: number }[],
    durationSeconds: number,
    runProgressEval: () => void,
    // #1431 P1 — REQUIRED, not defaulted. The coverage rail and the Progress gate are shared state,
    // and the parameter used to default to `() => true`, which is a fail-OPEN default on a guard: a
    // caller that omitted it silently got permission to publish into whatever take is current. Every
    // caller now states its authority, including this one.
    canPublishShared: () => boolean,
    // #1354: the seam RETURNS an outcome — it was `void` before the gate existed, and a stale `void`
    // here silently hides the value every case-5 assertion depends on.
) => Promise<{ kind: string; reason?: string }>;

const BRIEF = { projectId: 'proj', briefId: 'brief' };

describe('#1265 SpeechRuntimeController — Focus Points Progress gating (direct)', () => {
    let gate: Gate;
    let runProgressEval: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        objectiveHarness.useRealFinalizer = false;
        finalizeObjectiveSessionOnSave.mockReset();
        objectiveHarness.registerObjectiveSource.mockReset();
        objectiveHarness.startObjectiveSession.mockReset();
        objectiveHarness.finalizeObjectiveEvidence.mockReset();
        objectiveHarness.pointsRows = [];
        objectiveHarness.pointsError = null;
        runProgressEval = vi.fn();
        useSessionStore.getState().setObjectiveCoverageResult(null);
        delete window.__PRIVATE_OBJECTIVE_PUBLICATIONS_ENABLED__;
        delete window.__PRIVATE_OBJECTIVE_PUBLICATIONS__;
        const controller = SpeechRuntimeController.getInstance();
        gate = (controller as unknown as { finalizeObjectiveAndGateProgress: Gate })
            .finalizeObjectiveAndGateProgress.bind(controller);
    });

    it('register failure (registered=false) records NO objective Progress evaluation', async () => {
        finalizeObjectiveSessionOnSave.mockResolvedValue({ ok: false, stage: 'register', reason: 'ineligible', registered: false });
        await gate(BRIEF, 'sess-reg-fail', [], 60, runProgressEval, () => true);
        expect(runProgressEval).not.toHaveBeenCalled();
        expect(useSessionStore.getState().objectiveCoverageResult).toBeNull(); // no rail on a failed register
    });

    it('later objective-stage failure but registered=true STILL evaluates (cohorted objective, not freeform)', async () => {
        finalizeObjectiveSessionOnSave.mockResolvedValue({ ok: false, stage: 'finalize', reason: 'error', registered: true });
        await gate(BRIEF, 'sess-late-fail', [], 60, runProgressEval, () => true);
        expect(runProgressEval).toHaveBeenCalledTimes(1);           // the recording IS a confirmed objective source
        expect(useSessionStore.getState().objectiveCoverageResult).toBeNull(); // but no rail on a failed finalize
    });

    it('ambiguous throw (finalize rejects) records NO evaluation and is swallowed (non-fatal)', async () => {
        finalizeObjectiveSessionOnSave.mockRejectedValue(new Error('network blip mid-finalize'));
        // #1354: the gate now RETURNS an outcome instead of `void`. An ambiguous throw leaves the
        // registration state unknown, so it must resolve to `unresolved` — which blocks the next
        // recording — rather than to a value that would let the recorder reopen.
        await expect(gate(BRIEF, 'sess-throw', [], 60, runProgressEval, () => true))
            .resolves.toEqual({ kind: 'unresolved', reason: 'queue_unavailable' });
        expect(runProgressEval).not.toHaveBeenCalled();             // unknown registration state -> fail closed
    });

    it('#1354 CASE 5: a DEFINITIVE registration refusal is terminal and unlocks', async () => {
        // The server answered: nothing was written, nothing is owed, and no evaluation will ever
        // arrive. That is an ACCEPTED terminal reason — it unlocks — but reporting `recorded` would be
        // a lie about durability and would mask a genuine evaluation failure behind the same value.
        finalizeObjectiveSessionOnSave.mockResolvedValue({ ok: false, stage: 'register', reason: 'denied', registered: false });
        await expect(gate(BRIEF, 'sess-unreg', [], 60, runProgressEval, () => true))
            .resolves.toEqual({ kind: 'not_applicable', reason: 'not_completed' });
        expect(runProgressEval).not.toHaveBeenCalled();
    });

    it('#1354 CASE 5: an UNCONFIRMED registration must NOT be relabelled not_completed', async () => {
        // UPDATED CONTRACT. This previously asserted that ANY `registered: false` unlocks. It does not:
        // a throw before registration also reports `registered: false` (and, per this result type's own
        // contract, LOSES the stage), so the write may have reached the server. Treating that as an
        // accepted terminal exclusion unlocks the recorder on an assumption nobody proved. Pending,
        // missing and unknown stay blocked — while still never claiming an evaluation was recorded.
        finalizeObjectiveSessionOnSave.mockResolvedValue({ ok: false, reason: 'error', registered: false });
        const outcome = await gate(BRIEF, 'sess-unconfirmed', [], 60, runProgressEval, () => true);
        expect(outcome.kind).toBe('unresolved');
        expect(outcome.kind).not.toBe('recorded');
        expect(runProgressEval).not.toHaveBeenCalled();
    });

    it('#1354: a REGISTERED take returns the evaluation outcome unchanged', async () => {
        finalizeObjectiveSessionOnSave.mockResolvedValue({ ok: true, registered: true });
        runProgressEval.mockResolvedValue({ kind: 'queued' });
        await expect(gate(BRIEF, 'sess-reg', [], 60, runProgressEval, () => true)).resolves.toEqual({ kind: 'queued' });
    });

    it('full success (registered + coverage) evaluates AND publishes the per-point rail', async () => {
        finalizeObjectiveSessionOnSave.mockResolvedValue({
            ok: true, registered: true, objectiveSessionId: 'o1', evidenceCount: 1,
            coverage: [{ briefPointId: 'p1', point: 'pricing', status: 'covered' }],
        });
        await gate(BRIEF, 'sess-ok', [], 60, runProgressEval, () => true);
        expect(runProgressEval).toHaveBeenCalledTimes(1);
        expect(useSessionStore.getState().objectiveCoverageResult).toEqual([{ id: 'p1', label: 'pricing', status: 'covered' }]);
    });

    it('composes controller → real finalizer → store → rendered terminal rail', async () => {
        objectiveHarness.useRealFinalizer = true;
        window.__PRIVATE_OBJECTIVE_PUBLICATIONS_ENABLED__ = true;
        objectiveHarness.registerObjectiveSource.mockResolvedValue({ ok: true });
        objectiveHarness.startObjectiveSession.mockResolvedValue({ ok: true, sessionId: 'objective-session' });
        objectiveHarness.pointsRows = [
            { id: 'p1', label: 'pricing cost', cue: null, sort_order: 0 },
            { id: 'p2', label: 'support guarantee', cue: null, sort_order: 1 },
        ];
        objectiveHarness.finalizeObjectiveEvidence.mockResolvedValue(2);
        await gate(
            BRIEF,
            'composed-take',
            [{ text: 'our pricing cost is predictable', startSec: 8 }],
            60,
            runProgressEval,
            () => true,
        );
        const authority = useSessionStore.getState().objectiveCoverageResult;
        expect(authority).toEqual([
            { id: 'p1', label: 'pricing cost', status: 'covered' },
            { id: 'p2', label: 'support guarantee', status: 'missing' },
        ]);
        expect(objectiveHarness.finalizeObjectiveEvidence).toHaveBeenCalledWith('objective-session', [
            { brief_point_id: 'p1', detected_at_seconds: 8 },
            { brief_point_id: 'p2', detected_at_seconds: null },
        ]);
        useSessionStore.setState({ progressGate: null, progressGateResolvedFor: 'viewer', captureLive: false });
        render(React.createElement(SessionOverhaulView, {
            authUserId: 'viewer',
            isListening: false,
            sttStatus: { type: 'idle' } as SttStatus,
            elapsedTime: 0,
            scoringElapsedSeconds: 60,
            micLevel: 0,
            transcriptContent: '',
            reviewTranscript: { kind: 'available', text: 'our pricing cost is predictable' },
            showAnalyticsPrompt: true,
            metricsFillerCount: 0,
            onStartStop: vi.fn(),
            history: [],
            completedObjectivePoints: ['pricing cost', 'support guarantee'],
            objectiveCoverage: authority,
        }));
        expect(screen.getByTestId('focus-point-0')).toHaveAttribute('data-status', 'covered');
        expect(screen.getByTestId('focus-point-1')).toHaveAttribute('data-status', 'missing');
        const witness = (await window.__PRIVATE_OBJECTIVE_PUBLICATIONS__?.read() ?? []).at(-1);
        expect(witness).toMatchObject({ pointCount: 2, coveredCount: 1, missingCount: 1 });
    });

    it.each([
        ['registration transport refuses', { register: { ok: false, reason: 'ineligible' }, start: null, finalize: null }],
        ['session persistence refuses', { register: { ok: true }, start: { ok: false, reason: 'persistence' }, finalize: null }],
        ['evidence persistence refuses', { register: { ok: true }, start: { ok: true, sessionId: 'objective-session' }, finalize: null }],
    ])('real finalizer keeps %s separate and publishes neither store authority nor witness', async (_label, setup) => {
        objectiveHarness.useRealFinalizer = true;
        window.__PRIVATE_OBJECTIVE_PUBLICATIONS_ENABLED__ = true;
        objectiveHarness.pointsRows = [{ id: 'p1', label: 'pricing cost', cue: null, sort_order: 0 }];
        objectiveHarness.registerObjectiveSource.mockResolvedValue(setup.register);
        if (setup.start) objectiveHarness.startObjectiveSession.mockResolvedValue(setup.start);
        if (setup.finalize !== undefined) objectiveHarness.finalizeObjectiveEvidence.mockResolvedValue(setup.finalize);
        const before = await window.__PRIVATE_OBJECTIVE_PUBLICATIONS__?.read() ?? [];
        await gate(BRIEF, 'failed-composed-take', [{ text: 'pricing cost', startSec: 2 }], 30, runProgressEval, () => true);
        expect(useSessionStore.getState().objectiveCoverageResult).toBeNull();
        expect(await window.__PRIVATE_OBJECTIVE_PUBLICATIONS__?.read() ?? []).toHaveLength(before.length);
    });

    it('emits one opt-in content-free witness only after the current take publishes', async () => {
        window.__PRIVATE_OBJECTIVE_PUBLICATIONS_ENABLED__ = true;
        finalizeObjectiveSessionOnSave.mockResolvedValue({
            ok: true, registered: true, objectiveSessionId: 'o-private', evidenceCount: 2,
            coverage: [
                { briefPointId: 'private-point-1', point: 'private label one', status: 'covered' },
                { briefPointId: 'private-point-2', point: 'private label two', status: 'partial' },
            ],
        });
        await gate(BRIEF, 'private-session-id', [], 60, runProgressEval, () => true);
        const rows = await window.__PRIVATE_OBJECTIVE_PUBLICATIONS__?.read() ?? [];
        const witness = rows.at(-1) as Record<string, unknown>;
        expect(witness).toMatchObject({
            schema: 'speaksharp.objective-publication.v1', pointCount: 2,
            coveredCount: 1, partialCount: 1, missingCount: 0,
        });
        expect(witness.sessionSha256).toMatch(/^[a-f0-9]{64}$/);
        expect(witness.statusChainSha256).toMatch(/^[a-f0-9]{64}$/);
        const serialized = JSON.stringify(witness);
        for (const privateValue of ['private-session-id', 'private-point-1', 'private-point-2', 'private label one', 'private label two']) {
            expect(serialized).not.toContain(privateValue);
        }
    });

    it('does not witness failed or stale/suppressed finalization envelopes', async () => {
        window.__PRIVATE_OBJECTIVE_PUBLICATIONS_ENABLED__ = true;
        const before = await window.__PRIVATE_OBJECTIVE_PUBLICATIONS__?.read() ?? [];
        finalizeObjectiveSessionOnSave.mockResolvedValue({
            ok: false, stage: 'finalize', reason: 'error', registered: true,
        });
        await gate(BRIEF, 'empty-session', [], 0, runProgressEval, () => true);
        finalizeObjectiveSessionOnSave.mockResolvedValue({
            ok: true, registered: true,
            coverage: [{ briefPointId: 'stale', point: 'must not publish', status: 'covered' }],
        });
        useSessionStore.getState().setObjectiveCoverageResult([{ id: 'newer', label: 'newer take', status: 'missing' }]);
        await gate(BRIEF, 'stale-session', [], 60, runProgressEval, () => false);
        expect(useSessionStore.getState().objectiveCoverageResult).toEqual([{ id: 'newer', label: 'newer take', status: 'missing' }]);
        expect(await window.__PRIVATE_OBJECTIVE_PUBLICATIONS__?.read() ?? []).toHaveLength(before.length);
    });

    it('does not publish before delayed registration/finalization settles', async () => {
        window.__PRIVATE_OBJECTIVE_PUBLICATIONS_ENABLED__ = true;
        let release!: (value: unknown) => void;
        finalizeObjectiveSessionOnSave.mockReturnValue(new Promise((resolve) => { release = resolve; }));
        const pending = gate(BRIEF, 'delayed-session', [], 60, runProgressEval, () => true);
        await Promise.resolve();
        expect(window.__PRIVATE_OBJECTIVE_PUBLICATIONS__).toBeUndefined();
        release({ ok: true, registered: true, coverage: [{ briefPointId: 'p1', point: 'point', status: 'missing' }] });
        await pending;
        const rows = await window.__PRIVATE_OBJECTIVE_PUBLICATIONS__?.read() ?? [];
        expect(rows.at(-1)).toMatchObject({ pointCount: 1, missingCount: 1 });
    });

    it('keeps publication order fixed when asynchronous hashes resolve out of order', async () => {
        window.__PRIVATE_OBJECTIVE_PUBLICATIONS_ENABLED__ = true;
        finalizeObjectiveSessionOnSave.mockResolvedValue({
            ok: true, registered: true,
            coverage: [{ briefPointId: 'p1', point: 'point', status: 'covered' }],
        });
        const resolvers: Array<(value: ArrayBuffer) => void> = [];
        const digest = vi.spyOn(globalThis.crypto.subtle, 'digest').mockImplementation(
            () => new Promise<ArrayBuffer>((resolve) => resolvers.push(resolve)),
        );
        try {
            await gate(BRIEF, 'ordered-first', [], 60, runProgressEval, () => true);
            await gate(BRIEF, 'ordered-second', [], 60, runProgressEval, () => true);
            resolvers[2](new Uint8Array(32).fill(3).buffer);
            resolvers[3](new Uint8Array(32).fill(4).buffer);
            await Promise.resolve();
            resolvers[0](new Uint8Array(32).fill(1).buffer);
            resolvers[1](new Uint8Array(32).fill(2).buffer);
            const rows = await window.__PRIVATE_OBJECTIVE_PUBLICATIONS__?.read() ?? [];
            const [first, second] = rows.slice(-2) as Array<Record<string, unknown>>;
            expect(first.sequence as number).toBeLessThan(second.sequence as number);
            expect(first.createdAtMs as number).toBeLessThanOrEqual(second.createdAtMs as number);
            expect(first.sessionSha256).toBe('01'.repeat(32));
            expect(second.sessionSha256).toBe('03'.repeat(32));
        } finally {
            digest.mockRestore();
        }
    });

    it('bounds nonsettling hashes and returns witness reads by a deadline', async () => {
        window.__PRIVATE_OBJECTIVE_PUBLICATIONS_ENABLED__ = true;
        finalizeObjectiveSessionOnSave.mockResolvedValue({
            ok: true, registered: true,
            coverage: [{ briefPointId: 'p1', point: 'point', status: 'missing' }],
        });
        const digest = vi.spyOn(globalThis.crypto.subtle, 'digest').mockImplementation(
            () => new Promise<ArrayBuffer>(() => undefined),
        );
        try {
            await gate(BRIEF, 'stuck-one', [], 60, runProgressEval, () => true);
            const before = await window.__PRIVATE_OBJECTIVE_PUBLICATIONS__?.read() ?? [];
            await gate(BRIEF, 'stuck-two', [], 60, runProgressEval, () => true);
            await gate(BRIEF, 'stuck-three-evicts-oldest', [], 60, runProgressEval, () => true);
            const started = performance.now();
            const rows = await window.__PRIVATE_OBJECTIVE_PUBLICATIONS__?.read() ?? [];
            expect(performance.now() - started).toBeLessThan(500);
            expect(rows).toHaveLength(before.length);
        } finally {
            digest.mockRestore();
        }
        await gate(BRIEF, 'hashing-recovers', [], 60, runProgressEval, () => true);
        const recovered = await window.__PRIVATE_OBJECTIVE_PUBLICATIONS__?.read() ?? [];
        expect(recovered.at(-1)?.sequence).toBeGreaterThan(0);
    });
});

/**
 * #1258 item 5 (PM 6216341052) — `evaluation_complete` is produced at the take's successful, settled, OWNED Focus
 * evaluation (this seam), never by a render. Stop awaits this seam before it resolves and the hook marks `session_saved`
 * after Stop resolves, so the strict same-attempt chain order holds. Failed, unknown or stale finalizations never mark it.
 */
describe('#1258 item 5 — the evaluation_complete producer is the owned, successful Focus finalization', () => {
    let gate: Gate;
    let runProgressEval: ReturnType<typeof vi.fn>;
    let stages: typeof import('@/services/telemetry/completionStages');

    beforeEach(async () => {
        finalizeObjectiveSessionOnSave.mockReset();
        runProgressEval = vi.fn();
        useSessionStore.getState().setObjectiveCoverageResult(null);
        stages = await import('@/services/telemetry/completionStages');
        stages.__resetCompletionStagesForTests();
        const controller = SpeechRuntimeController.getInstance();
        gate = (controller as unknown as { finalizeObjectiveAndGateProgress: Gate })
            .finalizeObjectiveAndGateProgress.bind(controller);
    });

    const success = { ok: true, objectiveSessionId: 'obj', evidenceCount: 1, registered: true,
        coverage: [{ briefPointId: 'p1', point: 'Point one', status: 'covered' }] };

    // The POSITIVE emission proof — actual captured stage_latency rows, their emission order against session_saved, and
    // the shared attempt identity — lives in SpeechRuntimeController.evaluationCompleteEmission1258.test.ts (Sam
    // 6217644163): `reachedStages()` sorts by the constant chain, so it can only prove ABSENCE, which the cases below do.

    it('a STALE take (no longer owns shared state) never marks it — a later take\'s chain is not this one\'s', async () => {
        finalizeObjectiveSessionOnSave.mockResolvedValue(success);
        await gate(BRIEF, 'sess-stale', [], 60, runProgressEval, () => false);
        expect(stages.reachedStages()).not.toContain('evaluation_complete');
    });

    it.each([
        ['a refused registration', { ok: false, stage: 'register', reason: 'ineligible', registered: false }],
        ['a later-stage failure (registered, no coverage verdict)', { ok: false, stage: 'finalize', reason: 'error', registered: true }],
        ['a success envelope with no coverage', { ...success, coverage: undefined }],
    ])('%s never marks it — the chain HOLDs rather than claiming an evaluation that did not succeed', async (_label, result) => {
        finalizeObjectiveSessionOnSave.mockResolvedValue(result);
        await gate(BRIEF, 'sess-fail', [], 60, runProgressEval, () => true);
        expect(stages.reachedStages()).not.toContain('evaluation_complete');
    });

    it('an ambiguous throw (unknown outcome) never marks it', async () => {
        finalizeObjectiveSessionOnSave.mockRejectedValue(new Error('network'));
        await gate(BRIEF, 'sess-throw', [], 60, runProgressEval, () => true);
        expect(stages.reachedStages()).not.toContain('evaluation_complete');
    });
    // Once-per-take marking (a Retry Save re-entering this seam) is markCompletionStage's own rule, proven in
    // completionStages.test.ts; it is not re-proven here.
});
