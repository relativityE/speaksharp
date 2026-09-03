// @vitest-environment jsdom
/* global document, window */
// `tests/**` is linted with Node globals; this suite runs in jsdom because the publisher under test
// writes to a real DOM, so the two globals it touches are declared rather than widening the config.
/**
 * #1403 RETURN — THE REAL SAVE BOUNDARY, THE REAL PROBE, THE REAL VERDICT, IN ONE CHAIN.
 *
 * The returned defect was that the persistence rule could not fire. It read `persistedStatus` and
 * tolerated a null, and the product published no such attribute anywhere — so every take passed the
 * persistence check by being unable to fail it, and the receipt reported an attributed save it had
 * never actually checked. A unit test of the rule could not see that: the rule was fine in isolation
 * and the publisher it depended on did not exist.
 *
 * So nothing here is hand-written. The publisher is the product's own `syncSessionPersisted`, writing
 * to a real DOM. The reader is the observer's own `IDENTITY_PROBE`, evaluated as the CDP session
 * evaluates it. The judge is the observer's own `receiptVerdict`. If the attribute the publisher writes
 * and the attribute the probe reads ever drift apart again, this chain breaks where the drift is.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { syncSessionPersisted } from '@/lib/forensicAnchors';
import { IDENTITY_PROBE, receiptVerdict } from '../../scripts/human-test/observer.mjs';

const RELEASE = 'a19324610634b9e05a375fff8838f2bbbae3a4f1';
const CANDIDATE = 'moonshine:streaming-medium';
const APP = 'https://speaksharp-public.vercel.app';
const SESSION_ID = '9f1c0f4a-6d2e-4a1b-9c7d-2b8e5a3f10cc';

/** Evaluate the observer's real probe expression against the current document, as CDP would. */
const runProbe = () => new Function(`return ${IDENTITY_PROBE}`)();

/** The take is otherwise clean, so any HOLD below comes from the persistence boundary alone. */
const receipt = (probe) => receiptVerdict({
    probe, expectedCandidate: CANDIDATE, expectedRelease: RELEASE,
    payloads: [], sockets: [], phases: ['pre-record', 'recording', 'stop-save', 'terminal'],
    appOrigin: APP,
    workerInstrumentation: {
        attached: 1, installed: 1, installFailures: 0, drained: 1, drainFailures: 0,
        mainTripwireInstalled: true, networkEnabled: 1, networkFailures: 0, setupPending: 0,
    },
    egress: [],
});

/** Everything the probe needs that is not the persistence marker itself. */
function stageCleanTake() {
    const root = document.documentElement;
    root.setAttribute('data-runtime-state', 'READY');
    root.setAttribute('data-model-status', 'ready');
    window.__APP_RELEASE__ = RELEASE;
    window.__SS_ACTIVE_CANDIDATE__ = () => ({
        requested: CANDIDATE, observed: CANDIDATE, matches: true, source: 'runtime-switch',
    });
}

beforeEach(() => {
    for (const a of [...document.documentElement.attributes]) {
        document.documentElement.removeAttribute(a.name);
    }
    stageCleanTake();
});

