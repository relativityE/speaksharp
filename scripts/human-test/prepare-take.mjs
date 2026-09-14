#!/usr/bin/env node
/**
 * RWT-01 — ONE COMMAND before each qualifying comparison take: verify the authorization run, switch the candidate,
 * prove identity, and DISCONNECT. See `preTakeControl.mjs`. When it prints DISCONNECTED, no debugger attachment was observed before arming or after control disconnect;
 * the endpoint cannot prove exclusive custody, so the take browser must carry no other debugging tools.
 *
 * Usage:
 *   node scripts/human-test/prepare-take.mjs --candidate <id> --journey <open_mic|focus_points> --release <sha>
 *     --authorization-run <run id> [--authorization-run-attempt 1] [--port 9222]
 *     [--app https://speaksharp-public.vercel.app] [--out product_release/evidence/human-test/control-<ts>.json]
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { attachmentProbe, openReady } from './cdpControlSession.mjs';
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

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const { target, error } = selectAppTarget(targets, APP);
if (error) { console.error(error); process.exit(1); }
const receipt = await runPreTakeControl({
    // Probe first, open second: the page client is opened (and awaited) only after exclusivity is proven.
    openClient: () => openReady(target.webSocketDebuggerUrl),
    probeAttachment: attachmentProbe(`http://127.0.0.1:${PORT}`, target.id),
    appUrl: APP, authorization: verified.record, candidate: CANDIDATE, journey: JOURNEY, expectedRelease: RELEASE,
});
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(receipt, null, 2)}\n`);
console.log(`${receipt.verdict}  →  ${OUT}`);
for (const p of receipt.problems) console.log(`  - ${p}`);
if (receipt.verdict === 'PASS') console.log('DISCONNECTED — no debugger attachment was observed before arming or after control disconnect. Start the take now.');
process.exit(receipt.verdict === 'PASS' ? 0 : 1);
