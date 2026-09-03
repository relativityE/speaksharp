// @vitest-environment jsdom
/**
 * #1403 — THE CONTROLLER DECIDES WHAT THE SAVE MARKER IS ALLOWED TO CLAIM.
 *
 * The publisher and the observer were corrected first, and mutation showed the gap immediately: flipping
 * the controller so an attribution-pending save reported itself as clean broke nothing, because nothing
 * exercised the derivation. That is the same shape as the defect being fixed — a rule that cannot fail
 * is not a rule — so the truth table is driven through the REAL controller here, not through a helper.
 *
 * What the marker means: the row is real either way. `saved` additionally claims the engine attribution
 * was recorded, and a take credited to a model the database never recorded is exactly the evidence this
 * work exists to prevent.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SpeechRuntimeController } from '../SpeechRuntimeController';

vi.mock('../../lib/logger', () => ({
    default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const SESSION = '9f1c0f4a-6d2e-4a1b-9c7d-2b8e5a3f10cc';
const OTHER = 'b2d0c8e1-1111-4111-8111-222222222222';

type PrivateController = {
    updateSessionPersisted: (persisted: boolean, details?: { sessionId?: string | null; mode?: string | null }) => void;
    pendingAttributionRetry: { sessionId: string } | null;
};
const priv = () => SpeechRuntimeController.getInstance() as unknown as PrivateController;

const status = () => document.documentElement.getAttribute('data-session-persist-status');
const flag = () => document.documentElement.getAttribute('data-session-persisted');
const persistedId = () => document.documentElement.getAttribute('data-session-persisted-id');

beforeEach(() => {
    for (const a of [...document.documentElement.attributes]) {
        document.documentElement.removeAttribute(a.name);
    }
    priv().pendingAttributionRetry = null;
});

describe('#1403 the save marker claims only what the controller knows', () => {
    it('CASUALTY: a save with no outstanding attribution retry is `saved`', () => {
        priv().updateSessionPersisted(true, { sessionId: SESSION, mode: 'private' });
        expect(flag()).toBe('true');
        expect(status()).toBe('saved');
        expect(persistedId()).toBe(SESSION);
    });

    it('CASUALTY: a save whose OWN attribution write did not land is `saved-attribution-pending`', () => {
        // The controller stashes a retry for exactly this session when the attribution persist fails; the
        // row exists, the identity it was recorded under does not yet.
        priv().pendingAttributionRetry = { sessionId: SESSION };
        priv().updateSessionPersisted(true, { sessionId: SESSION, mode: 'private' });
        expect(status()).toBe('saved-attribution-pending');
    });

    it("CASUALTY: ANOTHER session's pending retry does not taint this save", () => {
        // Reporting pending here would hold a take that was in fact clean, and a guard that fires on
        // clean evidence gets relaxed until it fires on nothing.
        priv().pendingAttributionRetry = { sessionId: OTHER };
        priv().updateSessionPersisted(true, { sessionId: SESSION, mode: 'private' });
        expect(status()).toBe('saved');
    });

    it('CASUALTY: the controller publishes a status on EVERY true save, including one that names no row', () => {
        // A save with no id is already held downstream for being unidentifiable. It must still not arrive
        // status-less, or the receipt would report the wrong reason for the hold.
        priv().updateSessionPersisted(true, {});
        expect(flag()).toBe('true');
        expect(status(), 'a true save must never publish an absent status').not.toBeNull();
    });

    it('clearing persistence clears the status with it', () => {
        priv().updateSessionPersisted(true, { sessionId: SESSION });
        priv().updateSessionPersisted(false);
        expect(flag()).toBeNull();
        expect(status()).toBeNull();
        expect(persistedId()).toBeNull();
    });

    it('CASUALTY: a pending retry left over from a PREVIOUS take does not survive into a clean one', () => {
        priv().pendingAttributionRetry = { sessionId: SESSION };
        priv().updateSessionPersisted(true, { sessionId: SESSION });
        expect(status()).toBe('saved-attribution-pending');

        priv().pendingAttributionRetry = null;
        priv().updateSessionPersisted(true, { sessionId: OTHER });
        expect(status(), 'the new take is judged on its own attribution').toBe('saved');
    });
});
