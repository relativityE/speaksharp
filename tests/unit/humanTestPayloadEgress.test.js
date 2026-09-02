/**
 * #1403 — the promise is that AUDIO never leaves the browser, not that nothing leaves.
 *
 * The previous audit reported every off-origin body as suspect, so ordinary Sentry and PostHog traffic
 * produced HOLD on a page that had not recorded anything. That tool proved "no unrecognised network
 * traffic", which SpeakSharp does not promise and deliberately does not want to: final transcript TEXT
 * is persisted server-side for the two newest transcript-bearing sessions, and the documentation says so.
 *
 * A check that permanently holds valid takes gets solved by allowlisting vendors — and a vendor
 * allowlist authorises whatever that vendor is sent, audio included. So the discriminator is the
 * PAYLOAD.
 */
import { describe, it, expect } from 'vitest';
import { auditPayloads, receiptVerdict, BLOCKING_PAYLOAD_CATEGORIES } from '../../scripts/human-test/observer.mjs';

const APP = 'https://speaksharp-public.vercel.app';
const audit = (records) => auditPayloads(records, { appOrigin: APP });
const blocking = (records) => audit(records).filter((f) => BLOCKING_PAYLOAD_CATEGORIES.includes(f.category));

const rec = (over) => ({ transport: 'fetch', url: `${APP}/api/sessions`, method: 'POST', kind: 'json', mime: 'application/json', bytes: 120, runtimeState: 'READY', ...over });

describe('audio leaving the device is the violation', () => {
    it('CASUALTY: an audio Blob posted anywhere is caught', () => {
        const hits = blocking([rec({ url: 'https://vendor.example/upload', kind: 'audio', mime: 'audio/webm', bytes: 480_000 })]);
        expect(hits).toHaveLength(1);
        expect(hits[0].category).toBe('audio_egress');
        expect(hits[0].mime).toBe('audio/webm');
    });

    it('CASUALTY: audio to the app’s OWN origin is still a violation', () => {
        // A same-origin endpoint that forwards audio is exactly the shape a well-meaning "upload for
        // better accuracy" feature takes, and same-origin was previously trusted outright.
        const hits = blocking([rec({ url: `${APP}/api/upload`, kind: 'audio', mime: 'audio/webm', bytes: 90_000 })]);
        expect(hits).toHaveLength(1);
        expect(hits[0].category).toBe('same_origin_audio');
    });

    it('CASUALTY: raw PCM (Float32Array) is audio even with no MIME type', () => {
        const hits = blocking([rec({ url: 'https://vendor.example/x', kind: 'audio', mime: null, ctor: 'Float32Array', bytes: 64_000 })]);
        expect(hits).toHaveLength(1);
    });

    it('CASUALTY: unexplained binary off-origin is caught even when it is not labelled audio', () => {
        const hits = blocking([rec({ url: 'https://vendor.example/x', kind: 'binary', mime: null, bytes: 1_000_000 })]);
        expect(hits[0].category).toBe('unexplained_binary');
    });

    it('CASUALTY: same-origin binary DURING RECORDING is caught', () => {
        // Off the clock it is ordinary app traffic; while recording, captured audio exists to send.
        const during = blocking([rec({ url: `${APP}/api/x`, kind: 'binary', bytes: 50_000, runtimeState: 'RECORDING' })]);
        expect(during).toHaveLength(1);
        const idle = blocking([rec({ url: `${APP}/api/x`, kind: 'binary', bytes: 50_000, runtimeState: 'READY' })]);
        expect(idle).toHaveLength(0);
    });

    it('CASUALTY: a vendor being EXPECTED does not authorise audio to it', () => {
        // The failure the old design invited: allowlist the vendor to stop the noise, and audio walks
        // out through the destination nobody looks at twice.
        const hits = blocking([rec({ url: 'https://o123.ingest.us.sentry.io/api/x', kind: 'audio', mime: 'audio/webm', bytes: 200_000 })]);
        expect(hits).toHaveLength(1);
        expect(hits[0].category).toBe('audio_egress');
    });
});

