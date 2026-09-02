#!/usr/bin/env node
/**
 * ONE COMMAND: attach, watch, and write a sanitized receipt for a single take.
 *
 * The observer was a set of helpers with no way to run it, which meant its rules had never met a real
 * browser and no evidence had ever been produced. A rule nobody can execute is a proposal.
 *
 * Deliberately NOT a reusable CDP framework. It attaches to one loopback target, enables the three
 * domains it needs, records four lifecycle phases, and writes one receipt. Every decision is made by the
 * shared authorities in `observer.mjs`, so the command cannot become a second, softer opinion about what
 * counts as egress.
 *
 * Usage:
 *   node scripts/human-test/observe-take.mjs --candidate <id> --release <sha> [--port 9222]
 *     [--app http://127.0.0.1:5174] [--out product_release/evidence/...] [--dry-run]
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { WebSocket } from 'ws';
import { assertLoopbackOrigin, selectAppTarget, safeTargetForEvidence } from './cdpTarget.mjs';
import { IDENTITY_PROBE, receiptVerdict } from './observer.mjs';
import { PAYLOAD_TRIPWIRE, READ_TRIPWIRE } from './payloadTripwire.mjs';

const arg = (name, fallback = null) => {
    const i = process.argv.indexOf(`--${name}`);
    return i === -1 ? fallback : process.argv[i + 1];
};
const flag = (name) => process.argv.includes(`--${name}`);

const PORT = Number(arg('port', '9222'));
const APP = arg('app', 'http://127.0.0.1:5174');
const CANDIDATE = arg('candidate');
const RELEASE = arg('release');
const OUT = arg('out', `product_release/evidence/human-test/receipt-${Date.now()}.json`);
const DRY_RUN = flag('dry-run');

if (!CANDIDATE || !RELEASE) {
    console.error('required: --candidate <id> --release <sha>');
    process.exit(2);
}
// 127.0.0.1 only. `localhost` can resolve off-loopback, and a remote debugging endpoint is the last
// thing this should ever attach to.
assertLoopbackOrigin(`http://127.0.0.1:${PORT}`);

/** Minimal CDP client: one socket, id-matched replies, event callbacks. */
function cdp(wsUrl) {
    const ws = new WebSocket(wsUrl);
    const pending = new Map();
    const handlers = new Map();
    let nextId = 1;
    const ready = new Promise((resolve, reject) => {
        ws.once('open', resolve);
        ws.once('error', reject);
    });
    ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.id && pending.has(msg.id)) {
            const { resolve, reject } = pending.get(msg.id);
            pending.delete(msg.id);
            if (msg.error) reject(new Error(msg.error.message)); else resolve(msg.result);
        } else if (msg.method) {
            (handlers.get(msg.method) ?? []).forEach((h) => h(msg.params, msg.sessionId));
        }
    });
    return {
        ready,
        on: (method, handler) => handlers.set(method, [...(handlers.get(method) ?? []), handler]),
        send: (method, params = {}, sessionId) => new Promise((resolve, reject) => {
            const id = nextId++;
            pending.set(id, { resolve, reject });
            ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
        }),
        close: () => ws.close(),
    };
}

