// @vitest-environment node
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
import vm from 'node:vm';
import { PAYLOAD_TRIPWIRE, READ_TRIPWIRE, createWorkerReadCollector } from '../../scripts/human-test/payloadTripwire.mjs';
import {
  auditEgress, auditPayloads, receiptVerdict, BLOCKING_PAYLOAD_CATEGORIES,
} from '../../scripts/human-test/observer.mjs';

const APP = 'https://speaksharp-public.vercel.app';
const audit = (records) => auditPayloads(records, { appOrigin: APP });
const blocking = (records) => audit(records).filter((f) => BLOCKING_PAYLOAD_CATEGORIES.includes(f.category));

const rec = (over) => ({ transport: 'fetch', url: `${APP}/api/sessions`, method: 'POST', kind: 'json', mime: 'application/json', bytes: 120, runtimeState: 'READY', ...over });

function injectedProducer() {
    const forwarded = [];
    class Xhr {
        open(method, url) { this.method = method; this.url = url; this.headers = []; }
        setRequestHeader(name, value) { this.headers.push([name, value]); }
        send(body) { forwarded.push({ transport: 'xhr', body, method: this.method, url: this.url, headers: this.headers }); }
    }
    class Socket {
        send(body) { forwarded.push({ transport: 'websocket', body }); }
    }
    const context = vm.createContext({
        URL, URLSearchParams, FormData, Blob, Headers, Request, ReadableStream, TextEncoder,
        ArrayBuffer, Float32Array, Uint8Array,
        location: { href: `${APP}/session` },
        document: { documentElement: { getAttribute: () => 'RECORDING' } },
        fetch: (...args) => { forwarded.push({ transport: 'fetch', body: args[1]?.body, args }); return Promise.resolve('synthetic'); },
        navigator: { sendBeacon: (_url, body) => { forwarded.push({ transport: 'beacon', body }); return true; } },
        XMLHttpRequest: Xhr, WebSocket: Socket,
    });
    vm.runInContext(PAYLOAD_TRIPWIRE, context, { timeout: 1000 });
    return { context, forwarded, run(code) {
        vm.runInContext(code, context, { timeout: 1000 });
        return JSON.parse(vm.runInContext(READ_TRIPWIRE, context, { timeout: 1000 }));
    } };
}