describe('ordinary product behaviour is NOT a violation', () => {
    it('POSITIVE CONTROL: expected Sentry and PostHog TEXT traffic does not hold a take', () => {
        expect(blocking([
            rec({ url: 'https://o123.ingest.us.sentry.io/api/envelope', kind: 'text', bytes: 900 }),
            rec({ url: 'https://us.i.posthog.com/e/', kind: 'json', bytes: 400 }),
            rec({ url: 'https://us-assets.i.posthog.com/static/array.js', method: 'GET', kind: 'empty', bytes: 0 }),
        ])).toEqual([]);
    });

    it('POSITIVE CONTROL: transcript TEXT persisted to our own server is allowed', () => {
        // The product documents that final transcript text is retained for the two newest
        // transcript-bearing sessions. Reporting it as audio egress made the tool contradict the PRD.
        expect(blocking([
            rec({ url: `${APP}/api/sessions`, kind: 'json', bytes: 12_000, runtimeState: 'RECORDING' }),
        ])).toEqual([]);
    });

    it('text to an UNRECOGNISED third party is reported for review, not blocked', () => {
        const all = audit([rec({ url: 'https://unknown.example/collect', kind: 'json', bytes: 300 })]);
        expect(all).toHaveLength(1);
        expect(all[0].category).toBe('unrecognised_text_destination');
        expect(BLOCKING_PAYLOAD_CATEGORIES).not.toContain('unrecognised_text_destination');
    });

    it('findings carry kind, MIME and size — never contents', () => {
        const all = audit([rec({ url: 'https://vendor.example/u?token=SECRET', kind: 'audio', mime: 'audio/webm', bytes: 5 })]);
        const s = JSON.stringify(all);
        expect(s).not.toContain('SECRET');
        expect(all[0]).toMatchObject({ kind: 'audio', mime: 'audio/webm', bytes: 5 });
        expect(all[0].routeHash).toMatch(/^[0-9a-f]{12}$/);
    });
});

describe('the receipt holds on audio, not on traffic', () => {
    const probe = {
        release: 'r1', requestedCandidate: 'moonshine:streaming-medium',
        observedCandidate: 'moonshine:streaming-medium', identityMatches: true,
        modelStatus: 'ready', runtimeState: 'READY',
    };
    const base = (over = {}) => ({
        probe, expectedCandidate: 'moonshine:streaming-medium', expectedRelease: 'r1',
        payloads: [], sockets: [], phases: ['pre-record', 'recording', 'stop-save'], appOrigin: APP,
        workerInstrumentation: { attached: 0, installed: 0, installFailures: 0, drained: 0, drainFailures: 0 },
        ...over,
    });

    it('CASUALTY: a take with ordinary vendor traffic and no audio PASSES', () => {
        // The retained dry run proved the opposite: idle Sentry/PostHog traffic held a take on a page
        // that had never recorded, so no audio could possibly have left.
        const out = receiptVerdict(base({
            payloads: [
                rec({ url: 'https://o123.ingest.us.sentry.io/api/envelope', kind: 'text', bytes: 900 }),
                rec({ url: 'https://us.i.posthog.com/e/', kind: 'json', bytes: 400 }),
            ],
        }));
        expect(out.verdict).toBe('PASS');
    });

    it('CASUALTY: one audio payload holds the take', () => {
        const out = receiptVerdict(base({
            payloads: [rec({ url: 'https://vendor.example/u', kind: 'audio', mime: 'audio/webm', bytes: 480_000 })],
        }));
        expect(out.verdict).toBe('HOLD');
        expect(out.problems.join(' ')).toMatch(/audio_egress/);
    });

    it('CASUALTY: a socket carrying BINARY frames holds; a JSON socket does not', () => {
        const bin = receiptVerdict(base({ sockets: [{ url: 'wss://x/s', frameCount: 50, sentBinaryFrames: 50, receivedBinaryFrames: 0, byteCount: 900_000 }] }));
        expect(bin.verdict).toBe('HOLD');
        const text = receiptVerdict(base({ sockets: [{ url: 'wss://x/s', frameCount: 50, sentBinaryFrames: 0, receivedBinaryFrames: 0, byteCount: 900 }] }));
        expect(text.verdict).toBe('PASS');
        expect(text.review.length).toBe(1);
    });

    it('CASUALTY: NOT observing payloads is different from observing none', () => {
        const out = receiptVerdict(base({ payloads: null }));
        expect(out.verdict).toBe('HOLD');
        expect(out.problems.join(' ')).toMatch(/payload observation was not enabled/);
    });
});

describe('worker context is preserved, because that is where PCM lives', () => {
    it('CASUALTY: a worker finding is not reported as a main-document one', () => {
        // Private STT runs its model in a Web Worker. A main-document-only tripwire watches the one
        // context least likely to hold PCM, and dropping the tag made the two indistinguishable after
        // the fact.
        const hits = audit([rec({ url: 'https://vendor.example/u', kind: 'audio', mime: null, bytes: 64_000, context: 'worker' })]);
        expect(hits[0].context).toBe('worker');
        expect(hits[0].category).toBe('audio_egress');
    });

    it('a main-document finding defaults to "main"', () => {
        const hits = audit([rec({ url: 'https://vendor.example/u', kind: 'audio', bytes: 10 })]);
        expect(hits[0].context).toBe('main');
    });
});

