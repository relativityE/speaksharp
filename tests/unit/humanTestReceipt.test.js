/**
 * #1403 — the receipt authority. Every input is recomputed, and nothing content-bearing survives.
 */
import { describe, it, expect } from 'vitest';
import { auditSockets, receiptVerdict } from '../../scripts/human-test/observer.mjs';

const RELEASE = 'a19324610634b9e05a375fff8838f2bbbae3a4f1';
const CANDIDATE = 'moonshine:streaming-medium';
const APP = 'https://speaksharp-public.vercel.app';
const SESSION_ID = '9f1c0f4a-6d2e-4a1b-9c7d-2b8e5a3f10cc';

const goodProbe = (over = {}) => ({
    release: RELEASE,
    requestedCandidate: CANDIDATE,
    observedCandidate: CANDIDATE,
    identityMatches: true,
    modelStatus: 'ready',
    runtimeState: 'READY',
    ...over,
});
const base = (over = {}) => ({
    probe: goodProbe(), expectedCandidate: CANDIDATE, expectedRelease: RELEASE,
    payloads: [], sockets: [], phases: ['pre-record', 'recording', 'stop-save', 'terminal'],
    appOrigin: APP,
    workerInstrumentation: { attached: 1, installed: 1, installFailures: 0, drained: 1, drainFailures: 0, mainTripwireInstalled: true, networkEnabled: 1, networkFailures: 0, setupPending: 0 },
    egress: [],
    ...over,
});

describe('the receipt requires requested === observed === expected', () => {
    it('POSITIVE CONTROL: all three agreeing, no egress, no sockets, all phases → PASS', () => {
        expect(receiptVerdict(base()).verdict).toBe('PASS');
    });

    it('CASUALTY: an arm the operator did not ASK for is HOLD, even if the page is self-consistent', () => {
        // requested === observed, so the page is internally happy. It is still the wrong model.
        const probe = goodProbe({ requestedCandidate: 'v2:base.en', observedCandidate: 'v2:base.en' });
        const out = receiptVerdict(base({ probe }));
        expect(out.verdict).toBe('HOLD');
        expect(out.problems.join(' ')).toMatch(/!= expected/);
    });

    it('CASUALTY: a contradictory publisher boolean is itself reported', () => {
        // The page computes `identityMatches` from the same values it reports, so it cannot be an
        // independent premise. When it disagrees with the values, the page is wrong about something and
        // which side is wrong is not knowable from here.
        const liar = goodProbe({ observedCandidate: 'v2:base.en', identityMatches: true });
        const out = receiptVerdict(base({ probe: liar }));
        expect(out.verdict).toBe('HOLD');
        expect(out.problems.join(' ')).toMatch(/identityMatches=true, which the published values contradict/);
    });

    it('CASUALTY: identityMatches=false while the values agree is also reported', () => {
        const out = receiptVerdict(base({ probe: goodProbe({ identityMatches: false }) }));
        expect(out.verdict).toBe('HOLD');
        expect(out.problems.join(' ')).toMatch(/identityMatches=false/);
    });

    it('CASUALTY: a missing release is HOLD', () => {
        expect(receiptVerdict(base({ probe: goodProbe({ release: 'something-else' }) })).verdict).toBe('HOLD');
    });
});

describe('streamed traffic is a channel, not a request', () => {
    it('CASUALTY: a websocket carrying BINARY frames is HOLD', () => {
        // A socket is one request at creation and then an open pipe: every frame after the handshake is
        // invisible to a request audit, so a clean request report proved nothing about the channel best
        // suited to streaming audio out.
        //
        // Holding on the mere EXISTENCE of a socket was the wrong rule: ordinary vendor transports use
        // them, so it held valid takes, and a rule that always holds gets removed. Binary frames are the
        // discriminator that actually bears on whether audio could have left.
        const out = receiptVerdict(base({
            sockets: [{ url: 'wss://unknown.example/stream', frameCount: 400, sentBinaryFrames: 400, receivedBinaryFrames: 0, byteCount: 900_000 }],
        }));
        expect(out.verdict).toBe('HOLD');
        expect(out.problems.join(' ')).toMatch(/websocket sent 400 binary frame/);
    });

    it('CASUALTY: NOT observing sockets is different from observing none', () => {
        // Only one of the two is evidence, and the difference is exactly the claim being made.
        const out = receiptVerdict(base({ sockets: null }));
        expect(out.verdict).toBe('HOLD');
        expect(out.problems.join(' ')).toMatch(/socket observation was not enabled/);
    });

    it('socket findings carry counts and sizes, never payloads', () => {
        const found = auditSockets([{ url: 'wss://x.example/s?token=SECRET', frameCount: 3, byteCount: 42, payload: 'audio bytes here' }]);
        const s = JSON.stringify(found);
        expect(s).not.toContain('SECRET');
        expect(s).not.toContain('audio bytes here');
        expect(found[0]).toMatchObject({ origin: 'wss://x.example', frames: 3, bytes: 42 });
    });
});

