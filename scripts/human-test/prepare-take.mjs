#!/usr/bin/env node
/**
 * RWT-01 — ONE COMMAND before each qualifying comparison take: verify the authorization run, switch the candidate,
 * prove identity, and DISCONNECT. See `preTakeControl.mjs`. Nothing remains attached when it prints DISCONNECTED.
 *
 * Usage:
 *   node scripts/human-test/prepare-take.mjs --candidate <id> --journey <open_mic|focus_points> --release <sha>
 *     --authorization-run <run id> [--authorization-run-attempt 1] [--port 9222]
 *     [--app https://speaksharp-public.vercel.app] [--out product_release/evidence/human-test/control-<ts>.json]
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { WebSocket } from 'ws';
import { assertLoopbackOrigin, selectAppTarget } from './cdpTarget.mjs';
import { ghCliGetter, ghRunArtifactFetcher, verifyRunAuthorization } from './modelComparisonRunAuthority.mjs';
import { runPreTakeControl } from './preTakeControl.mjs';

const arg = (name, fallback = null) => {
    const i = process.argv.indexOf(`--${name}`);
    return i === -1 ? fallback : process.argv[i + 1];
};
const PORT = Number(arg('port', '9222'));
const APP = arg('app', 'https://speaksharp-public.vercel.app');
const CANDIDATE = arg('candidate');
const JOURNEY = arg('journey');
const RELEASE = arg('release');
const AUTHORIZATION_RUN = arg('authorization-run');
const AUTHORIZATION_RUN_ATTEMPT = arg('authorization-run-attempt', '1');
const OUT = arg('out', `product_release/evidence/human-test/control-${Date.now()}.json`);
/** Every CDP reply is bounded: an unanswered command must never leave this process, or the page, waiting. */
const COMMAND_TIMEOUT_MS = 15_000;

if (!CANDIDATE || !['open_mic', 'focus_points'].includes(JOURNEY) || !/^[0-9a-f]{40}$/.test(RELEASE ?? '')
    || !/^\d{1,20}$/.test(AUTHORIZATION_RUN ?? '') || !/^\d{1,4}$/.test(AUTHORIZATION_RUN_ATTEMPT ?? '')) {
    console.error('required: --candidate <id> --journey <open_mic|focus_points> --release <40-char sha> --authorization-run <run id> [--authorization-run-attempt <n>]');
    process.exit(2);
}

const gh = process.env.GH_BIN || 'gh';
const verified = await verifyRunAuthorization({
    runId: Number(AUTHORIZATION_RUN),
    runAttempt: Number(AUTHORIZATION_RUN_ATTEMPT),
    githubGet: ghCliGetter(execFileSync, gh),
    fetchRunArtifact: ghRunArtifactFetcher(execFileSync, gh),
    expected: { candidateId: CANDIDATE, journey: JOURNEY, releaseSha: RELEASE, origin: new URL(APP).origin },
});
if (!verified.ok) {
    console.error('HOLD: the comparison authorization run did not verify against GitHub; nothing was attached');
    for (const problem of verified.problems) console.error(`  - ${problem}`);
    process.exit(1);
}
assertLoopbackOrigin(`http://127.0.0.1:${PORT}`);

function connect(wsUrl) {
    const ws = new WebSocket(wsUrl);
    const pending = new Map();
    let nextId = 1;
    const ready = new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
    ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        const entry = msg.id ? pending.get(msg.id) : undefined;
        if (!entry) return;
        pending.delete(msg.id);
        clearTimeout(entry.timer);
        if (msg.error) entry.reject(new Error(msg.error.message)); else entry.resolve(msg.result);
    });
    return {
        ready,
        send: (method, params = {}) => new Promise((resolve, reject) => {
            const id = nextId++;
            const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, COMMAND_TIMEOUT_MS);
            pending.set(id, { resolve, reject, timer });
            ws.send(JSON.stringify({ id, method, params }));
        }),
        close: () => new Promise((resolve) => {
            if (ws.readyState === WebSocket.CLOSED) { resolve(); return; }
            ws.once('close', resolve);
            ws.close();
        }),
    };
}

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const { target, error } = selectAppTarget(targets, APP);
if (error) { console.error(error); process.exit(1); }
const client = connect(target.webSocketDebuggerUrl);
await client.ready;

const receipt = await runPreTakeControl({
    client, appUrl: APP, authorization: verified.record, candidate: CANDIDATE, journey: JOURNEY, expectedRelease: RELEASE,
});
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(receipt, null, 2)}\n`);
console.log(`${receipt.verdict}  →  ${OUT}`);
for (const p of receipt.problems) console.log(`  - ${p}`);
if (receipt.verdict === 'PASS') console.log('DISCONNECTED — no debugger is attached. Start the take now.');
process.exit(receipt.verdict === 'PASS' ? 0 : 1);