describe('worker instrumentation fails closed', () => {
    const probe = {
        release: 'r1', requestedCandidate: 'moonshine:streaming-medium',
        observedCandidate: 'moonshine:streaming-medium', identityMatches: true,
        modelStatus: 'ready', runtimeState: 'READY',
    };
    const base = (over = {}) => ({
        probe, expectedCandidate: 'moonshine:streaming-medium', expectedRelease: 'r1',
        payloads: [], sockets: [], phases: ['pre-record', 'recording', 'stop-save'], appOrigin: APP,
        workerInstrumentation: { attached: 1, installed: 1, installFailures: 0, drained: 1, drainFailures: 0 },
        ...over,
    });

    it('CASUALTY: an install FAILURE makes PASS impossible', () => {
        // "Attached" is CDP's doing; installing is ours, and an injected script's exception goes
        // nowhere. A run where every install failed looked identical to a run where nothing was sent —
        // and the second is the claim being made.
        const out = receiptVerdict(base({
            workerInstrumentation: { attached: 1, installed: 0, installFailures: 1, drained: 0, drainFailures: 0 },
        }));
        expect(out.verdict).toBe('HOLD');
        expect(out.problems.join(' ')).toMatch(/install\(s\) failed/);
    });

    it('CASUALTY: workers attached but none instrumented is HOLD', () => {
        const out = receiptVerdict(base({
            workerInstrumentation: { attached: 2, installed: 0, installFailures: 0, drained: 0, drainFailures: 0 },
        }));
        expect(out.verdict).toBe('HOLD');
        expect(out.problems.join(' ')).toMatch(/attached but none were instrumented/);
    });

    it('CASUALTY: an unreadable worker is HOLD', () => {
        const out = receiptVerdict(base({
            workerInstrumentation: { attached: 1, installed: 1, installFailures: 0, drained: 0, drainFailures: 1 },
        }));
        expect(out.verdict).toBe('HOLD');
        expect(out.problems.join(' ')).toMatch(/could not be read back/);
    });

    it('CASUALTY: no instrumentation report at all is HOLD', () => {
        const out = receiptVerdict(base({ workerInstrumentation: null }));
        expect(out.verdict).toBe('HOLD');
        expect(out.problems.join(' ')).toMatch(/worker instrumentation was not reported/);
    });

    it('POSITIVE CONTROL: attached, instrumented and read gives a clean receipt', () => {
        expect(receiptVerdict(base()).verdict).toBe('PASS');
    });

    it('POSITIVE CONTROL: a run with no workers at all is not penalised', () => {
        // Zero attached is not a failure to instrument — there was nothing to instrument.
        expect(receiptVerdict(base({
            workerInstrumentation: { attached: 0, installed: 0, installFailures: 0, drained: 0, drainFailures: 0 },
        })).verdict).toBe('PASS');
    });
});

describe('worker binary does not depend on document state', () => {
    it('CASUALTY: worker opaque binary to a SAME-ORIGIN proxy holds', () => {
        // Worker records carry runtimeState null — a worker has no document — so the
        // same_origin_binary_during_recording rule could never fire for them, and the context holding
        // PCM walked through the one rule meant to catch it.
        const hits = blocking([rec({
            url: `${APP}/api/proxy`, kind: 'binary', bytes: 64_000, context: 'worker', runtimeState: null,
        })]);
        expect(hits).toHaveLength(1);
        expect(hits[0].category).toBe('worker_binary');
    });

    it('CASUALTY: an opaque Request body cannot produce a clean receipt', () => {
        const hits = blocking([rec({ url: 'https://vendor.example/u', kind: 'opaque_stream', bytes: -1 })]);
        expect(hits).toHaveLength(1);
    });

    it('POSITIVE CONTROL: worker TEXT to our own origin is still allowed', () => {
        expect(blocking([rec({ url: `${APP}/api/sessions`, kind: 'json', bytes: 100, context: 'worker' })])).toEqual([]);
    });
});

describe('socket direction is not symmetric', () => {
    const probe = {
        release: 'r1', requestedCandidate: 'moonshine:streaming-medium',
        observedCandidate: 'moonshine:streaming-medium', identityMatches: true,
        modelStatus: 'ready', runtimeState: 'READY',
    };
    const base = (over = {}) => ({
        probe, expectedCandidate: 'moonshine:streaming-medium', expectedRelease: 'r1',
        payloads: [], sockets: [], phases: ['pre-record', 'recording', 'stop-save'], appOrigin: APP,
        workerInstrumentation: { attached: 0, installed: 0, installFailures: 0, drained: 0, drainFailures: 0 },
        ...over,
    });

    it('CASUALTY: ONE outgoing binary frame holds the take', () => {
        const out = receiptVerdict(base({
            sockets: [{ url: 'wss://x/s', frameCount: 10, sentBinaryFrames: 1, receivedBinaryFrames: 0 }],
        }));
        expect(out.verdict).toBe('HOLD');
        expect(out.problems.join(' ')).toMatch(/sent 1 binary frame/);
    });

    it('POSITIVE CONTROL: incoming-only binary passes with an advisory', () => {
        // Inbound bytes cannot establish egress. Scoring both directions the same way held valid takes
        // over servers that simply reply in binary.
        const out = receiptVerdict(base({
            sockets: [{ url: 'wss://x/s', frameCount: 40, sentBinaryFrames: 0, receivedBinaryFrames: 40 }],
        }));
        expect(out.verdict).toBe('PASS');
        expect(out.review.some((s) => s.category === 'websocket_binary_received')).toBe(true);
    });
});