describe('#1403 the probe reads what the product actually writes', () => {
    it('CASUALTY: a fully attributed save publishes BOTH a status and an id, and the probe sees them', () => {
        // On the returned head this status was `null` for every take in existence, because no code path
        // in the product wrote the attribute the probe reads.
        syncSessionPersisted(true, { sessionId: SESSION_ID, mode: 'private', status: 'saved' });
        const probe = runProbe();
        expect(probe.sessionPersisted).toBe('true');
        expect(probe.persistedStatus, 'the product must publish a save status').toBe('saved');
        expect(probe.persistedSessionId).toBe(SESSION_ID);
    });

    it('CASUALTY: an attribution-pending save is visible to the probe as a DIFFERENT fact', () => {
        syncSessionPersisted(true, {
            sessionId: SESSION_ID, mode: 'private', status: 'saved-attribution-pending',
        });
        expect(runProbe().persistedStatus).toBe('saved-attribution-pending');
    });

    it('clearing persistence clears the status and the id together', () => {
        syncSessionPersisted(true, { sessionId: SESSION_ID, status: 'saved' });
        syncSessionPersisted(false);
        const probe = runProbe();
        expect(probe.sessionPersisted).toBeNull();
        expect(probe.persistedStatus, 'a stale status must not outlive the save it described').toBeNull();
        expect(probe.persistedSessionId).toBeNull();
    });

    it('CASUALTY: a NEW unqualified save does not inherit the previous take’s status', () => {
        // Without the explicit clear, a second save with no status would still read `saved` from the
        // first — the receipt would credit a take with a qualification it was never given.
        syncSessionPersisted(true, { sessionId: SESSION_ID, status: 'saved' });
        syncSessionPersisted(true, { sessionId: 'b2d0c8e1-1111-4111-8111-222222222222' });
        expect(runProbe().persistedStatus).toBeNull();
    });
});

describe('#1403 the verdict holds a save it cannot vouch for', () => {
    it('POSITIVE CONTROL: a fully attributed, identified save PASSES', () => {
        syncSessionPersisted(true, { sessionId: SESSION_ID, mode: 'private', status: 'saved' });
        const out = receipt(runProbe());
        expect(out.problems, `unexpected holds: ${out.problems.join(' | ')}`).toEqual([]);
        expect(out.verdict).toBe('PASS');
    });

    it('CASUALTY: a persistence flag with NO status is HELD', () => {
        // THE RETURNED DEFECT, end to end. This is the exact state every real take was in, and it used
        // to pass: the rule tolerated a null status and the product published nothing else.
        syncSessionPersisted(true, { sessionId: SESSION_ID, mode: 'private' });
        const out = receipt(runProbe());
        expect(out.verdict).toBe('HOLD');
        expect(out.problems.join(' ')).toMatch(/published no save status/);
    });

    it('CASUALTY: a save whose attribution never landed is HELD', () => {
        syncSessionPersisted(true, {
            sessionId: SESSION_ID, mode: 'private', status: 'saved-attribution-pending',
        });
        const out = receipt(runProbe());
        expect(out.verdict).toBe('HOLD');
        expect(out.problems.join(' ')).toMatch(/saved-attribution-pending/);
    });

    it('CASUALTY: a save that names no row is HELD, even when its status is clean', () => {
        // "Persisted" with nothing to look up is unfalsifiable, which is not the same as true.
        syncSessionPersisted(true, { sessionId: null, mode: 'private', status: 'saved' });
        const out = receipt(runProbe());
        expect(out.verdict).toBe('HOLD');
        expect(out.problems.join(' ')).toMatch(/without a session id/);
    });

    it('CASUALTY: a blank session id is not an id', () => {
        syncSessionPersisted(true, { sessionId: SESSION_ID, status: 'saved' });
        document.documentElement.setAttribute('data-session-persisted-id', '   ');
        const out = receipt(runProbe());
        expect(out.verdict).toBe('HOLD');
        expect(out.problems.join(' ')).toMatch(/without a session id/);
    });

    it('a take that never reached persistence is not held by these rules', () => {
        // The persistence guards must judge saves, not absence of one; the phase checks own that.
        const out = receipt(runProbe());
        expect(out.problems.join(' '), 'no save was claimed, so no save is judged')
            .not.toMatch(/save status|without a session id/);
    });
});

describe('#1403 the published attribute is declared in the signal contract', () => {
    it('CASUALTY: the status signal is registered, with the publisher as its owner', async () => {
        const { DOM_SIGNALS } = await import('@/e2e/signalContract');
        const entry = DOM_SIGNALS.find((s) => s.name === 'data-session-persist-status');
        expect(entry, 'an undeclared DOM signal is one nobody maintains').toBeTruthy();
        expect(entry.status).toBe('active');
        expect(entry.writers).toContain('syncSessionPersisted()');
        expect(entry.readers.join(' ')).toMatch(/observer\.mjs/);
    });
});