describe('actual injected producer feeds actual payload observer (proposal, no browser)', () => {
    for (const [label, body, mime] of [
        ['URLSearchParams', "new URLSearchParams({entry:JSON.stringify('AQ==')})", 'application/x-www-form-urlencoded'],
        ['FormData', "(()=>{const form=new FormData();form.append('entry',JSON.stringify('AQ=='));return form})()", 'multipart/form-data'],
    ]) it(`actual form MIME promotion ${label} survives the worker collector`, async () => {
        const rig = injectedProducer(); delete rig.context.document;
        const sent = rig.run(`for(let i=0;i<64;i++)fetch('${APP}/api/upload',{method:'POST',body:${body}});`);
        expect(rig.forwarded).toHaveLength(64);
        expect(sent[63]).toMatchObject({ kind: 'encoded_audio', mime, bytes: -1 });
        const collector = createWorkerReadCollector({ installedSessions: new Set(['owned-worker']),
            client: { send: async () => ({ result: { value: vm.runInContext(READ_TRIPWIRE, rig.context) } }) },
        });
        const final = await collector.finish();
        expect(final.instrumentation.finalReadFailures).toBe(0);
        expect(final.payloads).toHaveLength(64);
        expect(final.payloads[63]).toMatchObject({ kind: 'encoded_audio', mime, bytes: -1, context: 'worker' });
        expect(blocking(final.payloads).length).toBeGreaterThan(0);
        expect(final.instrumentation.terminalCompleteness).toBe('UNPROVEN');
        expect(final.instrumentation.drained).toBe(0);
    });
    it('actual producer late send after early read cannot pass when final worker read fails', async () => {
        const rig = injectedProducer();
        delete rig.context.document;
        let reads = 0;
        const collector = createWorkerReadCollector({ installedSessions: new Set(['owned-worker']),
            client: { send: async () => {
                if (++reads === 1) return { result: { value: vm.runInContext(READ_TRIPWIRE, rig.context) } };
                throw new Error('synthetic worker context destroyed after actual send');
            } },
        });
        await collector.drain();
        // This is an actual invocation of the injected transport wrapper, not a prebuilt stats row.
        const sent = rig.run(`fetch('${APP}/api/upload',{method:'POST',body:'A'.repeat(512)})`);
        expect(rig.forwarded).toHaveLength(1);
        expect(blocking(sent)).toHaveLength(1);
        const final = await collector.finish();
        expect(final.payloads).toEqual([]); // The last read failed: the late finding was not retrieved.
        const receipt = receiptVerdict({
            probe: { release: 'synthetic-release', requestedCandidate: 'v2:base.en', observedCandidate: 'v2:base.en',
                identityMatches: true, runtimeState: 'READY', modelStatus: 'ready' },
            expectedCandidate: 'v2:base.en', expectedRelease: 'synthetic-release', appOrigin: APP,
            payloads: final.payloads, sockets: [], egress: [],
            phases: ['pre-record', 'recording', 'stop-save', 'terminal'],
            workerInstrumentation: { attached: 1, installed: 1, installFailures: 0,
                networkEnabled: 1, networkFailures: 0, setupPending: 0, mainTripwireInstalled: true,
                ...final.instrumentation },
        });
        expect(receipt.verdict, 'an unread late audio send must not borrow an earlier empty read').toBe('HOLD');
    });
    const send = body => `fetch('${APP}/api/upload',{method:'POST',body:${body}})`;
    for (const [label, body] of [
        ['whole base64', "'A'.repeat(512)"],
        ['data URI', "'data:audio/wav;base64,AAAA'"],
        ['numeric JSON array', 'JSON.stringify(Array.from({length:32},(_,i)=>i/32))'],
        ['numeric typed JSON object', 'JSON.stringify(new Float32Array(32))'],
        ['nested JSON', "JSON.stringify({detail:JSON.stringify({audio_data:'AAAA'})})"],
        ['chunked audio field', "JSON.stringify({audio_samples:Array(64).fill('AAAA')})"],
        ['encoded property name', "JSON.stringify({['A'.repeat(256)]:''})"],
        ['within-envelope fragments', "JSON.stringify(Object.fromEntries(Array.from({length:8},(_,i)=>['part_'+i,'A'.repeat(32)])))"],
        ['URLSearchParams', "new URLSearchParams({payload:JSON.stringify({pcm_data:'AAAA'})})"],
        ['PCM', 'new Float32Array(32)'],
        ['binary', 'new Uint8Array(64)'],
        ['audio Blob', "new Blob(['synthetic'],{type:'audio/webm'})"],
        ['stream', 'new ReadableStream()'],
    ]) it(`blocks ${label} from actual producer records`, () => {
        const rig = injectedProducer(); const records = rig.run(send(body));
        expect(records).toHaveLength(1); expect(rig.forwarded).toHaveLength(1);
        expect(blocking(records)).toHaveLength(1);
    });
    it('blocks scalar JSON encoding and serialized URL-encoded audio using real Headers', () => {
        for (const code of [
            `fetch('${APP}/api/upload',{method:'POST',headers:new Headers({'content-type':'application/json'}),body:JSON.stringify('A'.repeat(512))})`,
            `fetch('${APP}/api/upload',{method:'POST',headers:new Headers({'content-type':'application/x-www-form-urlencoded'}),body:'audio_bytes=AAAA'})`,
        ]) expect(blocking(injectedProducer().run(code))).toHaveLength(1);
    });
    it('inspects multipart text fields and treats nonempty non-audio Blob parts as opaque', () => {
        for (const value of ["'AAAA'", "new Blob(['synthetic opaque'],{type:'text/plain'})"]) {
            const records = injectedProducer().run(`const form=new FormData();form.append('audio_data',${value});${send('form')}`);
            expect(blocking(records)).toHaveLength(1);
        }
    });
    it('keeps ordinary transcript, telemetry and non-audio forms eligible', () => {
        for (const code of [
            send("JSON.stringify({transcript:'Ordinary synthetic speech with a useful point.'})"),
            "fetch('https://us.i.posthog.com/e/',{method:'POST',body:JSON.stringify({event:'session_saved',duration:5})})",
            `const form=new FormData();form.append('transcript','Ordinary synthetic text with spaces.');${send('form')}`,
        ]) expect(blocking(injectedProducer().run(code))).toEqual([]);
    });
    it('uses actual xhr, beacon and WebSocket producers without changing forwarding', () => {
        for (const code of [
            `const x=new XMLHttpRequest();x.open('POST','${APP}/api/upload');x.send('A'.repeat(512));`,
            `navigator.sendBeacon('${APP}/api/upload','A'.repeat(512));`,
            `const socket=new WebSocket('wss://synthetic.invalid');socket.send('A'.repeat(512));`,
        ]) { const rig = injectedProducer(); expect(blocking(rig.run(code))).toHaveLength(1); expect(rig.forwarded).toHaveLength(1); }
    });
    it('treats Request body streams as opaque and never reads or consumes them', () => {
        const rig = injectedProducer();
        const records = rig.run(`const request=new Request('${APP}/api/upload',{method:'POST',body:'synthetic'});fetch(request);globalThis.used=request.bodyUsed;`);
        expect(rig.context.used).toBe(false); expect(blocking(records)).toHaveLength(1);
    });
    it('arbitrary BodyInit coercion cannot borrow a clean JSON-object verdict', () => {
        const records = injectedProducer().run(`const value={toString(){return 'A'.repeat(512)}};${send('value')}`);
        expect(blocking(records)).toHaveLength(1);
    });
    it('aggregates bounded tiny frames without retaining their values', () => {
        const rig = injectedProducer(); const records = rig.run(`const socket=new WebSocket('wss://synthetic.invalid');for(let i=0;i<64;i++)socket.send('AAAA');`);
        expect(records).toHaveLength(64); expect(blocking(records).length).toBeGreaterThan(0);
        expect(JSON.stringify(records)).not.toContain('AAAA');
    });
    for (const [label, code] of [
        ['input', send("'x'.repeat(262145)")],
        ['fields', send("JSON.stringify(Object.fromEntries(Array.from({length:129},(_,i)=>['field_'+i,'ordinary text'])))")],
        ['nodes', send("JSON.stringify(Array(128).fill('ordinary text with spaces'))")],
        ['depth', send("JSON.stringify(Array.from({length:8}).reduce(x=>({nested:x}),{}))")],
        ['malformed JSON', send("'{invalid synthetic JSON'")],
        ['throwing accessor', `const value={};Object.defineProperty(value,'secret',{enumerable:true,get(){throw Error('private sentinel')}});${send('value')}`],
        ['state', "for(let i=0;i<65;i++)fetch('https://state'+i+'.invalid',{method:'POST',body:'AAAA'});"],
        ['records', `for(let i=0;i<513;i++)${send("'ordinary text with spaces'")};`],
    ]) it(`exhausted ${label} becomes blocking opaque evidence`, () => {
        const records = injectedProducer().run(code);
        expect(records.length).toBeLessThanOrEqual(512); expect(blocking(records).length).toBeGreaterThan(0);
    });
    it('retains neither payload text nor field names, MIME tricks, query values or raw exception text', () => {
        const rig = injectedProducer(); const records = rig.run(`fetch('${APP}/api/upload?secret_query=PRIVATE_QUERY_SENTINEL',{method:'POST',body:JSON.stringify({PRIVATE_FIELD_SENTINEL:'PRIVATE_BODY_SENTINEL'})});`);
        const evidence = JSON.stringify({ records, findings: audit(records) });
        for (const text of ['PRIVATE_FIELD_SENTINEL','PRIVATE_BODY_SENTINEL','PRIVATE_QUERY_SENTINEL','secret_query']) expect(evidence).not.toContain(text);
        expect(records[0].url).toBe(APP);
        const mime = injectedProducer().run(`fetch('${APP}/api/upload',{method:'POST',body:new Blob(['synthetic'],{type:'audio/PRIVATE_MIME_SENTINEL'})})`);
        expect(JSON.stringify({ records: mime, findings: audit(mime) }).toLowerCase()).not.toContain('private_mime_sentinel');
        const failed = injectedProducer().run(`const form=new FormData();form.entries=function*(){throw Error('PRIVATE_ITERATOR_SENTINEL')};${send('form')}`);
        expect(blocking(failed)).toHaveLength(1); expect(JSON.stringify(failed)).not.toContain('PRIVATE_ITERATOR_SENTINEL');
    });
});

