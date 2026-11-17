'use strict';
// A supervised J4.a child for offline tests: a real separate process that holds ITS OWN identity (argv) and reaches the parent only
// through j4a-supervised-channel.cjs over IPC. Its "network" is a fake transport: every action appends to a wire file, and its
// effects land in a fake database file that ONLY the parent's trusted residue reader reads back (the child reports steps, never
// counts). Scenarios exercise the refusals; nothing here touches a browser, a network or production.
const fs = require('node:fs');
const { connectChildChannel } = require('../../j4a-supervised-channel.cjs');

const { identity, scenario, account, wireFile, dbFile } = JSON.parse(process.argv[2]);
const wire = (event) => fs.appendFileSync(wireFile, `${event}\n`);
const db = (fn) => { const d = JSON.parse(fs.readFileSync(dbFile, 'utf8')); fn(d); fs.writeFileSync(dbFile, JSON.stringify(d)); };
const bump = (d, kind, ref, n = 1) => { d[kind][ref] = (d[kind][ref] ?? 0) + n; };
const finish = (code) => { try { process.disconnect(); } catch { /* already closed */ } process.exitCode = code; };

(async () => {
    let cap;
    try {
        cap = await connectChildChannel({ port: process, identity, timeoutMs: 5_000 });
    } catch (e) {
        wire(`refused:${e.message}`);
        return finish(78); // before any browser launch: nothing was sent
    }
    // One guarded create; the transport acts only on the parent's grant (after the durable attempt record).
    const create = await cap.createAccount(account, async ({ retries }) => {
        wire(`create:account:retries=${retries}`);
        db((d) => bump(d, 'account', account));
        if (scenario === 'ambiguous-create') throw new Error('response lost'); // created server-side, no terminal answer
        return { outcome: 'created', accountRef: 'acct-server-unit' };
    });
    wire(`create-result:${create.ok ? create.outcome : 'unanswered'}`);
    if (scenario === 'ambiguous-create') {
        const again = await cap.createAccount(account, async () => { wire('create:account:SECOND'); return { outcome: 'created' }; });
        wire(`second-create:${again.sent ? 'sent' : 'refused'}`);
        return finish(1);
    }
    const starts = scenario === 'over-send' ? 3 : 2;
    for (let i = 0; i < starts; i += 1) {
        const r = await cap.send('starts', async () => { wire('starts'); db((d) => bump(d, 'session', account)); return null; });
        if (!r.granted) wire('starts:refused');
    }
    for (let i = 0; i < 2; i += 1) await cap.send('coaching', async () => { wire('coaching'); return null; });
    if (scenario === 'replay') {
        process.send({ t: 'req', id: 'r-2', op: 'send', kind: 'starts' }); // an already-used request id
        await new Promise((r) => { setTimeout(r, 100); });
    }
    // Teardown: delete the run-owned account and everything under it. 'foreign-cleanup' deletes another account instead;
    // 'leave-session' deletes the account but its takes survive. The child cannot hide either from the trusted reader.
    const target = scenario === 'foreign-cleanup' ? 'another-account' : account;
    await cap.cleanup(async () => {
        wire('cleanup:delete-account');
        db((d) => { d.account[target] = 0; if (scenario !== 'leave-session') { d.session[target] = 0; d.lease[target] = 0; } });
        return true;
    });
    if (scenario === 'interrupted-cleanup') return finish(1); // ends before reporting: its deletion proves nothing
    const report = { steps: [{ kind: 'account', ref: target, action: 'delete', outcome: 'done' }], left: [] };
    if (scenario === 'forged-digest') {
        process.send({ t: 'req', id: 'x-1', op: 'reportCleanup', digest: 'f'.repeat(64), report });
        await new Promise((r) => { setTimeout(r, 100); });
        return finish(0);
    }
    if (scenario === 'claimed-counts') {
        // A report that tries to carry its own zero counts is refused: counts come only from the trusted reader.
        const claimed = await cap.reportCleanup({ ...report, verification: { kind: 'zero-residue', queries: [{ kind: 'account', scope: account, count: 0 }] } });
        wire(`report:${claimed.ok ? 'accepted' : 'refused'}`);
        return finish(0);
    }
    const reported = await cap.reportCleanup(report);
    wire(`report:${reported.ok ? 'accepted' : 'refused'}`);
    return finish(0);
})();