const main = async () => {
    const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    const { target, error } = selectAppTarget(targets, APP);
    if (error) { console.error(error); process.exit(1); }

    const client = cdp(target.webSocketDebuggerUrl);
    await client.ready;

    // ENABLED BEFORE NAVIGATION. Attaching after the app has loaded misses model downloads and any
    // socket opened during startup — the traffic most worth seeing is the traffic that happens first.
    await client.send('Network.enable');
    await client.send('Page.enable');
    await client.send('Runtime.enable');

    // BEFORE APP CODE. Installed via addScriptToEvaluateOnNewDocument so the wrappers win the race
    // against every fetch the app makes at boot; wrapping after load would miss exactly the early
    // traffic, which is when the model downloads and any startup socket happen.
    await client.send('Page.addScriptToEvaluateOnNewDocument', { source: PAYLOAD_TRIPWIRE });

    // WORKERS TOO — this is where the audio actually is. Private STT runs its model in a Web Worker, so
    // a main-document-only tripwire would watch the one context least likely to hold PCM and call the
    // result "zero audio egress". Auto-attach catches each worker as it starts, holds it at the
    // debugger, installs the same tripwire, and lets it run.
    const workerSessions = new Set();
    // COUNTED SEPARATELY, because they mean different things. Attaching is CDP's doing; installing and
    // reading back are ours, and either can fail silently. A run where every install failed otherwise
    // looked exactly like a run where nothing was sent.
    const workerStats = { attached: 0, installed: 0, installFailures: 0, drained: 0, drainFailures: 0 };
    const installedSessions = new Set();

    client.on('Target.attachedToTarget', async ({ sessionId, targetInfo }) => {
        if (!/worker/i.test(targetInfo?.type ?? '')) return;
        workerSessions.add(sessionId);
        workerStats.attached += 1;
        try {
            await client.send('Runtime.enable', {}, sessionId);
            const res = await client.send('Runtime.evaluate', { expression: PAYLOAD_TRIPWIRE }, sessionId);
            // An exception inside the injected script comes back as exceptionDetails rather than a
            // rejected promise, so a thrown installer would otherwise count as a success.
            if (res?.exceptionDetails) throw new Error('tripwire threw during install');
            workerStats.installed += 1;
            installedSessions.add(sessionId);
        } catch {
            workerStats.installFailures += 1;
        }
        try { await client.send('Runtime.runIfWaitingForDebugger', {}, sessionId); } catch { /* already running */ }
    });
    await client.send('Target.setAutoAttach', {
        autoAttach: true, waitForDebuggerOnStart: true, flatten: true,
    });

    const requests = [];
    const socketsByRequest = new Map();
    const phases = [];
    const notePhase = (p) => { if (!phases.includes(p)) phases.push(p); };

    client.on('Network.requestWillBeSent', ({ request }) => {
        requests.push({ url: request.url, method: request.method, hasPostData: Boolean(request.hasPostData) });
    });
    client.on('Network.webSocketCreated', ({ requestId, url }) => {
        socketsByRequest.set(requestId, { url, frameCount: 0, sentBinaryFrames: 0, receivedBinaryFrames: 0, byteCount: 0 });
    });
    const countFrame = (direction) => ({ requestId, response }) => {
        const s = socketsByRequest.get(requestId);
        if (!s) return;
        s.frameCount += 1;
        // opcode 2 is a BINARY frame. Direction matters: only OUTBOUND binary can establish audio
        // egress, and inbound binary was previously scored identically. What the frames said is never
        // read -- that would put audio into the artifact meant to prove it never left.
        if (Number(response?.opcode) === 2) {
            if (direction === 'sent') s.sentBinaryFrames += 1; else s.receivedBinaryFrames += 1;
        }
        // LENGTH ONLY. Whether a channel carried frames is the question; what they said is not, and
        // reading a payload here would put audio into the very artifact meant to prove it never left.
        s.byteCount += Number(response?.payloadData?.length ?? 0);
    };
    client.on('Network.webSocketFrameSent', countFrame('sent'));
    client.on('Network.webSocketFrameReceived', countFrame('received'));

    // PHASES ARE OBSERVED, NEVER ASSERTED. A dry-run shortcut used to call notePhase('recording') and
    // notePhase('stop-save') as soon as the page reached READY, which manufactured the very lifecycle
    // evidence the receipt exists to record. A receipt that invents its own phases is worse than no
    // receipt: it reads as proof that a take happened.
    notePhase('pre-record');
    await client.send('Page.navigate', { url: APP });

    // DRAINED AS WE GO. A worker that ends before the final read would otherwise take its evidence with
    // it — and a worker ending early is exactly what a short recording looks like. Records are
    // accumulated per session so a terminated worker's findings survive it.
    const workerRecords = new Map();
    const drainedOk = new Set();
    const drainWorkers = async () => {
        for (const sessionId of installedSessions) {
            try {
                const { result } = await client.send('Runtime.evaluate', {
                    expression: READ_TRIPWIRE, returnByValue: true, awaitPromise: false,
                }, sessionId);
                const parsed = JSON.parse(result?.value ?? '[]');
                if (parsed.length > 0) workerRecords.set(sessionId, parsed);
                drainedOk.add(sessionId);
            } catch { /* recorded as a drain failure at the end; earlier drains are kept */ }
        }
    };

    const probeOnce = async () => {
        const { result } = await client.send('Runtime.evaluate', {
            expression: IDENTITY_PROBE, returnByValue: true, awaitPromise: false,
        });
        return result?.value ?? null;
    };

    // Follow the take by the state the app publishes, rather than by asking the operator to tell us.
    const deadline = Date.now() + (DRY_RUN ? 60_000 : 15 * 60_000);
    let probe = null;
    while (Date.now() < deadline) {
        probe = await probeOnce();
        await drainWorkers();
        if (probe?.runtimeState === 'RECORDING') notePhase('recording');
        if (probe?.sessionPersisted === 'true' || probe?.sessionPersisted === true) { notePhase('stop-save'); break; }
        await new Promise((r) => setTimeout(r, 1000));
    }

    // What the page actually SENT, classified by kind. This is the payload-boundary fact the
    // request-metadata audit could never supply.
    const { result: tripwire } = await client.send('Runtime.evaluate', {
        expression: READ_TRIPWIRE, returnByValue: true, awaitPromise: false,
    });
    let payloads = [];
    try { payloads = JSON.parse(tripwire?.value ?? '[]'); } catch { payloads = []; }

    await drainWorkers();
    workerStats.drained = drainedOk.size;
    workerStats.drainFailures = installedSessions.size - drainedOk.size;
    for (const records of workerRecords.values()) {
        payloads.push(...records.map((p) => ({ ...p, context: 'worker' })));
    }

    const sockets = [...socketsByRequest.values()];
    const receipt = {
        ...receiptVerdict({
            probe, expectedCandidate: CANDIDATE, expectedRelease: RELEASE,
            payloads, sockets, phases, appOrigin: APP, workerInstrumentation: workerStats,
        }),
        capturedAt: new Date().toISOString(),
        expectedCandidate: CANDIDATE,
        requestedCandidate: probe?.requestedCandidate ?? null,
        observedCandidate: probe?.observedCandidate ?? null,
        release: probe?.release ?? null,
        target: safeTargetForEvidence(target),
        dryRun: DRY_RUN,
        requestCount: requests.length,
        payloadCount: payloads.length,
        workerInstrumentation: workerStats,
    };

    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, `${JSON.stringify(receipt, null, 2)}\n`);
    client.close();

    console.log(`${receipt.verdict}  →  ${OUT}`);
    for (const p of receipt.problems) console.log(`  - ${p}`);
    process.exit(receipt.verdict === 'PASS' ? 0 : 1);
};

main().catch((e) => { console.error(e.message); process.exit(1); });