describe('MIME-independent actual producer transport forms', () => {
    it('ordinary repeated session UUID metadata is not an audio-frame stream', () => {
        const records = injectedProducer().run(`for(let i=0;i<16;i++)fetch('${APP}/rest/v1/rpc/heartbeat_session',{method:'POST',body:JSON.stringify({p_session_id:'d1000000-0000-4000-8000-000000000001',current_duration:i})});`);
        expect(blocking(records)).toEqual([]);
    });
    it('ordinary repeated telemetry event identifiers are not an audio-frame stream', () => {
        const records = injectedProducer().run("for(let i=0;i<16;i++)fetch('https://us.i.posthog.com/e/',{method:'POST',body:JSON.stringify({event:'session_saved',event_id:i.toString(16).padStart(32,'0')})});");
        expect(blocking(records)).toEqual([]);
    });
    for (const token of ['AQ==', 'AQI=']) {
        it(`preserves padded scalar ${token} before inferred form parsing`, () => {
            const records = injectedProducer().run(`const socket=new WebSocket('wss://synthetic.invalid');for(let i=0;i<64;i++)socket.send('${token}');`);
            expect(records).toHaveLength(64); expect(blocking(records).length).toBeGreaterThan(0);
        });
        it(`preserves root JSON scalar ${token} across repeated sends`, () => {
            const records = injectedProducer().run(`for(let i=0;i<64;i++)fetch('${APP}/api/upload',{method:'POST',headers:new Headers({'content-type':'application/json'}),body:JSON.stringify('${token}')});`);
            expect(records).toHaveLength(64); expect(blocking(records).length).toBeGreaterThan(0);
        });
        it(`explicit form MIME cannot make ambiguous scalar ${token} clean`, () => {
            const records = injectedProducer().run(`fetch('${APP}/api/upload',{method:'POST',headers:new Headers({'content-type':'application/x-www-form-urlencoded'}),body:'${token}'});`);
            expect(blocking(records)).toHaveLength(1);
        });
    }
    it('keeps explicit ordinary empty and text form fields nonblocking', () => {
        const records = injectedProducer().run(`fetch('${APP}/api/sessions',{method:'POST',headers:new Headers({'content-type':'application/x-www-form-urlencoded'}),body:'field=&topic=ordinary+synthetic+prose'});`);
        expect(blocking(records)).toEqual([]);
    });
    for (const [label, headers] of [
        ['tuple-array HeadersInit', "[['content-type','application/json']]"],
        ['mixed-case object HeadersInit', "{'cOnTeNt-TyPe':'application/json'}"],
    ]) it(`blocks quoted JSON via ${label} and forwards original Fetch arguments`, () => {
        const rig = injectedProducer();
        const records = rig.run(`globalThis.init={method:'POST',headers:${headers},body:JSON.stringify('A'.repeat(512))};fetch('${APP}/api/upload',init);`);
        expect(blocking(records)).toHaveLength(1);
        expect(rig.forwarded).toHaveLength(1);
        expect(rig.forwarded[0].args[0]).toBe(`${APP}/api/upload`);
        expect(rig.forwarded[0].args[1]).toBe(rig.context.init);
        expect(rig.forwarded[0].args[1].headers).toBe(rig.context.init.headers);
        expect(rig.forwarded[0].body).toBe(rig.context.init.body);
    });
    for (const [label, mime, body] of [
        ['JSON scalar', 'application/json', "JSON.stringify('A'.repeat(512))"],
        ['URL-encoded', 'application/x-www-form-urlencoded', "'audio_bytes=AAAA'"],
    ]) it(`blocks XHR ${label} and forwards native header/body calls unchanged`, () => {
        const rig = injectedProducer();
        const records = rig.run(`const xhr=new XMLHttpRequest();globalThis.body=${body};xhr.open('POST','${APP}/api/upload');xhr.setRequestHeader('CoNtEnT-TyPe','${mime}');xhr.send(body);`);
        expect(blocking(records)).toHaveLength(1); expect(rig.forwarded).toHaveLength(1);
        expect(rig.forwarded[0].method).toBe('POST'); expect(rig.forwarded[0].url).toBe(`${APP}/api/upload`);
        expect(rig.forwarded[0].headers).toEqual([['CoNtEnT-TyPe', mime]]);
        expect(rig.forwarded[0].body).toBe(rig.context.body);
    });
});

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

    it('CASUALTY: encoding audio as base64 or numeric JSON does not authorise it', () => {
        const hits = blocking([
            rec({ url: `${APP}/api/upload`, kind: 'encoded_audio', mime: null, bytes: 512 }),
            rec({ url: 'https://us.i.posthog.com/e/', kind: 'encoded_audio', mime: 'application/json', bytes: 1_024 }),
        ]);
        expect(hits.map((hit) => hit.category)).toEqual(['same_origin_audio', 'audio_egress']);
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
        payloads: [], sockets: [], phases: ['pre-record', 'recording', 'stop-save', 'terminal'], appOrigin: APP,
        workerInstrumentation: { attached: 1, installed: 1, installFailures: 0, drained: 1, drainFailures: 0, mainTripwireInstalled: true, networkEnabled: 1, networkFailures: 0, setupPending: 0 },
    egress: [],
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
        payloads: [], sockets: [], phases: ['pre-record', 'recording', 'stop-save', 'terminal'], appOrigin: APP,
        workerInstrumentation: { attached: 1, installed: 1, installFailures: 0, drained: 1, drainFailures: 0, mainTripwireInstalled: true, networkEnabled: 1, networkFailures: 0, setupPending: 0 },
    egress: [],
        ...over,
    });

    it('CASUALTY: an install FAILURE makes PASS impossible', () => {
        // "Attached" is CDP's doing; installing is ours, and an injected script's exception goes
        // nowhere. A run where every install failed looked identical to a run where nothing was sent —
        // and the second is the claim being made.
        const out = receiptVerdict(base({
            workerInstrumentation: { attached: 1, installed: 0, installFailures: 1, drained: 0, drainFailures: 0, mainTripwireInstalled: true, networkEnabled: 1, networkFailures: 0, setupPending: 0 },
        }));
        expect(out.verdict).toBe('HOLD');
        expect(out.problems.join(' ')).toMatch(/install\(s\) failed/);
    });

    it('CASUALTY: workers attached but none instrumented is HOLD', () => {
        const out = receiptVerdict(base({
            workerInstrumentation: { attached: 2, installed: 0, installFailures: 0, drained: 0, drainFailures: 0, mainTripwireInstalled: true, networkEnabled: 1, networkFailures: 0, setupPending: 0 },
        }));
        expect(out.verdict).toBe('HOLD');
        expect(out.problems.join(' ')).toMatch(/attached but none were instrumented/);
    });

    it('CASUALTY: an unreadable worker is HOLD', () => {
        const out = receiptVerdict(base({
            workerInstrumentation: { attached: 1, installed: 1, installFailures: 0, drained: 0, drainFailures: 1, mainTripwireInstalled: true, networkEnabled: 1, networkFailures: 0, setupPending: 0 },
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

    it('CASUALTY: a run with NO instrumented worker cannot PASS', () => {
        // This test previously asserted the opposite — that zero workers "is not a failure to
        // instrument, there was nothing to instrument". That reasoning encoded the false pass: for this
        // product Private STT decodes in a Web Worker, so a take with no instrumented worker means the
        // context holding PCM was never watched. "No findings" then describes where we looked, not what
        // happened, and the guard only fired when workers had attached — so a run that attached nothing
        // sailed through with zero problems.
        const out = receiptVerdict(base({
            workerInstrumentation: { attached: 0, installed: 0, installFailures: 0, drained: 0, drainFailures: 0, mainTripwireInstalled: true, networkEnabled: 1, networkFailures: 0, setupPending: 0 },
        }));
        expect(out.verdict).toBe('HOLD');
        expect(out.problems.join(' ')).toMatch(/the context that holds PCM was not observed/);
    });

    it('CASUALTY: an unconfirmed MAIN tripwire cannot PASS', () => {
        // An absent installer and a page that sent nothing produce identical evidence — an empty payload
        // list — and only one of them is a clean run. Its presence was never checked at all.
        const out = receiptVerdict(base({
            workerInstrumentation: { attached: 1, installed: 1, installFailures: 0, drained: 1, drainFailures: 0, mainTripwireInstalled: false, networkEnabled: 1, networkFailures: 0, setupPending: 0 },
        }));
        expect(out.verdict).toBe('HOLD');
        expect(out.problems.join(' ')).toMatch(/main-document tripwire was not confirmed/);
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
        payloads: [], sockets: [], phases: ['pre-record', 'recording', 'stop-save', 'terminal'], appOrigin: APP,
        workerInstrumentation: { attached: 1, installed: 1, installFailures: 0, drained: 1, drainFailures: 0, mainTripwireInstalled: true, networkEnabled: 1, networkFailures: 0, setupPending: 0 },
    egress: [],
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

describe('captured audio outlives the RECORDING state', () => {
    const probe = {
        release: 'r1', requestedCandidate: 'moonshine:streaming-medium',
        observedCandidate: 'moonshine:streaming-medium', identityMatches: true,
        modelStatus: 'ready', runtimeState: 'READY',
    };
    const base = (over = {}) => ({
        probe, expectedCandidate: 'moonshine:streaming-medium', expectedRelease: 'r1',
        payloads: [], sockets: [], phases: ['pre-record', 'recording', 'stop-save', 'terminal'], appOrigin: APP,
        workerInstrumentation: { attached: 1, installed: 1, installFailures: 0, drained: 1, drainFailures: 0, mainTripwireInstalled: true, networkEnabled: 1, networkFailures: 0, setupPending: 0 },
    egress: [],
        ...over,
    });

    it('CASUALTY: same-origin opaque binary during STOPPING holds', () => {
        // The window tested was `runtimeState === 'RECORDING'` exactly, so bytes leaving during stop —
        // which is when a take's audio would actually be uploaded — read as ordinary traffic.
        const out = receiptVerdict(base({
            payloads: [rec({ url: `${APP}/api/x`, kind: 'binary', bytes: 90_000, runtimeState: 'STOPPING' })],
        }));
        expect(out.verdict).toBe('HOLD');
    });

    it('CASUALTY: opaque binary AFTER the state returns to READY still holds once a take has been recorded', () => {
        // Placed by TIMESTAMP relative to when recording began, not by a run-wide flag: the record is
        // after the take started, so captured audio existed when it was sent.
        const out = receiptVerdict(base({
            recordingStartedAt: 1_000,
            payloads: [rec({ url: `${APP}/api/save`, kind: 'opaque_stream', bytes: -1, runtimeState: 'READY', t: 2_000 })],
        }));
        expect(out.verdict).toBe('HOLD');
    });

    it('POSITIVE CONTROL: the same bytes BEFORE any recording are not a violation', () => {
        // No take has happened, so no captured audio exists to send. Holding here would flag ordinary
        // startup traffic and teach the operator to skim.
        const out = receiptVerdict(base({
            phases: ['pre-record'],
            recordingStartedAt: null,
            payloads: [rec({ url: `${APP}/api/x`, kind: 'binary', bytes: 90_000, runtimeState: 'READY', t: 500 })],
        }));
        expect(out.problems.filter((p) => /binary|audio/.test(p))).toEqual([]);
    });

    it('POSITIVE CONTROL: transcript TEXT at stop/save is still allowed', () => {
        const out = receiptVerdict(base({
            payloads: [rec({ url: `${APP}/api/sessions`, kind: 'json', bytes: 12_000, runtimeState: 'STOPPING' })],
        }));
        expect(out.verdict).toBe('PASS');
    });
});

describe('the request-level audit reaches the verdict', () => {
    const probe = {
        release: 'r1', requestedCandidate: 'moonshine:streaming-medium',
        observedCandidate: 'moonshine:streaming-medium', identityMatches: true,
        modelStatus: 'ready', runtimeState: 'READY',
    };
    const base = (over = {}) => ({
        probe, expectedCandidate: 'moonshine:streaming-medium', expectedRelease: 'r1',
        payloads: [], sockets: [], phases: ['pre-record', 'recording', 'stop-save', 'terminal'], appOrigin: APP,
        workerInstrumentation: { attached: 1, installed: 1, installFailures: 0, drained: 1, drainFailures: 0, mainTripwireInstalled: true, networkEnabled: 1, networkFailures: 0, setupPending: 0 },
        egress: [],
        ...over,
    });

    it('CASUALTY: an unaccounted request holds the take', () => {
        // `requests` was collected on every requestWillBeSent and then dropped: auditEgress -- exact
        // pinned-asset matching, unknown same-origin paths, queries on known operations, unrecognised
        // off-origin channels -- had no effect on the executable verdict. Those rules were tested and
        // true and simply not wired to anything, which is worse than not having them: the receipt read
        // as though they had run.
        const out = receiptVerdict(base({
            egress: [{ origin: 'https://unknown.example', route: 'other', routeHash: 'abc123def456', category: 'off_origin_unrecognised' }],
        }));
        expect(out.verdict).toBe('HOLD');
        expect(out.problems.join(' ')).toMatch(/off_origin_unrecognised/);
    });

    it('CASUALTY: not auditing requests at all is HOLD', () => {
        const out = receiptVerdict(base({ egress: null }));
        expect(out.verdict).toBe('HOLD');
        expect(out.problems.join(' ')).toMatch(/request-level egress was not audited/);
    });

    it('POSITIVE CONTROL: an audited run with no findings still passes', () => {
        expect(receiptVerdict(base()).verdict).toBe('PASS');
    });
});

describe('a read that fails is not a read that found nothing', () => {
    const probe = {
        release: 'r1', requestedCandidate: 'moonshine:streaming-medium',
        observedCandidate: 'moonshine:streaming-medium', identityMatches: true,
        modelStatus: 'ready', runtimeState: 'READY',
    };
    const base = (over = {}) => ({
        probe, expectedCandidate: 'moonshine:streaming-medium', expectedRelease: 'r1',
        payloads: [], sockets: [], phases: ['pre-record', 'recording', 'stop-save', 'terminal'], appOrigin: APP,
        workerInstrumentation: { attached: 1, installed: 1, installFailures: 0, drained: 1, drainFailures: 0, mainTripwireInstalled: true, networkEnabled: 1, networkFailures: 0, setupPending: 0 },
        egress: [],
        ...over,
    });

    it('CASUALTY: a main tripwire that exists but could not be READ is HOLD', () => {
        // Array presence alone was the check. The array can exist while the read that retrieves it
        // fails, and an installed-but-unreadable tripwire yields the same empty list as a page that
        // sent nothing.
        const out = receiptVerdict(base({
            workerInstrumentation: {
                attached: 1, installed: 1, installFailures: 0, drained: 1, drainFailures: 0,
                mainTripwireInstalled: false, mainReadOk: false,
            },
        }));
        expect(out.verdict).toBe('HOLD');
        expect(out.problems.join(' ')).toMatch(/main-document tripwire was not confirmed/);
    });

    it('CASUALTY: a FINAL worker read failure is not erased by an earlier success', () => {
        // `drainedOk` was a monotonic Set, so one early success permanently marked a worker readable and
        // a final read failure — the one that decides whether the retained evidence is complete — was
        // erased. A worker that stopped responding halfway through a take scored as fully observed.
        const out = receiptVerdict(base({
            workerInstrumentation: {
                attached: 1, installed: 1, installFailures: 0, drained: 0, drainFailures: 1,
                mainTripwireInstalled: true, mainReadOk: true,
            },
        }));
        expect(out.verdict).toBe('HOLD');
        expect(out.problems.join(' ')).toMatch(/could not be read back/);
    });

    it('POSITIVE CONTROL: a worker readable at the end is reported as drained', () => {
        expect(receiptVerdict(base({
            workerInstrumentation: {
                attached: 1, installed: 1, installFailures: 0, drained: 1, drainFailures: 0,
                mainTripwireInstalled: true, mainReadOk: true, networkEnabled: 1, networkFailures: 0, setupPending: 0,
            },
        })).verdict).toBe('PASS');
    });
});

describe('the receipt says WHY it held', () => {
    const probe = {
        release: 'r1', requestedCandidate: 'moonshine:streaming-medium',
        observedCandidate: 'moonshine:streaming-medium', identityMatches: true,
        modelStatus: 'ready', runtimeState: 'READY',
    };
    const base = (over = {}) => ({
        probe, expectedCandidate: 'moonshine:streaming-medium', expectedRelease: 'r1',
        payloads: [], sockets: [], phases: ['pre-record', 'recording', 'stop-save', 'terminal'], appOrigin: APP,
        workerInstrumentation: { attached: 1, installed: 1, installFailures: 0, drained: 1, drainFailures: 0, mainTripwireInstalled: true, mainReadOk: true, networkEnabled: 1, networkFailures: 0, setupPending: 0 },
        egress: [],
        ...over,
    });

    it('CASUALTY: audio leaving is a PRIVACY hold', () => {
        // A privacy hold means the take is evidence of a product defect and the run must stop.
        const out = receiptVerdict(base({
            payloads: [rec({ url: 'https://vendor.example/u', kind: 'audio', mime: 'audio/webm', bytes: 480_000 })],
        }));
        expect(out.verdict).toBe('HOLD');
        expect(out.holdKind).toBe('privacy');
        expect(out.privacyProblems.length).toBe(1);
    });

    it('CASUALTY: incomplete observation is a PROOF hold, not a privacy one', () => {
        // A proof hold says nothing about the product — the take is unusable and re-running it is the
        // right response. Collapsing the two invites a run of proof holds to be read as a privacy
        // problem, or a privacy hold to be dismissed as flaky instrumentation.
        const out = receiptVerdict(base({
            workerInstrumentation: { attached: 1, installed: 0, installFailures: 1, drained: 0, drainFailures: 0, mainTripwireInstalled: true, mainReadOk: true, networkEnabled: 1, networkFailures: 0, setupPending: 0 },
        }));
        expect(out.verdict).toBe('HOLD');
        expect(out.holdKind).toBe('proof');
        expect(out.privacyProblems).toEqual([]);
    });

    it('CASUALTY: a socket sending binary is a PRIVACY hold', () => {
        const out = receiptVerdict(base({
            sockets: [{ url: 'wss://x/s', frameCount: 5, sentBinaryFrames: 5, receivedBinaryFrames: 0 }],
        }));
        expect(out.holdKind).toBe('privacy');
    });

    it('CASUALTY: privacy outranks proof when both are present', () => {
        // If audio may have left, that is the headline regardless of what else went wrong.
        const out = receiptVerdict(base({
            payloads: [rec({ url: 'https://vendor.example/u', kind: 'audio', bytes: 10 })],
            workerInstrumentation: { attached: 1, installed: 0, installFailures: 1, drained: 0, drainFailures: 0, mainTripwireInstalled: true, mainReadOk: true, networkEnabled: 1, networkFailures: 0, setupPending: 0 },
        }));
        expect(out.holdKind).toBe('privacy');
        expect(out.proofProblems.length).toBeGreaterThan(0);
    });

    it('POSITIVE CONTROL: expected text traffic produces neither kind of hold', () => {
        const out = receiptVerdict(base({
            payloads: [
                rec({ url: 'https://o1.ingest.us.sentry.io/api/envelope', kind: 'text', bytes: 900 }),
                rec({ url: `${APP}/api/sessions`, kind: 'json', bytes: 12_000, runtimeState: 'STOPPING' }),
            ],
        }));
        expect(out.verdict).toBe('PASS');
        expect(out.holdKind).toBeNull();
    });
});

describe('the COMBINED path: a real ordinary take passes both audits', () => {
    const CANDIDATE = 'moonshine:streaming-medium';
    const probe = {
        release: 'r1', requestedCandidate: CANDIDATE, observedCandidate: CANDIDATE,
        identityMatches: true, modelStatus: 'ready', runtimeState: 'READY',
    };
    const START = 1_000_000;

    /**
     * Builds the receipt from REAL audits over the same traffic, rather than supplying `egress: []`.
     * Every positive control until now stubbed the request audit out, so none of them exercised the
     * integration the false HOLD lived in — the assertions were correct and positioned where the
     * failure could not reach them.
     */
    const receiptFor = (requests, payloads, recordingStartedAt = START) => receiptVerdict({
        probe, expectedCandidate: CANDIDATE, expectedRelease: 'r1',
        payloads, sockets: [], phases: ['pre-record', 'recording', 'stop-save', 'terminal'], appOrigin: APP,
        workerInstrumentation: { attached: 1, installed: 1, installFailures: 0, drained: 1, drainFailures: 0, mainTripwireInstalled: true, mainReadOk: true, networkEnabled: 1, networkFailures: 0, setupPending: 0 },
        egress: auditEgress(requests, { appOrigin: APP, observedCandidate: CANDIDATE }),
        recordingStartedAt,
    });

    it('POSITIVE CONTROL: transcript persistence and vendor traffic pass BOTH audits', () => {
        // `auditEgress` knows only WHERE a request went, so it necessarily flags the transcript JSON we
        // deliberately persist and every Sentry/PostHog POST as bodies going somewhere. Blocking on that
        // reintroduced the exact false HOLD the payload work removed — and a check that holds every
        // valid take is one that gets switched off.
        const out = receiptFor(
            [
                { url: `${APP}/api/sessions`, method: 'POST', hasPostData: true },
                { url: 'https://o1.ingest.us.sentry.io/api/envelope', method: 'POST', hasPostData: true },
                { url: 'https://us.i.posthog.com/e/', method: 'POST', hasPostData: true },
                { url: 'https://us-assets.i.posthog.com/static/array.js', method: 'GET' },
                { url: `${APP}/assets/index.js`, method: 'GET' },
            ],
            [
                rec({ url: `${APP}/api/sessions`, kind: 'json', bytes: 12_000, runtimeState: 'STOPPING', t: START + 500 }),
                rec({ url: 'https://o1.ingest.us.sentry.io/api/envelope', kind: 'text', bytes: 800, t: START + 10 }),
                rec({ url: 'https://us.i.posthog.com/e/', kind: 'json', bytes: 400, t: START + 20 }),
            ],
        );
        expect(out.problems).toEqual([]);
        expect(out.verdict).toBe('PASS');
        expect(out.holdKind).toBeNull();
    });

    it('CASUALTY: a genuinely unknown destination still holds through the combined path', () => {
        const out = receiptFor([{ url: 'https://unknown.example/collect', method: 'GET' }], []);
        expect(out.verdict).toBe('HOLD');
        expect(out.problems.join(' ')).toMatch(/off_origin_unrecognised/);
    });

    it('CASUALTY: audio to an EXPECTED vendor still holds — recognised is not trusted', () => {
        // The request audit accounts for the destination; whether audio went there is the payload
        // audit's question, and being on the vendor list changes nothing about that.
        const out = receiptFor(
            [{ url: 'https://us.i.posthog.com/e/', method: 'POST', hasPostData: true }],
            [rec({ url: 'https://us.i.posthog.com/e/', kind: 'audio', mime: 'audio/webm', bytes: 480_000, t: START + 5 })],
        );
        expect(out.verdict).toBe('HOLD');
        expect(out.holdKind).toBe('privacy');
    });
});

describe('recording time is per-record, not per-run', () => {
    const CANDIDATE = 'moonshine:streaming-medium';
    const probe = {
        release: 'r1', requestedCandidate: CANDIDATE, observedCandidate: CANDIDATE,
        identityMatches: true, modelStatus: 'ready', runtimeState: 'READY',
    };
    const START = 2_000_000;
    const base = (over = {}) => ({
        probe, expectedCandidate: CANDIDATE, expectedRelease: 'r1',
        payloads: [], sockets: [], phases: ['pre-record', 'recording', 'stop-save', 'terminal'], appOrigin: APP,
        workerInstrumentation: { attached: 1, installed: 1, installFailures: 0, drained: 1, drainFailures: 0, mainTripwireInstalled: true, mainReadOk: true, networkEnabled: 1, networkFailures: 0, setupPending: 0 },
        egress: [], recordingStartedAt: START, ...over,
    });

    it('CASUALTY: a STARTUP opaque request in a run that later records is NOT a privacy hold', () => {
        // `recordingBegun` was one flag computed at the end of the run and applied to every retained
        // record, so a request sent before any recording — when no captured audio existed — was judged
        // as during-take. That is a false PRIVACY hold: it accuses the product of leaking audio it did
        // not have. The earlier positive control could not catch it, because it used a run whose phases
        // never included 'recording' at all.
        const out = receiptVerdict(base({
            payloads: [rec({ url: `${APP}/api/x`, kind: 'binary', bytes: 90_000, runtimeState: 'READY', t: START - 5_000 })],
        }));
        expect(out.verdict).toBe('PASS');
        expect(out.holdKind).toBeNull();
    });

    it('CASUALTY: the same request AFTER recording began is a privacy hold', () => {
        const out = receiptVerdict(base({
            payloads: [rec({ url: `${APP}/api/x`, kind: 'binary', bytes: 90_000, runtimeState: 'READY', t: START + 5_000 })],
        }));
        expect(out.verdict).toBe('HOLD');
        expect(out.holdKind).toBe('privacy');
    });

    it('a record that reports STOPPING is during the take regardless of its timestamp', () => {
        const out = receiptVerdict(base({
            payloads: [rec({ url: `${APP}/api/x`, kind: 'binary', bytes: 10, runtimeState: 'STOPPING', t: START - 1 })],
        }));
        expect(out.holdKind).toBe('privacy');
    });
});

describe('worker requests are observed, and origin alone launders nothing', () => {
    const CANDIDATE = 'moonshine:streaming-medium';
    const probe = {
        release: 'r1', requestedCandidate: CANDIDATE, observedCandidate: CANDIDATE,
        identityMatches: true, modelStatus: 'ready', runtimeState: 'READY',
    };
    const WORKERS_OK = {
        attached: 1, installed: 1, installFailures: 0, drained: 1, drainFailures: 0,
        mainTripwireInstalled: true, mainReadOk: true, networkEnabled: 1, networkFailures: 0, setupPending: 0,
    };
    const receiptFor = (requests, over = {}) => receiptVerdict({
        probe, expectedCandidate: CANDIDATE, expectedRelease: 'r1',
        payloads: [], sockets: [], phases: ['pre-record', 'recording', 'stop-save', 'terminal'], appOrigin: APP,
        workerInstrumentation: WORKERS_OK,
        egress: auditEgress(requests, { appOrigin: APP, observedCandidate: CANDIDATE }),
        recordingStartedAt: 1_000, ...over,
    });

    it('CASUALTY: a worker query GET to an unknown OFF-ORIGIN host holds', () => {
        // Network was enabled on the root session only, so a worker's own requests were never reported
        // and this never reached any audit. A query-bearing GET carries its data in the URL, so there is
        // no body for the payload audit to classify either.
        const out = receiptFor([{ url: 'https://unknown.example/collect?d=SECRET', method: 'GET', context: 'worker' }]);
        expect(out.verdict).toBe('HOLD');
        expect(out.holdKind).toBe('proof');
        expect(JSON.stringify(out)).not.toContain('SECRET');
    });

    it('CASUALTY: a worker query GET to an unknown SAME-ORIGIN path holds', () => {
        const out = receiptFor([{ url: `${APP}/collect?d=SECRET`, method: 'GET', context: 'worker' }]);
        expect(out.verdict).toBe('HOLD');
        expect(JSON.stringify(out)).not.toContain('SECRET');
    });

    it('CASUALTY: workers attached with NO network observation is a proof HOLD', () => {
        // "We attached" is not "we are watching". Enabling Network on the root session says nothing
        // about the workers.
        const out = receiptFor([], {
            workerInstrumentation: { ...WORKERS_OK, networkEnabled: 0 },
        });
        expect(out.verdict).toBe('HOLD');
        expect(out.holdKind).toBe('proof');
        expect(out.problems.join(' ')).toMatch(/no network observation/);
    });

    it('CASUALTY: a failed worker Network.enable is a proof HOLD', () => {
        const out = receiptFor([], {
            workerInstrumentation: { ...WORKERS_OK, networkFailures: 1 },
        });
        expect(out.verdict).toBe('HOLD');
        expect(out.problems.join(' ')).toMatch(/could not have network observation enabled/);
    });

    it('CASUALTY: a query-bearing GET to an EXPECTED vendor cannot pass on origin alone', () => {
        // Being on the vendor list accounts for the destination, not for data in the URL. Laundering a
        // query through the one exception we granted is exactly the hole a vendor allowlist creates.
        const out = receiptFor([{ url: 'https://us.i.posthog.com/e/?d=SECRET', method: 'GET' }]);
        expect(out.verdict).toBe('HOLD');
        expect(out.problems.join(' ')).toMatch(/expected_vendor_query/);
        expect(JSON.stringify(out)).not.toContain('SECRET');
    });

    it('POSITIVE CONTROL: exact pinned downloads, vendor POSTs and transcript persistence still pass', () => {
        const out = receiptFor([
            { url: 'https://download.moonshine.ai/model/medium-streaming-en/quantized_26_07_30/encoder.ort', method: 'GET' },
            { url: 'https://us.i.posthog.com/e/', method: 'POST', hasPostData: true },
            { url: `${APP}/api/sessions`, method: 'POST', hasPostData: true },
        ]);
        expect(out.problems).toEqual([]);
        expect(out.verdict).toBe('PASS');
    });

    it('POSITIVE CONTROL: audio to an expected vendor is still a PRIVACY hold', () => {
        const out = receiptVerdict({
            probe, expectedCandidate: CANDIDATE, expectedRelease: 'r1',
            payloads: [rec({ url: 'https://us.i.posthog.com/e/', kind: 'audio', mime: 'audio/webm', bytes: 400_000, t: 2_000 })],
            sockets: [], phases: ['pre-record', 'recording', 'stop-save', 'terminal'], appOrigin: APP,
            workerInstrumentation: WORKERS_OK, egress: [], recordingStartedAt: 1_000,
        });
        expect(out.holdKind).toBe('privacy');
    });

    it('POSITIVE CONTROL: traffic AFTER persistence but before terminal is retained and audited', () => {
        // Observation used to stop at the first `sessionPersisted`, so teardown traffic — exactly where
        // a "just upload the audio too" step would live — was never seen at all.
        const out = receiptVerdict({
            probe, expectedCandidate: CANDIDATE, expectedRelease: 'r1',
            payloads: [rec({ url: `${APP}/api/x`, kind: 'binary', bytes: 50_000, runtimeState: 'READY', t: 9_000 })],
            sockets: [], phases: ['pre-record', 'recording', 'stop-save', 'terminal'], appOrigin: APP,
            workerInstrumentation: WORKERS_OK, egress: [], recordingStartedAt: 1_000,
        });
        expect(out.verdict, 'post-save opaque bytes must still be judged').toBe('HOLD');
        expect(out.holdKind).toBe('privacy');
    });
});

describe('a take must reach terminal, and every worker must finish being observed', () => {
    const CANDIDATE = 'moonshine:streaming-medium';
    const probe = {
        release: 'r1', requestedCandidate: CANDIDATE, observedCandidate: CANDIDATE,
        identityMatches: true, modelStatus: 'ready', runtimeState: 'READY',
    };
    const COMPLETE = {
        attached: 1, installed: 1, installFailures: 0, drained: 1, drainFailures: 0,
        mainTripwireInstalled: true, mainReadOk: true, networkEnabled: 1, networkFailures: 0,
        setupPending: 0,
    };
    const base = (over = {}) => ({
        probe, expectedCandidate: CANDIDATE, expectedRelease: 'r1',
        payloads: [], sockets: [], phases: ['pre-record', 'recording', 'stop-save', 'terminal'],
        appOrigin: APP, workerInstrumentation: COMPLETE, egress: [], recordingStartedAt: 1_000, ...over,
    });

    it('CASUALTY: clean audits and persistence but NO terminal state is a proof HOLD', () => {
        // Observation continues past `sessionPersisted` until the controller settles, but the grace
        // period expiring was recorded as a phase and never checked — so a take whose teardown never
        // completed still PASSED. Teardown is where a "just upload the audio too" step would live, so an
        // unobserved one is missing evidence, not an absent finding.
        const out = receiptVerdict(base({ phases: ['pre-record', 'recording', 'stop-save'] }));
        expect(out.verdict).toBe('HOLD');
        expect(out.holdKind, 'nothing observed says audio left').toBe('proof');
        expect(out.problems.join(' ')).toMatch(/"terminal" was never observed/);
    });

    it('CASUALTY: a terminal TIMEOUT is a named proof HOLD, not a pass', () => {
        const out = receiptVerdict(base({
            phases: ['pre-record', 'recording', 'stop-save', 'terminal-timeout'],
        }));
        expect(out.verdict).toBe('HOLD');
        expect(out.holdKind).toBe('proof');
        expect(out.problems.join(' ')).toMatch(/never reached a terminal state before the grace period/);
    });

    it('CASUALTY: two workers attached but only one completed is a proof HOLD', () => {
        // The un-awaited attach handler incremented `attached` immediately while setup was still in
        // flight, so every counter could look consistent purely because the second worker had not
        // finished. Requiring them to AGREE makes the snapshot a statement about the run.
        const out = receiptVerdict(base({
            workerInstrumentation: { ...COMPLETE, attached: 2, networkEnabled: 1, installed: 1, drained: 1 },
        }));
        expect(out.verdict).toBe('HOLD');
        expect(out.problems.join(' ')).toMatch(/worker setup is uneven/);
    });

    it('CASUALTY: worker setup still PENDING when the receipt is written is a proof HOLD', () => {
        const out = receiptVerdict(base({ workerInstrumentation: { ...COMPLETE, setupPending: 1 } }));
        expect(out.verdict).toBe('HOLD');
        expect(out.problems.join(' ')).toMatch(/still pending when the receipt was written/);
    });

    it('CASUALTY: an instrumented worker with no final readback is a proof HOLD', () => {
        const out = receiptVerdict(base({
            workerInstrumentation: { ...COMPLETE, attached: 2, networkEnabled: 2, installed: 2, drained: 1 },
        }));
        expect(out.verdict).toBe('HOLD');
        expect(out.problems.join(' ')).toMatch(/no final readback/);
    });

    it('CASUALTY: a worker callback after the receipt is sealed is reported', () => {
        // Evidence arriving after the verdict cannot have informed it, and folding it in silently would
        // make the receipt describe a moment that never existed.
        const out = receiptVerdict(base({ workerInstrumentation: { ...COMPLETE, postSealCallbacks: 1 } }));
        expect(out.verdict).toBe('HOLD');
        expect(out.problems.join(' ')).toMatch(/after the receipt was sealed/);
    });

    it('POSITIVE CONTROL: authoritative terminal plus every worker fully observed is eligible for PASS', () => {
        const out = receiptVerdict(base({
            workerInstrumentation: { ...COMPLETE, attached: 2, networkEnabled: 2, installed: 2, drained: 2 },
        }));
        expect(out.verdict).toBe('PASS');
        expect(out.holdKind).toBeNull();
    });
});
