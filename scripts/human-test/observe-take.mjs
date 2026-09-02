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
            (handlers.get(msg.method) ?? []).forEach((h) => h(msg.params));
        }
    });
    return {
        ready,
        on: (method, handler) => handlers.set(method, [...(handlers.get(method) ?? []), handler]),
        send: (method, params = {}) => new Promise((resolve, reject) => {
            const id = nextId++;
            pending.set(id, { resolve, reject });
            ws.send(JSON.stringify({ id, method, params }));
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

    const requests = [];
    const socketsByRequest = new Map();
    const phases = [];
    const notePhase = (p) => { if (!phases.includes(p)) phases.push(p); };

    client.on('Network.requestWillBeSent', ({ request }) => {
        requests.push({ url: request.url, method: request.method, hasPostData: Boolean(request.hasPostData) });
    });
    client.on('Network.webSocketCreated', ({ requestId, url }) => {
        socketsByRequest.set(requestId, { url, frameCount: 0, byteCount: 0 });
    });
    const countFrame = ({ requestId, response }) => {
        const s = socketsByRequest.get(requestId);
        if (!s) return;
        s.frameCount += 1;
        // LENGTH ONLY. Whether a channel carried frames is the question; what they said is not, and
        // reading a payload here would put audio into the very artifact meant to prove it never left.
        s.byteCount += Number(response?.payloadData?.length ?? 0);
    };
    client.on('Network.webSocketFrameSent', countFrame);
    client.on('Network.webSocketFrameReceived', countFrame);

    notePhase('pre-record');
    await client.send('Page.navigate', { url: APP });

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
        if (probe?.runtimeState === 'RECORDING') notePhase('recording');
        if (probe?.sessionPersisted === 'true' || probe?.sessionPersisted === true) { notePhase('stop-save'); break; }
        if (DRY_RUN && probe?.runtimeState === 'READY') { notePhase('recording'); notePhase('stop-save'); break; }
        await new Promise((r) => setTimeout(r, 1000));
    }

    const egress = auditEgress(requests, { appOrigin: APP, observedCandidate: probe?.observedCandidate ?? null });
    const sockets = [...socketsByRequest.values()];
    const receipt = {
        ...receiptVerdict({ probe, expectedCandidate: CANDIDATE, expectedRelease: RELEASE, egress, sockets, phases }),
        capturedAt: new Date().toISOString(),
        expectedCandidate: CANDIDATE,
        requestedCandidate: probe?.requestedCandidate ?? null,
        observedCandidate: probe?.observedCandidate ?? null,
        release: probe?.release ?? null,
        target: safeTargetForEvidence(target),
        dryRun: DRY_RUN,
        requestCount: requests.length,
    };

    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, `${JSON.stringify(receipt, null, 2)}\n`);
    client.close();

    console.log(`${receipt.verdict}  →  ${OUT}`);
    for (const p of receipt.problems) console.log(`  - ${p}`);
    process.exit(receipt.verdict === 'PASS' ? 0 : 1);
};

main().catch((e) => { console.error(e.message); process.exit(1); });