describe('every lifecycle phase must actually be observed', () => {
    it('CASUALTY: a run that never reached stop/save is HOLD', () => {
        const out = receiptVerdict(base({ phases: ['pre-record', 'recording'] }));
        expect(out.verdict).toBe('HOLD');
        expect(out.problems.join(' ')).toMatch(/stop-save/);
    });
});

describe('the receipt contains nothing content-bearing', () => {
    it('CASUALTY: no bodies, query values, headers, transcript, tokens or raw paths survive', () => {
        const payloads = [
            { transport: 'fetch', url: `${APP}/api/log/transcript-words?words=umm,like,basically&token=SECRET_TOKEN`, method: 'POST', kind: 'json', bytes: 30, runtimeState: 'READY' },
            { transport: 'fetch', url: 'https://vendor.example/upload?apikey=SECRET_KEY#frag=SECRET_FRAG', method: 'POST', kind: 'audio', mime: 'audio/webm', bytes: 900, runtimeState: 'RECORDING' },
            { transport: 'beacon', url: `${APP}/u/ada@example.com/notes`, method: 'POST', kind: 'binary', bytes: 40, runtimeState: 'RECORDING' },
        ];

        const receipt = receiptVerdict(base({ payloads, sockets: [{ url: 'wss://x/s', frameCount: 1, sentBinaryFrames: 0, receivedBinaryFrames: 0, byteCount: 5 }] }));
        const serialized = JSON.stringify(receipt);

        for (const forbidden of [
            'SECRET_TOKEN', 'SECRET_KEY', 'SECRET_FRAG', 'transcript-words',
            'umm,like,basically', 'ada@example.com', 'apikey', 'words=',
        ]) {
            expect(serialized, `receipt leaked ${forbidden}`).not.toContain(forbidden);
        }
        // It still says something useful: how many, of what kind, and where.
        // Two findings, not three: the same-origin JSON is ordinary product behaviour and correctly
        // produces nothing. The audio and the during-recording binary are the ones that matter.
        expect(receipt.payloads.map((e) => e.category).sort())
            .toEqual(['audio_egress', 'same_origin_binary_during_recording']);
        expect(receipt.payloads.every((e) => typeof e.routeHash === 'string')).toBe(true);
        expect(receipt.verdict).toBe('HOLD');
    });
});

/**
 * #1403s — three defects that could invalidate Stage-1 evidence.
 *
 * Each is a way the receipt lied: one HELD a take whose evidence was complete, one PASSED a take whose
 * save could not be attributed, and one attributed a whole take to whichever model happened to be
 * running at the end. Every rule below has a positive control proving it fires AND a clean case proving
 * it does not fire on a good take.
 */
const liveSample = (over = {}) => ({
    at: 1, runtimeState: 'RECORDING', observedCandidate: CANDIDATE,
    requestedCandidate: CANDIDATE, identityMatches: true, ...over,
});
const cleanSamples = () => [
    { ...liveSample(), runtimeState: 'READY' },
    liveSample(),
    liveSample({ at: 2 }),
    { ...liveSample({ at: 3 }), runtimeState: 'STOPPING' },
];

describe('#1403s worker destruction after a completed read is not evidence loss', () => {
    it('POSITIVE CONTROL: a worker never read still HOLDS the take', () => {
        const out = receiptVerdict(base({
            workerInstrumentation: {
                attached: 1, installed: 1, installFailures: 0, drained: 0, drainFailures: 1,
                mainTripwireInstalled: true, networkEnabled: 1, networkFailures: 0, setupPending: 0,
            },
        }));
        expect(out.verdict).not.toBe('PASS');
        expect(JSON.stringify(out)).toMatch(/could not be read back/);
    });

    it('CASUALTY: a worker read authoritatively and THEN torn down does not hold the take', () => {
        // The false HOLD: the app ending a session correctly destroyed the worker after its evidence
        // had already been collected, and the receipt reported a failed readback.
        const out = receiptVerdict(base({
            workerInstrumentation: {
                attached: 1, installed: 1, installFailures: 0, drained: 1, drainFailures: 0,
                postReadTeardowns: 1,
                mainTripwireInstalled: true, networkEnabled: 1, networkFailures: 0, setupPending: 0,
            },
        }));
        expect(out.verdict, 'a completed read must survive the worker that produced it').toBe('PASS');
    });
});

