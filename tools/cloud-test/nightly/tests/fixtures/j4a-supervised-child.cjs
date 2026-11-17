'use strict';
// A supervised J4.a child for offline tests: a real separate process that holds ITS OWN identity (argv) and reaches the parent only
// through j4a-supervised-channel.cjs over IPC. Its "network" is a fake transport that appends to a wire file, so the test can prove
// what left and in which order. Scenarios exercise the refusals; nothing here touches a browser, a network or production.
const fs = require('node:fs');
const { connectChildChannel } = require('../../j4a-supervised-channel.cjs');

const { identity, scenario, account, wireFile } = JSON.parse(process.argv[2]);
const wire = (event) => fs.appendFileSync(wireFile, `${event}\n`);
const finish = (code) => { try { process.disconnect(); } catch { /* already closed */ } process.exitCode = code; };

(async () => {
    let cap;
    try {
        cap = await connectChildChannel({ port: process, identity, timeoutMs: 5_000 });
    } catch (e) {
        wire(`refused:${e.message}`);
        return finish(78); // before any browser launch: nothing was sent
    }
    // One guarded create; the transport "acts" only on the parent's grant (after the durable attempt record).
    const create = await cap.createAccount(account, async ({ retries }) => {
        wire(`create:account:retries=${retries}`);
        if (scenario === 'ambiguous-create') throw new Error('response lost'); // no terminal answer reaches the parent
        return { outcome: 'created', accountRef: 'acct-server-unit' };
    });
    wire(`create-result:${create.ok ? create.outcome : 'unanswered'}`);
    if (scenario === 'ambiguous-create') {
        // A second create for the journey is refused from the durable record; its transport must never run.
        const again = await cap.createAccount(account, async () => { wire('create:account:SECOND'); return { outcome: 'created' }; });
        wire(`second-create:${again.sent ? 'sent' : 'refused'}`);
        return finish(1);
    }
    const starts = scenario === 'over-send' ? 3 : 2;
    for (let i = 0; i < starts; i += 1) {
        const r = await cap.send('starts', async () => { wire('starts'); return null; });
        if (!r.granted) wire('starts:refused');
    }
    for (let i = 0; i < 2; i += 1) await cap.send('coaching', async () => { wire('coaching'); return null; });
    if (scenario === 'replay') {
        // Re-send an already-used request id directly on the channel: the parent must refuse it and grant nothing.
        process.send({ t: 'req', id: 'r-2', op: 'send', kind: 'starts' });
        await new Promise((r) => { setTimeout(r, 100); });
    }
    await cap.cleanup(async () => { wire('cleanup:delete-account'); return true; });
    const queries = [];
    for (const kind of ['account', 'session', 'lease']) {
        const q = await cap.cleanup(async () => { wire(`cleanup:residue-${kind}`); return 0; });
        if (q.ok) queries.push({ kind, scope: scenario === 'foreign-cleanup' ? 'another-account' : account, count: q.value });
    }
    if (scenario === 'interrupted-cleanup') return finish(1); // ends before reporting: the prior observations prove nothing
    if (scenario === 'forged-digest') {
        // A report under a digest the parent never bound (sent raw on the channel) must be refused and verify nothing.
        process.send({ t: 'req', id: 'x-1', op: 'reportCleanup', digest: 'f'.repeat(64),
            report: { steps: [{ kind: 'account', ref: account, action: 'delete', outcome: 'done' }], left: [], verification: { kind: 'zero-residue', queries } } });
        await new Promise((r) => { setTimeout(r, 100); });
        return finish(0);
    }
    const reported = await cap.reportCleanup({ steps: [{ kind: 'account', ref: account, action: 'delete', outcome: 'done' }], left: [],
        verification: { kind: 'zero-residue', queries } });
    wire(`report:${reported.ok ? 'accepted' : 'refused'}`);
    return finish(0);
})();
