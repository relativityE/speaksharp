/**
 * #1403 — the receipt authority. Every input is recomputed, and nothing content-bearing survives.
 */
import { describe, it, expect } from 'vitest';
import { auditSockets, receiptVerdict } from '../../scripts/human-test/observer.mjs';

const RELEASE = 'a19324610634b9e05a375fff8838f2bbbae3a4f1';
const CANDIDATE = 'moonshine:streaming-medium';
const APP = 'https://speaksharp-public.vercel.app';

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
    payloads: [], sockets: [], phases: ['pre-record', 'recording', 'stop-save'],
    appOrigin: APP, ...over,
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
            sockets: [{ url: 'wss://unknown.example/stream', frameCount: 400, binaryFrames: 400, byteCount: 900_000 }],
        }));
        expect(out.verdict).toBe('HOLD');
        expect(out.problems.join(' ')).toMatch(/websocket sent binary frames/);
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

        const receipt = receiptVerdict(base({ payloads, sockets: [{ url: 'wss://x/s', frameCount: 1, binaryFrames: 0, byteCount: 5 }] }));
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
