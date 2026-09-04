// @vitest-environment jsdom
/**
 * #1403 RETURN — A RECOVERED TAKE MUST LOOK RECOVERED.
 *
 * Both retry paths cleared their retry state and returned success without republishing the save marker.
 * The DOM therefore kept reporting the state at the moment of the ORIGINAL failure:
 *
 *   - an attribution-only recovery stayed `saved-attribution-pending` while the database had become
 *     terminally attributed, so the observer HELD a take that was in fact clean;
 *   - a recovered full-save failure had no persistence marker at all, because the original failure
 *     correctly published none — so the observer never recorded `stop-save` for it.
 *
 * The recovery journey is part of Stage 1, so either one would have produced misleading evidence.
 *
 * NOTHING HERE IS MOCKED BETWEEN THE PARTS UNDER TEST. These drive the real controller retry methods,
 * which write through the real `syncSessionPersisted` to a real DOM; the observer's own `IDENTITY_PROBE`
 * is then evaluated exactly as CDP evaluates it, and the observer's own `receiptVerdict` judges the
 * result. Only the network boundary — attestation, completion, the Progress write — is stubbed, because
 * that is the server, not the behaviour being proven.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SpeechRuntimeController } from '../SpeechRuntimeController';
// The observer is plain ESM outside the typed frontend tree and ships no declarations. Importing the
// REAL module is the whole point — a typed re-declaration here would be a second copy of the contract,
// and the drift between the two is exactly what these tests exist to catch.
// @ts-expect-error -- untyped ESM, imported deliberately
import { IDENTITY_PROBE, receiptVerdict } from '../../../../scripts/human-test/observer.mjs';

vi.mock('../../lib/logger', () => ({
    default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const SESSION = '9f1c0f4a-6d2e-4a1b-9c7d-2b8e5a3f10cc';
const OTHER = 'b2d0c8e1-1111-4111-8111-222222222222';
const RELEASE = 'a19324610634b9e05a375fff8838f2bbbae3a4f1';
const CANDIDATE = 'moonshine:streaming-medium';
const APP = 'https://speaksharp-public.vercel.app';

type PrivateController = {
    retryPendingAttribution: () => Promise<boolean>;
    retryRecordingSave: () => Promise<boolean>;
    updateSessionPersisted: (p: boolean, d?: { sessionId?: string | null; mode?: string | null }) => void;
    pendingAttributionRetry: unknown;
    pendingFullSaveRetry: unknown;
    attestSessionEngine: (id: string, ev: unknown) => Promise<{ attributed: boolean } | null>;
    completeProgressForRecording: (...a: unknown[]) => Promise<void>;
    markRecordingResolved: () => void;
    sessionId: string | null;
    applyPrivateTelemetryContext: () => void;
};
const priv = () => SpeechRuntimeController.getInstance() as unknown as PrivateController;

/** The observer's real probe, evaluated against the real document. */
const runProbe = () => new Function(`return ${IDENTITY_PROBE}`)();

/** The observer's real verdict. Everything except persistence is staged clean, so any HOLD is ours. */
const receipt = (probe: unknown) => receiptVerdict({
    probe, expectedCandidate: CANDIDATE, expectedRelease: RELEASE,
    payloads: [], sockets: [], phases: ['pre-record', 'recording', 'stop-save', 'terminal'],
    appOrigin: APP,
    workerInstrumentation: {
        attached: 1, installed: 1, installFailures: 0, drained: 1, drainFailures: 0,
        mainTripwireInstalled: true, networkEnabled: 1, networkFailures: 0, setupPending: 0,
    },
    egress: [],
});

function stageCleanTake() {
    const root = document.documentElement;
    root.setAttribute('data-runtime-state', 'READY');
    root.setAttribute('data-model-status', 'ready');
    (window as unknown as Record<string, unknown>).__APP_RELEASE__ = RELEASE;
    (window as unknown as Record<string, unknown>).__SS_ACTIVE_CANDIDATE__ = () => ({
        requested: CANDIDATE, observed: CANDIDATE, matches: true, source: 'runtime-switch',
    });
}

/** The state the product is in after an attribution write failed: saved, but not attributed. */
function stageAttributionFailure(sessionId = SESSION) {
    const c = priv();
    c.pendingAttributionRetry = {
        sessionId, evidence: null, progressContext: { mode: 'private' },
        progressMetrics: { payload: null, persisted: false },
    };
    c.updateSessionPersisted(true, { sessionId, mode: 'private' });
}

beforeEach(() => {
    for (const a of [...document.documentElement.attributes]) {
        document.documentElement.removeAttribute(a.name);
    }
    stageCleanTake();
    const c = priv();
    c.pendingAttributionRetry = null;
    c.pendingFullSaveRetry = null;
    c.sessionId = null;
    // The SERVER boundary only. Success by default; individual cases override.
    c.attestSessionEngine = vi.fn(async () => ({ attributed: true }));
    c.completeProgressForRecording = vi.fn(async () => {});
    c.markRecordingResolved = vi.fn(() => {});
    c.applyPrivateTelemetryContext = vi.fn(() => {});
});