describe('#1403s persistence must be attributed, not merely flagged', () => {
    it('CASUALTY: persisted=true with a non-saved status HOLDS', () => {
        const out = receiptVerdict(base({
            probe: goodProbe({ sessionPersisted: 'true', persistedStatus: 'pending' }),
        }));
        expect(out.verdict).not.toBe('PASS');
        expect(JSON.stringify(out)).toMatch(/not a saved state/);
    });

    it('CASUALTY: persisted=true with NO published engine identity HOLDS', () => {
        // The saved row cannot be attributed to a model, which is the whole point of the receipt.
        const out = receiptVerdict(base({
            probe: goodProbe({ sessionPersisted: true, observedCandidate: null }),
        }));
        expect(out.verdict).not.toBe('PASS');
    });

    it('CASUALTY: persisted=true with NO published save status HOLDS', () => {
        // The RETURNED defect. The rule tolerated a null status while the product published none, so
        // this state -- the one every real take was in -- passed by being unable to fail.
        const out = receiptVerdict(base({
            probe: goodProbe({ sessionPersisted: 'true', persistedSessionId: SESSION_ID }),
        }));
        expect(out.verdict).not.toBe('PASS');
        expect(JSON.stringify(out)).toMatch(/published no save status/);
    });

    it('CASUALTY: persisted=true naming NO row HOLDS, even with a clean status', () => {
        // Nothing can be cross-checked against the database afterwards, so "this take was persisted" is
        // unfalsifiable rather than true.
        const out = receiptVerdict(base({
            probe: goodProbe({ sessionPersisted: 'true', persistedStatus: 'saved' }),
            identitySamples: cleanSamples(),
        }));
        expect(out.verdict).not.toBe('PASS');
        expect(JSON.stringify(out)).toMatch(/without a session id/);
    });

    it('CASUALTY: a whitespace-only session id is not an id', () => {
        const out = receiptVerdict(base({
            probe: goodProbe({ sessionPersisted: 'true', persistedStatus: 'saved', persistedSessionId: '   ' }),
            identitySamples: cleanSamples(),
        }));
        expect(out.verdict).not.toBe('PASS');
        expect(JSON.stringify(out)).toMatch(/without a session id/);
    });

    it('POSITIVE CONTROL: a saved status, a named row and a published identity PASSES', () => {
        const out = receiptVerdict(base({
            probe: goodProbe({
                sessionPersisted: 'true', persistedStatus: 'saved', persistedSessionId: SESSION_ID,
            }),
            identitySamples: cleanSamples(),
        }));
        expect(out.verdict).toBe('PASS');
    });
});

describe('#1403s identity is a property of the whole take', () => {
    it('CASUALTY: a candidate that CHANGED while live HOLDS the take', () => {
        // Only the final probe used to reach the verdict, so a mid-take change left no trace and the
        // take was attributed to whatever ran last.
        const out = receiptVerdict(base({
            identitySamples: [
                liveSample(),
                liveSample({ at: 2, observedCandidate: 'v2:base.en' }),
            ],
        }));
        expect(out.verdict).not.toBe('PASS');
        expect(JSON.stringify(out)).toMatch(/CHANGED during the take/);
    });

    it('CASUALTY: an unexpected candidate observed while live HOLDS', () => {
        const out = receiptVerdict(base({
            identitySamples: [liveSample({ observedCandidate: 'v4:distil:q4' })],
        }));
        expect(out.verdict).not.toBe('PASS');
    });

    it('CASUALTY: an identity MISMATCH reported while live HOLDS', () => {
        const out = receiptVerdict(base({
            identitySamples: [liveSample({ identityMatches: false })],
        }));
        expect(out.verdict).not.toBe('PASS');
    });

    it('CASUALTY: samples that never cover the live take HOLD', () => {
        // Sampling only before and after says nothing about what ran during it.
        const out = receiptVerdict(base({
            identitySamples: [
                { ...liveSample(), runtimeState: 'READY' },
                { ...liveSample({ at: 9 }), runtimeState: 'IDLE' },
            ],
        }));
        expect(out.verdict).not.toBe('PASS');
        expect(JSON.stringify(out)).toMatch(/no identity sample was captured while the take was live/);
    });

    it('POSITIVE CONTROL: a consistent identity across the whole take PASSES', () => {
        expect(receiptVerdict(base({ identitySamples: cleanSamples() })).verdict).toBe('PASS');
    });

    it('a take with no samples supplied is unchanged (the rule is additive)', () => {
        expect(receiptVerdict(base()).verdict).toBe('PASS');
    });
});
