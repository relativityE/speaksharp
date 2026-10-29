/**
 * #1403 — the receipt authority. Every input is recomputed, and nothing content-bearing survives.
 */
import { describe, it, expect } from 'vitest';
import { auditSockets, receiptVerdict } from '../../scripts/human-test/observer.mjs';
import { createWorkerReadCollector } from '../../scripts/human-test/payloadTripwire.mjs';

describe('actual diagnostic CLI worker collector refuses stale early-read closure', () => {
    const read = records => ({ result: { value: JSON.stringify(records) } });
    const metadata = (over = {}) => ({ t: 1, transport: 'fetch', url: APP, method: 'POST',
        kind: 'text', mime: null, bytes: 12, runtimeState: null, ...over });
    const rig = replies => {
        const commands = [];
        const client = { send: async (...args) => {
            commands.push(args);
            const next = replies.shift();
            if (next instanceof Error) throw next;
            return next;
        } };
        return { commands, collector: createWorkerReadCollector({ client, installedSessions: new Set(['owned-worker']) }) };
    };
    it('early read then late send and final read failure is HOLD, not a completed drain', async () => {
        // The late send is deliberately not in the earlier read. A destroyed execution context cannot
        // tell the collector what was lost, so the absence of a retained finding cannot imply safety.
        const { collector, commands } = rig([read([]), new Error('destroyed after synthetic late send')]);
        await collector.drain();
        const final = await collector.finish();
        expect(final.instrumentation.drained).toBe(0);
        expect(final.instrumentation.drainFailures).toBe(1);
        expect(receiptVerdict(base({ workerInstrumentation: { ...base().workerInstrumentation,
            ...final.instrumentation } })).verdict).toBe('HOLD');
        expect(commands).toHaveLength(2);
    });
    it('a successful final read does not invent a terminal emission count', async () => {
        const { collector } = rig([read([])]);
        const final = await collector.finish();
        expect(final.instrumentation.terminalCompleteness).toBe('UNPROVEN');
        expect(final.instrumentation.drained).toBe(0);
        expect(final.instrumentation.finalEmissionCount).toBeNull();
    });
    it('retained findings survive a later failure without qualifying completeness', async () => {
        const row = metadata({ kind: 'encoded_audio', bytes: 512 });
        const { collector } = rig([read([row]), new Error('gone')]);
        await collector.drain();
        const final = await collector.finish();
        expect(final.payloads).toEqual([{ ...row, context: 'worker' }]);
        expect(final.instrumentation.drained).toBe(0);
    });
    it('seals one immutable receipt and refuses later polling to alter it', async () => {
        const { collector, commands } = rig([read([]), read([{ kind: 'encoded_audio' }])]);
        const final = await collector.finish();
        expect(Object.isFrozen(final)).toBe(true);
        expect(Object.isFrozen(final.instrumentation)).toBe(true);
        expect(Object.isFrozen(final.payloads)).toBe(true);
        await collector.drain();
        expect(await collector.finish()).toBe(final);
        expect(commands).toHaveLength(1);
    });
    for (const [label, reply] of [
        ['CDP exception', { exceptionDetails: {} }],
        ['missing value', {}],
        ['malformed JSON', { result: { value: '{invalid' } }],
        ['non-array', read({ arbitrary: 'not a record list' })],
        ['oversize array', read(Array(513).fill({ kind: 'text' }))],
        ['oversize value', { result: { value: ' '.repeat(262145) } }],
    ]) it(`refuses ${label} without inventing a clean read`, async () => {
        const { collector } = rig([reply]);
        const final = await collector.finish();
        expect(final.instrumentation.finalReadFailures).toBe(1);
        expect(final.instrumentation.drained).toBe(0);
        expect(final.payloads).toEqual([]);
    });
    it('a bounded timeout seals HOLD; a late reply cannot upgrade or alter the result', async () => {
        let resolve;
        const client = { send: () => new Promise(r => { resolve = r; }) };
        const collector = createWorkerReadCollector({ client, installedSessions: new Set(['owned']), readBudgetMs: 5 });
        const final = await collector.finish();
        expect(final.instrumentation.finalReadFailures).toBe(1);
        resolve(read([{ kind: 'encoded_audio' }]));
        await Promise.resolve();
        expect(await collector.finish()).toBe(final);
        expect(final.payloads).toEqual([]);
    });
    it('an outstanding early poll cannot overwrite the sealed final snapshot', async () => {
        let resolve;
        let calls = 0;
        const client = { send: () => ++calls === 1 ? new Promise(r => { resolve = r; }) : Promise.resolve(read([])) };
        const collector = createWorkerReadCollector({ client, installedSessions: new Set(['owned']) });
        const early = collector.drain();
        const final = await collector.finish();
        expect(final.instrumentation.workerReadPending).toBe(true);
        resolve(read([{ kind: 'encoded_audio' }]));
        await early;
        expect(final.payloads).toEqual([]);
        expect(final.instrumentation.drained).toBe(0);
    });
    it('bounds worker state and refuses additional workers without issuing reads', async () => {
        let calls = 0;
        const collector = createWorkerReadCollector({ client: { send: () => { calls += 1; } },
            installedSessions: new Set(Array.from({ length: 33 }, (_, i) => `owned-${i}`)) });
        const final = await collector.finish();
        expect(calls).toBe(0);
        expect(final.instrumentation.workerStateCapExceeded).toBe(true);
        expect(final.instrumentation.drainFailures).toBe(33);
    });
    it('detects a worker-set change during the final read without claiming closure', async () => {
        const sessions = new Set(['owned']);
        const client = { send: async () => { sessions.add('late-owned'); return read([]); } };
        const collector = createWorkerReadCollector({ client, installedSessions: sessions });
        const final = await collector.finish();
        expect(final.instrumentation.workerOwnershipChanged).toBe(true);
        expect(final.instrumentation.drainFailures).toBe(2);
        expect(final.instrumentation.drained).toBe(0);
    });
    it('rejects arbitrary additional fields without retaining worker readback', async () => {
        const { collector } = rig([read([metadata({ body: 'PRIVATE_SYNTHETIC_SENTINEL' })])]);
        const final = await collector.finish();
        expect(JSON.stringify(final)).not.toContain('PRIVATE_SYNTHETIC_SENTINEL');
        expect(final.payloads).toEqual([]);
        expect(final.instrumentation.finalReadFailures).toBe(1);
    });
    describe('worker readback closed schema', () => {
        const sentinel = 'PRIVATE_WORKER_FIELD_SENTINEL';
        for (const field of ['transport', 'method', 'kind', 'mime', 'runtimeState', 't', 'bytes']) {
            it(`rejects a sentinel in recognized ${field} without retaining it`, async () => {
                const { collector } = rig([read([metadata({ [field]: sentinel })])]);
                const final = await collector.finish();
                expect(final.payloads).toEqual([]);
                expect(final.instrumentation.finalReadFailures).toBe(1);
                expect(JSON.stringify(final)).not.toContain(sentinel);
            });
        }
        it('projects valid absolute URLs to origins before retaining any worker evidence', async () => {
            const { collector } = rig([read([metadata({ url: `${APP}/private-path-${sentinel}?token=${sentinel}#${sentinel}` })])]);
            const final = await collector.finish();
            expect(final.instrumentation.finalReadFailures).toBe(0);
            expect(final.payloads).toEqual([{ ...metadata(), context: 'worker' }]);
            expect(JSON.stringify(final)).not.toContain(sentinel);
            expect(JSON.stringify(final)).not.toContain('token=');
        });
        for (const url of [`https://user:${sentinel}@example.invalid/`, `file:///private/${sentinel}`,
            `data:text/plain,${sentinel}`, `/${sentinel}`, `not-a-url-${sentinel}`]) {
            it(`rejects unsafe worker URL shape ${url.split(':')[0]}`, async () => {
                const { collector } = rig([read([metadata({ url })])]);
                const final = await collector.finish();
                expect(final.payloads).toEqual([]);
                expect(final.instrumentation.finalReadFailures).toBe(1);
                expect(JSON.stringify(final)).not.toContain(sentinel);
            });
        }
        for (const [label, over] of [
            ['fractional time', { t: 1.5 }], ['negative time', { t: -1 }],
            ['out-of-range time', { t: 8640000000000001 }], ['missing time type', { t: null }],
            ['fractional bytes', { bytes: 0.5 }], ['negative bytes', { bytes: -2 }],
            ['out-of-range bytes', { bytes: 1048577 }], ['missing byte type', { bytes: null }],
            ['invalid method', { method: null }], ['invalid transport', { transport: 2 }],
            ['invalid kind', { kind: null }], ['incompatible MIME', { mime: 'audio/wav' }],
            ['encoded text MIME', { kind: 'encoded_audio', mime: 'text/plain' }],
            ['encoded binary MIME', { kind: 'encoded_audio', mime: 'application/octet-stream' }],
            ['encoded native-audio MIME', { kind: 'encoded_audio', mime: 'audio/wav' }],
            ['nonempty empty body', { kind: 'empty', bytes: 12 }],
            ['invalid opaque size', { kind: 'opaque_stream', bytes: 12 }],
            ['invalid URL type', { url: 1 }], ['wrong transport scheme', { url: 'wss://example.invalid' }],
        ]) it(`rejects ${label} without retaining an invalid row`, async () => {
            const { collector } = rig([read([metadata(over)])]);
            const final = await collector.finish();
            expect(final.payloads).toEqual([]);
            expect(final.instrumentation.finalReadFailures).toBe(1);
        });
        for (const field of ['t', 'transport', 'url', 'method', 'kind', 'mime', 'bytes', 'runtimeState']) {
            it(`rejects a missing required ${field}`, async () => {
                const row = metadata(); delete row[field];
                const { collector } = rig([read([row])]);
                const final = await collector.finish();
                expect(final.payloads).toEqual([]);
                expect(final.instrumentation.finalReadFailures).toBe(1);
            });
        }
        it('rejects the complete bad batch without retaining an earlier row from that batch', async () => {
            const { collector } = rig([read([metadata(), metadata({ mime: sentinel })])]);
            const final = await collector.finish();
            expect(final.payloads).toEqual([]);
            expect(final.instrumentation.finalReadFailures).toBe(1);
            expect(JSON.stringify(final)).not.toContain(sentinel);
        });
        it('preserves only a previously validated snapshot when a later batch is invalid', async () => {
            const safe = metadata({ kind: 'encoded_audio', bytes: 512 });
            const { collector } = rig([read([safe]), read([metadata({ runtimeState: sentinel })])]);
            await collector.drain();
            const final = await collector.finish();
            expect(final.payloads).toEqual([{ ...safe, context: 'worker' }]);
            expect(final.instrumentation.finalReadFailures).toBe(1);
            expect(JSON.stringify(final)).not.toContain(sentinel);
        });
        it('keeps recognized metadata and explicit opaque failure sentinels content-free', async () => {
            const rows = [metadata(), metadata({ t: 8640000000000000, kind: 'encoded_audio', bytes: 1048576 }),
                metadata({ kind: 'form', mime: 'multipart/form-data', bytes: -1 }),
                metadata({ transport: 'websocket', method: 'SEND', url: 'wss://example.invalid', kind: 'audio', mime: 'audio/wav' }),
                metadata({ url: '', method: 'UNKNOWN', kind: 'unknown', bytes: -1 })];
            const { collector } = rig([read(rows)]);
            const final = await collector.finish();
            expect(final.payloads).toEqual(rows.map(row => ({ ...row, context: 'worker' })));
            expect(final.instrumentation.finalReadFailures).toBe(0);
            expect(final.instrumentation.terminalCompleteness).toBe('UNPROVEN');
            expect(final.instrumentation.drained).toBe(0);
        });
    });
});

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

    it('a prior read then teardown without independently proven finalN is still incomplete', async () => {
        const client = { send: async () => { throw new Error('worker destroyed'); } };
        const collector = createWorkerReadCollector({ client, installedSessions: new Set(['owned']) });
        const final = await collector.finish();
        const out = receiptVerdict(base({ workerInstrumentation: {
            ...base().workerInstrumentation, ...final.instrumentation,
        } }));
        expect(out.verdict).toBe('HOLD');
        expect(final.instrumentation.terminalCompleteness).toBe('UNPROVEN');
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
