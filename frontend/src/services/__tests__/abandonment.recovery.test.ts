/* @vitest-environment jsdom */
/**
 * #1360 — ABANDONMENT: does a returning user meet a Start they cannot press?
 *
 * Abandonment is NOT cancellation. Cancelling a proof run kills the process and then runs a deliberate
 * authenticated teardown. A user closing the tab runs NO teardown: the account persists and whatever
 * was written stays written. Nine cancelled runs proved the harness cleans up; they proved nothing
 * about this.
 *
 * It is also not RELOAD, which #1355 covered. A reload happens after the recording lifecycle ends;
 * abandonment interrupts it mid-flight, so the paths differ in what has been written.
 *
 * The headline question is a churn question: a user who returns to a permanently disabled Start is a
 * one-time user. #1347 just fixed a DIFFERENT route to that same endpoint (a capability probe that
 * reported "supported" where recording was blocked), which is why this is worth proving rather than
 * assuming.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SpeechRuntimeController } from '../SpeechRuntimeController';
import { useSessionStore } from '@/stores/useSessionStore';
import {
    saveSessionRecoveryDraft, getRecoverableDraftForUser, clearSessionRecoveryDraft,
} from '@/services/sessionRecoveryDraft';
import { evaluateStartGate } from '@/services/progress/progressStartGate';

vi.mock('@/lib/logger', () => ({
    default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), trace: vi.fn() },
}));

const OWNER = 'user-abandon';
const OTHER = 'user-other';
const SESSION = 'sess-abandoned';

/** A returning user's controller: a fresh instance, as a new tab would construct. */
interface Ctl {
    startRecording: () => Promise<void>;
    ensureReady: ReturnType<typeof vi.fn>;
    rehydrateUnresolvedRecording: (userId: string) => boolean;
}
function returningTab(userId: string | null): Ctl {
    const c = Object.create(SpeechRuntimeController.prototype) as unknown as Ctl;
    const raw = c as unknown as Record<string, unknown>;
    raw.capturedUserId = userId;
    raw.pendingAttributionRetry = null;
    raw.pendingFullSaveRetry = null;
    raw.recordingStartedUnresolved = false;
    c.ensureReady = vi.fn().mockResolvedValue(undefined);
    return c;
}

/** What `persistActiveRecoveryDraft` writes when the tab is torn down mid-recording. */
function abandonMidRecording(userId: string, sessionId: string, partialWords = 12) {
    saveSessionRecoveryDraft({
        sessionId, userId,
        recoveryState: 'active_interrupted',
        durationSeconds: 20,
        mode: 'private',
        metrics: { totalWords: partialWords },
    });
}

beforeEach(() => {
    localStorage.clear();
    useSessionStore.getState().setProgressGate(null);
    useSessionStore.getState().setProgressGateResolvedFor(null);
    useSessionStore.setState({ sttStatus: { type: 'idle', message: '' } } as never);
});

describe('#1360 a returning user is NOT blocked after abandoning mid-recording', () => {
    it('THE HEADLINE: Start is not gated — abandonment completes no session, so nothing is owed', () => {
        abandonMidRecording(OWNER, SESSION);

        // A new tab reconstructs the gate from DURABLE debt. Abandonment never completed a session, so
        // the write-ahead obligation was never created and there is nothing to owe.
        const verdict = evaluateStartGate(OWNER, useSessionStore.getState().progressGate);
        expect(verdict, 'an abandoned recording must not block the next one').toEqual({ allowed: true });
    });

    it('an interrupted draft does NOT re-arm the save-retry block', () => {
        // The mechanism that COULD strand a user: `recordingStartedUnresolved` blocks Start. Only a
        // FINALIZED draft re-arms it — an interrupted one has no final metrics and no next action, so it
        // can never become a completed session.
        abandonMidRecording(OWNER, SESSION);
        const tab = returningTab(OWNER);
        expect(tab.rehydrateUnresolvedRecording(OWNER)).toBe(false);
        expect((tab as unknown as Record<string, unknown>).recordingStartedUnresolved).toBe(false);
        expect((tab as unknown as Record<string, unknown>).pendingFullSaveRetry).toBeNull();
    });

    it('a FINALIZED draft DOES block — the contrast that proves the test can see a block', () => {
        // Positive control. Without this, the assertions above would also pass if rehydration were
        // broken outright and never blocked anything.
        saveSessionRecoveryDraft({
            sessionId: SESSION, userId: OWNER,
            recoveryState: 'finalized_pending_save',
            durationSeconds: 30, mode: 'private',
            metrics: { totalWords: 40 },
            // A VALID next action — the strict enum shape. My first attempt used `{kind: '...'}`, an
            // unknown key, which `sanitizeNextAction` dropped and `resolveDraftState` then DOWNGRADED
            // to `active_interrupted`. That is the fail-closed design working: a finalized draft
            // without a valid next action is not a completed session and can never be replayed as one.
            nextActionSignal: {
                reasonCode: 'HIGH_FILLER_RATE', actionCode: 'REDUCE_FILLERS', metric: 'filler_rate',
                value: 12, comparator: 'above_baseline', templateVersion: 'rec_v1',
            } as never,
        });
        const tab = returningTab(OWNER);
        expect(tab.rehydrateUnresolvedRecording(OWNER)).toBe(true);
        expect((tab as unknown as Record<string, unknown>).recordingStartedUnresolved).toBe(true);
    });

    it('a new recording is reachable — Start passes the gate and reaches lifecycle work', async () => {
        abandonMidRecording(OWNER, SESSION);
        useSessionStore.getState().setProgressGateResolvedFor(OWNER);
        const tab = returningTab(OWNER);

        await tab.startRecording().catch(() => undefined);

        const message = useSessionStore.getState().sttStatus.message ?? '';
        expect(message, 'no Progress-gate refusal').not.toMatch(/couldn.t confirm|retry automatically|one moment/i);
        expect(message, 'no unresolved-recording refusal').not.toMatch(/finish saving your previous recording/i);
    });
});