describe('#1403 attribution-only recovery republishes the receipt', () => {
    it('CONTROL: the initial failure publishes pending, and the verdict HOLDS', () => {
        stageAttributionFailure();
        const probe = runProbe();
        expect(probe.sessionPersisted).toBe('true');
        expect(probe.persistedSessionId).toBe(SESSION);
        expect(probe.persistedStatus).toBe('saved-attribution-pending');
        const out = receipt(probe);
        expect(out.verdict).toBe('HOLD');
        expect(out.problems.join(' ')).toMatch(/saved-attribution-pending/);
    });

    it('CASUALTY: a SUCCESSFUL retry republishes `saved`, and the same take then PASSES', async () => {
        stageAttributionFailure();
        const ok = await priv().retryPendingAttribution();
        expect(ok).toBe(true);

        const probe = runProbe();
        expect(probe.persistedStatus, 'the DOM still reported the original failure').toBe('saved');
        expect(probe.persistedSessionId, 'the same session, never a new one').toBe(SESSION);
        expect(probe.sessionPersisted).toBe('true');

        const out = receipt(probe);
        expect(out.problems, `unexpected holds: ${out.problems.join(' | ')}`).toEqual([]);
        expect(out.verdict, 'a recovered take must be able to pass').toBe('PASS');
    });

    it('CASUALTY: a transient failure republishes NOTHING and the take stays held', async () => {
        stageAttributionFailure();
        priv().attestSessionEngine = vi.fn(async () => null); // null = transient, stays retryable
        const ok = await priv().retryPendingAttribution();
        expect(ok).toBe(false);
        expect(runProbe().persistedStatus, 'a failed retry must never claim `saved`').toBe('saved-attribution-pending');
        expect(receipt(runProbe()).verdict).toBe('HOLD');
    });

    it('CASUALTY: a THROWN retry republishes nothing', async () => {
        stageAttributionFailure();
        priv().attestSessionEngine = vi.fn(async () => { throw new Error('network'); });
        expect(await priv().retryPendingAttribution()).toBe(false);
        expect(runProbe().persistedStatus).toBe('saved-attribution-pending');
    });

    it('CASUALTY: a STALE settlement does not overwrite a newer session\'s marker', async () => {
        // The slot is re-pointed mid-flight; the in-flight retry is then resolving a session that is no
        // longer the current one, and publishing here would relabel the newer session as `saved`.
        stageAttributionFailure(SESSION);
        const c = priv();
        c.attestSessionEngine = vi.fn(async () => {
            c.pendingAttributionRetry = {
                sessionId: OTHER, evidence: null, progressContext: { mode: 'private' },
                progressMetrics: { payload: null, persisted: false },
            };
            c.updateSessionPersisted(true, { sessionId: OTHER, mode: 'private' });
            return { attributed: true };
        });

        await c.retryPendingAttribution();

        const probe = runProbe();
        expect(probe.persistedSessionId, "the newer session's marker must stand").toBe(OTHER);
        expect(probe.persistedStatus, 'and it is still awaiting its own attribution').toBe('saved-attribution-pending');
    });

    it('an idempotent retry with nothing pending publishes nothing', async () => {
        priv().pendingAttributionRetry = null;
        expect(await priv().retryPendingAttribution()).toBe(true);
        expect(runProbe().sessionPersisted, 'no save was recovered, so none is claimed').toBeNull();
    });
});

describe('#1403 full-save recovery publishes a receipt where there was none', () => {
    /** The state after a full-save failure: the row exists but nothing durable was claimed. */
    function stageFullSaveFailure(sessionId: string | null = SESSION) {
        const c = priv();
        c.pendingFullSaveRetry = {
            sessionId, completeArgs: {}, attributionEvidence: null,
            progressContext: { mode: 'private' }, progressMetrics: { payload: null, persisted: false },
        };
    }

    it('CONTROL: the initial full-save failure claims NO durable save', () => {
        stageFullSaveFailure();
        const probe = runProbe();
        expect(probe.sessionPersisted, 'nothing durable happened, so nothing is claimed').toBeNull();
        expect(probe.persistedStatus).toBeNull();
    });

    it('CASUALTY: a SUCCESSFUL full-save retry publishes `saved` with the recovered session id', async () => {
        stageFullSaveFailure();
        const storage = await import('@/lib/storage');
        vi.spyOn(storage, 'completeSession').mockResolvedValue({ success: true } as never);

        const ok = await priv().retryRecordingSave();
        expect(ok).toBe(true);

        const probe = runProbe();
        expect(probe.sessionPersisted, 'the recovered take had no marker at all before this').toBe('true');
        expect(probe.persistedSessionId).toBe(SESSION);
        expect(probe.persistedStatus).toBe('saved');
        expect(receipt(probe).verdict).toBe('PASS');
    });

    it('CASUALTY: a failed COMPLETION publishes nothing', async () => {
        stageFullSaveFailure();
        const storage = await import('@/lib/storage');
        vi.spyOn(storage, 'completeSession').mockResolvedValue({ success: false } as never);
        expect(await priv().retryRecordingSave()).toBe(false);
        expect(runProbe().sessionPersisted, 'the save is not durable, so no receipt').toBeNull();
    });

    it('CASUALTY: completion succeeding but ATTRIBUTION failing publishes nothing', async () => {
        // `saved` claims both. Publishing after only the completion would report a terminal attribution
        // the database does not hold.
        stageFullSaveFailure();
        const storage = await import('@/lib/storage');
        vi.spyOn(storage, 'completeSession').mockResolvedValue({ success: true } as never);
        priv().attestSessionEngine = vi.fn(async () => null);
        expect(await priv().retryRecordingSave()).toBe(false);
        expect(runProbe().sessionPersisted).toBeNull();
    });
});
