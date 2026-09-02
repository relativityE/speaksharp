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
import { IDENTITY_PROBE, auditEgress, receiptVerdict } from './observer.mjs';
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
    const workerStats = {
        attached: 0, installed: 0, installFailures: 0, drained: 0, drainFailures: 0,
        mainTripwireInstalled: false,
        // Network was enabled on the ROOT session only. A worker's own requests were therefore never
        // reported, so a worker query-bearing GET -- data in the URL, no body for the payload audit to
        // classify -- bypassed the request audit completely. Counted separately because "we tried" and
        // "it is observing" are different claims.
        networkEnabled: 0, networkFailures: 0,
    };
    const installedSessions = new Set();
    // EVERY SETUP IS TRACKED AS A PROMISE. `Target.attachedToTarget` is an event handler: CDP does not
    // await it, so `attached` incremented immediately while Network/Runtime setup was still pending. The
    // receipt could then be written from a partial snapshot -- two workers attached, one enabled, one
    // installed, zero failures because the second was simply not finished yet -- and every guard passed
    // on a count that was still moving.
    const workerSetups = [];
    let receiptSealed = false;

    client.on('Target.attachedToTarget', ({ sessionId, targetInfo }) => {
        if (!/worker/i.test(targetInfo?.type ?? '')) return;
        workerSessions.add(sessionId);
        workerStats.attached += 1;
        workerSetups.push(setUpWorker(sessionId));
    });

    async function setUpWorker(sessionId) {
        // Nothing a worker reports after the receipt is sealed may change it: evidence that arrives
        // after the verdict cannot have informed it, and silently folding it in would make the receipt
        // describe a moment that never existed.
        if (receiptSealed) { workerStats.postSealCallbacks = (workerStats.postSealCallbacks ?? 0) + 1; return; }
        // NETWORK FIRST, and verified. Without it the worker's requests are invisible to the request
        // audit no matter how good the payload tripwire is.
        try {
            await client.send('Network.enable', {}, sessionId);
            workerStats.networkEnabled += 1;
        } catch {
            workerStats.networkFailures += 1;
        }
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
    }
    await client.send('Target.setAutoAttach', {
        autoAttach: true, waitForDebuggerOnStart: true, flatten: true,
    });

    const requests = [];
    const socketsByRequest = new Map();
    const phases = [];
    const notePhase = (p) => { if (!phases.includes(p)) phases.push(p); };
    let recordingStartedAt = null;
    let persistedAt = null;
    // How long to keep watching after save before giving up on a terminal state.
    const POST_SAVE_GRACE_MS = 15_000;

    client.on('Network.requestWillBeSent', ({ request }, sessionId) => {
        requests.push({
            url: request.url,
            method: request.method,
            hasPostData: Boolean(request.hasPostData),
            // MAIN VERSUS WORKER, preserved. A finding that cannot say which context issued the request
            // loses the distinction that matters most for this product.
            context: sessionId && workerSessions.has(sessionId) ? 'worker' : 'main',
        });
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
    // THE LATEST READ WINS. This was a monotonic Set, so one early success permanently marked a worker
    // as readable and a FINAL read failure -- the one that decides whether the retained evidence is
    // complete -- was erased by it. A worker that stopped responding halfway through a take scored as
    // fully observed.
    const drainStatus = new Map();
    const drainWorkers = async () => {
        for (const sessionId of installedSessions) {
            try {
                const evaluated = await client.send('Runtime.evaluate', {
                    expression: READ_TRIPWIRE, returnByValue: true, awaitPromise: false,
                }, sessionId);
                // AN EXCEPTION INSIDE THE EXPRESSION RESOLVES THE CALL. CDP reports it as
                // `exceptionDetails` rather than rejecting, so a throwing readback landed here with
                // `result.value === undefined`, `JSON.parse('[]')` produced an empty list, and the
                // session was recorded as a SUCCESSFUL read of nothing. A worker whose evidence could
                // not be retrieved then scored identically to a worker that sent nothing — which is the
                // claim the receipt goes on to make.
                //
                // The same trap was already fixed for install; this is the read half of it.
                if (evaluated?.exceptionDetails) throw new Error('worker readback threw');
                if (typeof evaluated?.result?.value !== 'string') throw new Error('worker readback returned no value');
                const parsed = JSON.parse(evaluated.result.value);
                if (parsed.length > 0) workerRecords.set(sessionId, parsed);
                drainStatus.set(sessionId, true);
            } catch {
                // Recorded as the CURRENT state of this session. Records already drained are kept, but
                // the receipt reports that the latest read failed.
                drainStatus.set(sessionId, false);
            }
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
        if (probe?.runtimeState === 'RECORDING') {
            notePhase('recording');
            // The MOMENT recording began, so a payload can be placed before or after it. A single flag
            // computed at the end of the run described every record equally, including startup traffic.
            if (recordingStartedAt === null) recordingStartedAt = Date.now();
        }
        // PERSISTENCE IS NOT THE END OF THE TAKE. Breaking at the first `sessionPersisted` stopped
        // observation before stop/save/cleanup reached its terminal state, so anything sent during
        // teardown -- exactly when a "just upload the audio too" step would live -- was never seen, and
        // the receipt covered only part of the lifecycle it claims to describe.
        if (probe?.sessionPersisted === 'true' || probe?.sessionPersisted === true) {
            notePhase('stop-save');
            persistedAt = persistedAt ?? Date.now();
        }
        // Continue until the controller settles back to a terminal state, with a bounded grace period so
        // a stuck teardown cannot hold the run open forever.
        if (persistedAt !== null) {
            const settled = probe?.runtimeState === 'READY' || probe?.runtimeState === 'IDLE'
                || probe?.runtimeState === 'TERMINATED';
            if (settled) { notePhase('terminal'); break; }
            if (Date.now() - persistedAt > POST_SAVE_GRACE_MS) { notePhase('terminal-timeout'); break; }
        }
        await new Promise((r) => setTimeout(r, 1000));
    }

    // What the page actually SENT, classified by kind. This is the payload-boundary fact the
    // request-metadata audit could never supply.
    // THE SAME EXCEPTION TRAP AS THE DRAIN, IN THE MAIN READ. A throwing expression resolves with
    // `exceptionDetails` rather than rejecting, so `?? '[]'` turned a failed read of the main document
    // into "the page sent nothing" -- the one conclusion the receipt must never reach by accident. The
    // read is now required to return an actual string.
    let payloads = [];
    let mainReadOk = false;
    try {
        const evaluated = await client.send('Runtime.evaluate', {
            expression: READ_TRIPWIRE, returnByValue: true, awaitPromise: false,
        });
        if (evaluated?.exceptionDetails) throw new Error('main tripwire read threw');
        if (typeof evaluated?.result?.value !== 'string') throw new Error('main tripwire read returned no value');
        payloads = JSON.parse(evaluated.result.value);
        mainReadOk = true;
    } catch { mainReadOk = false; }

    // CONFIRM THE MAIN TRIPWIRE EXISTS, rather than inferring it from an empty payload list. An absent
    // installer and a page that sent nothing produce identical evidence, and only one of them is a
    // clean run.
    try {
        const { result: present } = await client.send('Runtime.evaluate', {
            expression: 'Array.isArray(globalThis.__SS_TRIPWIRE__)', returnByValue: true, awaitPromise: false,
        });
        // PRESENCE IS NOT ENOUGH. The array can exist while the read that retrieves it fails, and an
        // installed-but-unreadable tripwire yields the same empty list as a page that sent nothing.
        workerStats.mainTripwireInstalled = present?.value === true && mainReadOk;
        workerStats.mainReadOk = mainReadOk;
    } catch { workerStats.mainTripwireInstalled = false; workerStats.mainReadOk = false; }

    // AWAIT EVERY WORKER SETUP BEFORE READING EVIDENCE, bounded so one that never finishes cannot hold
    // the run open. `Target.attachedToTarget` is an event handler and CDP does not await it, so
    // `attached` incremented immediately while Network/Runtime setup was still in flight: the receipt
    // could be written from a snapshot that was still moving -- two attached, one enabled, one
    // installed, zero failures only because the second had not finished. A setup still pending here is
    // unfinished observation, not an absent finding.
    const SETUP_GRACE_MS = 10_000;
    let settleTimer;
    const stillPending = await Promise.race([
        Promise.allSettled(workerSetups).then(() => false),
        new Promise((resolve) => { settleTimer = setTimeout(() => resolve(true), SETUP_GRACE_MS); }),
    ]);
    clearTimeout(settleTimer);
    workerStats.setupPending = stillPending ? 1 : 0;

    await drainWorkers();
    // SEALED. Anything a worker reports from here cannot have informed the verdict, and folding it in
    // silently would make the receipt describe a moment that never existed.
    receiptSealed = true;
    workerStats.drained = [...drainStatus.values()].filter(Boolean).length;
    workerStats.drainFailures = installedSessions.size - workerStats.drained;
    for (const records of workerRecords.values()) {
        payloads.push(...records.map((p) => ({ ...p, context: 'worker' })));
    }

    // THE REQUEST-LEVEL AUDIT WAS COLLECTED AND NEVER CONSULTED. `requests` was populated on every
    // `requestWillBeSent` and then dropped: `auditEgress` -- exact pinned-asset matching, unknown
    // same-origin paths, query strings on known operations, unrecognised off-origin channels -- had no
    // effect on the executable verdict at all. Those rules were tested and true and simply not wired to
    // anything, which is worse than not having them: the receipt read as though they had run.
    //
    // Payload classification answers "did audio leave"; this answers "did anything go somewhere we
    // cannot account for". Both belong in the verdict.
    const egress = auditEgress(requests, {
        appOrigin: APP,
        observedCandidate: probe?.observedCandidate ?? null,
    });

    const sockets = [...socketsByRequest.values()];
    const receipt = {
        ...receiptVerdict({
            probe, expectedCandidate: CANDIDATE, expectedRelease: RELEASE,
            payloads, sockets, phases, appOrigin: APP, workerInstrumentation: workerStats, egress,
            recordingStartedAt,
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