describe('#1360 the abandonment draft is TRUTHFUL and owner-scoped', () => {
    it('is content-free — partial counters only, never transcript or prose', () => {
        abandonMidRecording(OWNER, SESSION, 12);
        const draft = getRecoverableDraftForUser(OWNER);
        expect(draft).toMatchObject({
            sessionId: SESSION, userId: OWNER, recoveryState: 'active_interrupted',
        });
        expect(JSON.stringify(draft)).not.toMatch(/transcript/i);
        // An interrupted draft carries NO next action — that is what stops it becoming a completed
        // session or entering Progress comparisons.
        expect(draft?.nextActionSignal ?? null).toBeNull();
    });

    it('another account cannot see it', () => {
        abandonMidRecording(OWNER, SESSION);
        expect(getRecoverableDraftForUser(OTHER)).toBeNull();
    });

    it('an anonymous visitor cannot see it', () => {
        abandonMidRecording(OWNER, SESSION);
        expect(getRecoverableDraftForUser('')).toBeNull();
    });

    it('a successful save clears it, so it cannot resurrect an already-saved session', () => {
        abandonMidRecording(OWNER, SESSION);
        clearSessionRecoveryDraft();
        expect(getRecoverableDraftForUser(OWNER)).toBeNull();
    });
});

describe('#1360 Q3 — is the interrupted draft surfaced TRUTHFULLY?', () => {
    /**
     * FINDING. The draft IS surfaced — but the copy promises something that does not exist.
     *
     * `SessionPage.tsx:310` renders "A locally saved TRANSCRIPT draft is available." with a
     * "Restore draft" button. #1306 made recovery CONTENT-FREE, and `useUnresolvedRecovery` says so in
     * its own comment: "there is no transcript to rehydrate into the UI". An `active_interrupted`
     * draft carries partial counters only.
     *
     * So "Restore draft" cannot restore a transcript. It clears the draft and shows
     * "your last session was interrupted; only partial measurements were available."
     *
     * That is a false promise in user-facing copy on the exact screen a returning user lands on. Not
     * fixed here — #1360 is diagnosis — but pinned so the claim is falsifiable rather than prose.
     */
    it('the draft carries NO transcript — only partial counters', () => {
        abandonMidRecording(OWNER, SESSION, 12);
        const draft = getRecoverableDraftForUser(OWNER);
        expect(draft?.metrics?.totalWords).toBe(12);
        // There is no transcript field to restore, on the draft or anywhere in its payload.
        expect(Object.keys(draft ?? {})).not.toContain('transcript');
        expect(JSON.stringify(draft)).not.toMatch(/transcript/i);
    });

    it('DEFECT: the banner copy promises a transcript the draft cannot provide', async () => {
        // Read the shipped copy rather than paraphrasing it, so this fails if the wording changes.
        const { readFileSync } = await import('node:fs');
        const { dirname, resolve } = await import('node:path');
        const { fileURLToPath } = await import('node:url');
        const here = dirname(fileURLToPath(import.meta.url));
        const page = readFileSync(resolve(here, '..', '..', 'pages', 'SessionPage.tsx'), 'utf8');

        expect(page, 'the banner still claims a transcript draft').toContain('transcript draft is available');
        // ...while the recovery hook states the opposite in the same codebase.
        const hook = readFileSync(resolve(here, '..', '..', 'hooks', 'useUnresolvedRecovery.ts'), 'utf8');
        expect(hook).toContain('there is no transcript to rehydrate into the UI');
    });
});
