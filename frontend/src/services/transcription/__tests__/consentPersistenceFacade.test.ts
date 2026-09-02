/**
 * #1405 — consent must be recordable, and once recorded must stop the asking.
 *
 * The original defect was a call that appeared to work and recorded nothing: `grantModelConsent` lived
 * on the engine, the service called it on the mode wrapper, and optional chaining swallowed the gap.
 * The user granted consent, the download ran, and the next session asked again — every step reporting
 * success.
 *
 * This drives the REAL consent module and a REAL PrivateSTT facade, because the property under test is
 * "a new session does not ask again", and that is only meaningful across a fresh object.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CANDIDATES } from '../candidateRegistry';
import { CONSENT_STORAGE_KEY, consentDecision, consentTermsFor, readReceipt } from '../modelConsent';
import { sttRegistry } from '../STTRegistry';
import type { IPrivateSTTEngine } from '../../../contracts/IPrivateSTTEngine';

vi.mock('../candidateSelection', async (orig) => {
    const actual = await orig() as Record<string, unknown>;
    return {
        ...actual,
        effectiveCandidate: () => ({
            candidate: CANDIDATES['moonshine:streaming-medium'],
            fallbackCause: null,
        }),
    };
});

const stubEngine = (): IPrivateSTTEngine => ({
    init: vi.fn(async () => ({ isOk: true, data: undefined })),
    transcribe: vi.fn(async () => ({ isOk: true, data: '' })),
    start: vi.fn(async () => {}), stop: vi.fn(async () => {}),
    pause: vi.fn(async () => {}), resume: vi.fn(async () => {}),
    terminate: vi.fn(async () => {}),
    getTranscript: vi.fn(async () => ''), getInterimTranscript: vi.fn(() => ''),
} as unknown as IPrivateSTTEngine);

describe('consent recorded once is not asked again by a new session', () => {
    beforeEach(() => {
        window.localStorage.clear();
        sttRegistry.register('moonshine-streaming', () => stubEngine() as never);
    });
    afterEach(() => { sttRegistry.clear(); window.localStorage.clear(); vi.restoreAllMocks(); });

    it('REAL-FACADE PROOF: after an explicit grant, a NEWLY CREATED facade does not ask again', async () => {
        const { PrivateSTT } = await import('../engines/PrivateSTT');

        const first = new PrivateSTT({ onTranscriptUpdate: vi.fn(), onReady: vi.fn() });
        expect((await first.checkAvailability()).reason, 'a first-time user must be asked')
            .toBe('CONSENT_REQUIRED');

        // The affirmative act, through the real engine method the wrapper delegates to.
        first.grantModelConsent();

        // A DIFFERENT object, as a later session would be. The receipt has to outlive the instance that
        // wrote it, which is the whole point of persisting it rather than holding it in memory.
        const second = new PrivateSTT({ onTranscriptUpdate: vi.fn(), onReady: vi.fn() });
        const availability = await second.checkAvailability();
        expect(availability.isAvailable, 'a returning user must not be asked again').toBe(true);
        expect(availability.reason).toBeUndefined();
    });

    it('CASUALTY: without the grant, a new facade asks every time', () => {
        // The observable symptom of the original defect, stated as a test: no receipt, so the question
        // repeats forever.
        const candidate = CANDIDATES['moonshine:streaming-medium'];
        for (let session = 0; session < 3; session++) {
            expect(consentDecision(candidate, readReceipt(candidate.id)).state).toBe('consent_required');
        }
    });

    it('the receipt written by the facade is the one the decision reads', async () => {
        const { PrivateSTT } = await import('../engines/PrivateSTT');
        new PrivateSTT({ onTranscriptUpdate: vi.fn(), onReady: vi.fn() }).grantModelConsent();

        const candidate = CANDIDATES['moonshine:streaming-medium'];
        const stored = readReceipt(candidate.id);
        expect(stored).not.toBeNull();
        expect(stored).toMatchObject(consentTermsFor(candidate));
        expect(window.localStorage.getItem(CONSENT_STORAGE_KEY)).toContain('moonshine:streaming-medium');
    });
});
