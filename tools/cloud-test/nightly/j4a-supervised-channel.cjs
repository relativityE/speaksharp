'use strict';
// #1884 step 6, the supervised J4.a capability over the parent/child IPC boundary (campaign-runner.cjs → run-guarded.cjs).
//
// The parent owns every effect-bearing decision: the nightly budget, the durable account-create record and the cleanup
// evidence, all through runner-bridge.cjs's own `nightly` routes for J4.a. The child (the supervised step) gets ONLY a narrow
// capability that asks the parent first and acts only on its grant:
//   - binding first: the parent's offer (beginBinding) must be acknowledged from the child's OWN validated identity
//     (acknowledgeBinding). Before that, or after a refused binding, every request is refused and nothing reaches `nightly`;
//   - send / cleanup: the parent reserves through `nightly.send` / `nightly.cleanup` and only then tells the child to act
//     ("go"); the child reports its content-free result ("done"). Browser observation after a request is never a reservation;
//   - createAccount: through `nightly.createAccount` (reserved, recorded durably, then sent once with retries 0). The child acts
//     on "createGo" and answers with a terminal outcome; a lost or ambiguous answer leaves the attempt unresolved, and the
//     bridge refuses any second create for the journey;
//   - reportCleanup: the child's teardown STEPS (what it deleted), accepted once, only under the bound digest, before the
//     child ends. A matching digest identifies the report; it proves no counts (Sam, 17 Nov). The residue counts come from a
//     TRUSTED reader the parent holds (never the child), scoped to the account whose create the parent itself saw confirmed;
//     the bridge then checks the required account/session/lease queries against that same confirmed scope. A disconnect or
//     exit before the report, a refused binding, or no confirmed create leaves cleanup unproven.
// Every request id is used once; a replayed id is refused and recorded as a violation. Content-free: kinds, counts, refs.
const { acknowledgeBinding, beginBinding } = require('./j4a-supervised-binding.cjs');

const LEG = 'J4.a';
const OPS = Object.freeze(['send', 'cleanup', 'createAccount', 'created', 'reportCleanup', 'confirmOwner']);
const KINDS = Object.freeze(['starts', 'coaching']);
const ID = /^[a-z0-9-]{1,40}$/;
const REF = /^[A-Za-z0-9._:-]{1,120}$/;
const DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/;
const COUNT = (v) => Number.isSafeInteger(v) && v >= 0;

/** The child's cleanup report: teardown steps and reported leftovers only (content-free refs). It never carries counts. */
function validCleanupReport(r) {
    const resource = (x) => x && typeof x === 'object' && typeof x.kind === 'string' && typeof x.ref === 'string' && REF.test(x.ref);
    return !!r && typeof r === 'object' && Object.keys(r).sort().join() === 'left,steps' && Array.isArray(r.steps) && Array.isArray(r.left)
        && r.steps.every((s) => resource(s) && typeof s.action === 'string' && ['done', 'failed', 'not attempted'].includes(s.outcome))
        && r.left.every(resource);
}

/** The residue kinds the parent's trusted reader must observe, scoped to the confirmed run-owned account (J4.a). */
const RESIDUE_KINDS = Object.freeze(['account', 'session', 'lease']);
const STORE_KIND = Object.freeze({ sessions: 'session', active_recording_lease: 'lease' });

/**
 * Parent end. `port`: the ChildProcess (send / on('message') / on('disconnect') / on('exit')). `nightly`: the bridge's object
 * for this case (runner-bridge.cjs `runCase` opts). Returns { bound, outcome() }. Never throws into the supervisor's flow:
 * every refusal is recorded in `violations`, and nothing reaches `nightly` without a bound digest.
 */
function attachParentChannel({ port, identity, nightly, confirmOwner }) {
    const binding = beginBinding(identity);
    const state = { digest: null, refused: null, ended: false, report: null, violations: [], seen: new Set(), pending: new Map(),
        confirmedAccount: null, confirmedOwner: null, ownerAsked: false };
    const reply = (msg) => { if (!state.ended) try { port.send(msg); } catch { /* the child is gone */ } };
    const refuse = (id, reason) => { state.violations.push(reason); reply({ t: 'res', id, ok: false, reason }); };
    /** Waits for the child's "done"/"createResult" for `id`; a disconnect or exit settles it as lost (never success). */
    // Sam (seal review of f34804e1): each pending reply is bound to the operation that issued it. A send/cleanup grant is answered only
    // by `done`, a create only by `createResult` (or `failed` for either). A wrong-kind reply, a reply for an id that is not pending (a
    // replay or an unsolicited answer) is a protocol violation: the pending operation settles LOST, and any violation keeps cleanup
    // verification out of the outcome (never accepted alongside violations).
    const awaitChild = (id, expect) => new Promise((resolve) => { state.pending.set(id, { resolve, expect }); });
    const settleAll = () => { for (const [, p] of state.pending) p.resolve({ lost: true }); state.pending.clear(); };
    const answered = new Set();
    let resolveBound;
    const bound = new Promise((r) => { resolveBound = r; });

    async function handleRequest(m) {
        const { id, op } = m;
        if (!ID.test(String(id ?? '')) || !OPS.includes(op)) return refuse(id ?? null, 'malformed request');
        if (state.digest === null) return refuse(id, 'not bound');
        if (state.seen.has(id)) return refuse(id, `replayed request ${id}`);
        state.seen.add(id);
        if (op === 'send' || op === 'cleanup') {
            if (op === 'send' && !KINDS.includes(m.kind)) return refuse(id, 'unknown send kind');
            const route = op === 'send' ? (a) => nightly.send(LEG, m.kind, a) : (a) => nightly.cleanup(LEG, a);
            let childResult = null;
            const r = await route(async () => { reply({ t: 'go', id }); childResult = await awaitChild(id, 'done'); if (childResult.lost) throw new Error('lost'); return childResult.value; })
                .catch(() => ({ sent: true, lost: true }));
            return reply({ t: 'res', id, ok: r.sent === true && !r.lost, granted: r.sent === true, lost: r.lost === true || childResult?.lost === true,
                value: r.sent && !r.lost ? r.value ?? null : null, reason: r.sent ? undefined : r.reason });
        }
        if (op === 'createAccount') {
            if (typeof m.lookupRef !== 'string' || !REF.test(m.lookupRef)) return refuse(id, 'malformed lookupRef');
            if (m.emailDomain !== undefined && (typeof m.emailDomain !== 'string' || !DOMAIN.test(m.emailDomain))) return refuse(id, 'malformed emailDomain');
            const r = await nightly.createAccount(LEG, m.lookupRef, async ({ signal, retries }) => {
                reply({ t: 'createGo', id, retries });
                const answer = await Promise.race([awaitChild(id, 'createResult'),
                    new Promise((res) => signal.addEventListener('abort', () => res({ lost: true }), { once: true }))]);
                if (answer.lost) throw new Error('create answer lost');
                return answer.value;
            }, m.emailDomain === undefined ? undefined : { emailDomain: m.emailDomain }).catch(() => ({ sent: true, answered: false }));
            // The parent's own record of the confirmed create: the only scope the trusted residue reader may use.
            if (r.sent === true && r.answered === true && r.value?.outcome === 'created' && state.confirmedAccount === null)
                state.confirmedAccount = m.lookupRef;
            return reply({ t: 'res', id, ok: r.sent === true && r.answered === true, sent: r.sent === true, answered: r.answered === true,
                outcome: r.answered ? r.value?.outcome ?? null : null, reason: r.sent ? undefined : r.reason });
        }
        // #1884 (Sam, option a): the owner the guard may bind, confirmed by the PARENT independently (durable create record, reserved
        // email, exact lookup), asked once, only after the parent saw the create confirmed. The child never supplies it.
        if (op === 'confirmOwner') {
            if (state.ownerAsked) return refuse(id, 'owner already confirmed or refused; no rebind');
            state.ownerAsked = true;
            if (state.confirmedAccount === null || typeof confirmOwner !== 'function') return reply({ t: 'res', id, ok: false, reason: 'HOLD: no confirmed create or no parent owner confirmation' });
            let r;
            try { r = await confirmOwner(state.confirmedAccount); } catch { r = { hold: 'the parent owner confirmation failed' }; }
            if (!r || typeof r.owner !== 'string' || r.hold) return reply({ t: 'res', id, ok: false, reason: `HOLD: ${r?.hold ?? 'unconfirmed'}` });
            state.confirmedOwner = r.owner;
            return reply({ t: 'res', id, ok: true, ownerId: r.owner });
        }
        if (op === 'created') {
            if (!m.resource || typeof m.resource.kind !== 'string' || !REF.test(String(m.resource.ref ?? ''))) return refuse(id, 'malformed resource');
            try { nightly.created(LEG, { kind: m.resource.kind, ref: m.resource.ref }); } catch (e) { return refuse(id, e.message); }
            return reply({ t: 'res', id, ok: true });
        }
        // reportCleanup: once, under the bound digest, with a well-formed zero-residue report.
        if (state.report !== null) return refuse(id, 'cleanup already reported');
        if (m.digest !== state.digest) return refuse(id, 'cleanup report not under the bound digest');
        if (!validCleanupReport(m.report)) return refuse(id, 'malformed cleanup report');
        state.report = { steps: m.report.steps, left: m.report.left };
        return reply({ t: 'res', id, ok: true });
    }

    port.on('message', (m) => {
        if (state.ended || !m || typeof m !== 'object') return;
        if (m.t === 'ack') {
            if (state.digest !== null || state.refused) { state.violations.push('second binding reply'); return; }
            // Sam (release boundary 1): the child launches only on this explicit confirmation of the SAME digest; a refusal is explicit too.
            try { state.digest = binding.accept(m.ack); reply({ t: 'bound', digest: state.digest }); resolveBound(state.digest); }
            catch (e) { state.refused = e.message; reply({ t: 'rejected' }); resolveBound(null); }
            return;
        }
        if (m.t === 'refusal') { if (state.digest === null && !state.refused) { state.refused = 'child refused the binding'; resolveBound(null); } return; }
        if (m.t === 'done' || m.t === 'createResult' || m.t === 'failed') {
            const p = state.pending.get(m.id);
            if (!p) { state.violations.push(answered.has(m.id) ? `replayed reply ${String(m.id).slice(0, 40)}` : 'reply for no pending operation'); return; }
            state.pending.delete(m.id); answered.add(m.id);
            if (m.t === 'failed') { p.resolve({ lost: true }); return; }
            if (m.t !== p.expect) { state.violations.push(`wrong-kind reply ${m.t} for ${p.expect}`); p.resolve({ lost: true }); return; }
            p.resolve({ value: m.value ?? null });
            return;
        }
        if (m.t === 'req') void handleRequest(m);
    });
    const end = () => { if (state.ended) return; state.ended = true; settleAll(); if (state.digest === null && !state.refused) { state.refused = 'child ended before binding'; resolveBound(null); } };
    port.on('disconnect', end);
    port.on('exit', end);
    try { port.send({ t: 'offer', offer: binding.offer }); } catch { end(); }

    return Object.freeze({
        bound,
        /**
         * The case's nightlyCleanup for runner-bridge. Counts come ONLY from `readResidue(kind, scope)`, the parent's trusted
         * reader, scoped to the confirmed account; the child's report supplies the teardown steps. No report, no confirmed
         * create, or no trusted reader leaves { steps, left } with no verification: cleanup unproven, never PASS.
         */
        async outcome({ readResidue } = {}) {
            const base = { digest: state.digest, refused: state.refused, violations: [...state.violations], confirmedAccount: state.confirmedAccount, confirmedOwner: state.confirmedOwner };
            if (!state.report || state.digest === null || state.violations.length > 0)
                return Object.freeze({ ...base, nightlyCleanup: { steps: state.report?.steps ?? [], left: state.report?.left ?? [] } });
            const cleanup = { steps: state.report.steps, left: state.report.left };
            if (state.confirmedAccount === null || typeof readResidue !== 'function')
                return Object.freeze({ ...base, nightlyCleanup: cleanup });
            // One scoped read per required store of the shared inventory (residue-inventory.cjs), each with its own identity (Sam, 17 Nov).
            const queries = [];
            for (const store of require('./residue-inventory.cjs').j4aRequiredStores()) {
                let count = null;
                try { count = await readResidue(store.id, state.confirmedAccount); } catch { count = null; }
                queries.push({ kind: STORE_KIND[store.table] ?? 'account', store: store.id, scope: state.confirmedAccount, count: COUNT(count) ? count : null });
            }
            return Object.freeze({ ...base, nightlyCleanup: { ...cleanup, verification: { kind: 'zero-residue', queries } } });
        },
    });
}

/**
 * Child end. `port`: `process` (IPC). Resolves to the step's narrow capability after binding with the child's OWN identity,
 * or rejects (J4A_BINDING_REJECTED / J4A_CHANNEL_CLOSED) so the supervisor stops before any browser launch.
 */
function connectChildChannel({ port, identity, timeoutMs = 10_000 }) {
    let next = 0;
    let digest = null;
    let pendingAck = null;
    let confirmTimer = null;
    const waiting = new Map();
    const handlers = new Map();
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('J4A_CHANNEL_CLOSED')), timeoutMs);
        port.on('disconnect', () => { clearTimeout(timer); clearTimeout(confirmTimer); reject(new Error('J4A_CHANNEL_CLOSED')); for (const [, w] of waiting) w({ ok: false, reason: 'channel closed' }); waiting.clear(); });
        port.on('message', async (m) => {
            if (!m || typeof m !== 'object') return;
            if (m.t === 'offer' && digest === null) {
                clearTimeout(timer);
                let ack;
                try { ack = acknowledgeBinding(identity, m.offer); } catch (e) { port.send({ t: 'refusal' }); return reject(e); }
                port.send({ t: 'ack', ack });
                // Not bound yet: the child waits for the parent's positive confirmation of this exact digest (Sam, seal review of 28ceb3bb).
                // A rejection, another digest, no answer within the bound, or a disconnect rejects, and the supervisor stops before launch.
                pendingAck = ack.digest;
                confirmTimer = setTimeout(() => reject(new Error('J4A_CHANNEL_CLOSED')), timeoutMs);
                return undefined;
            }
            if (m.t === 'bound' && pendingAck !== null && digest === null) {
                clearTimeout(confirmTimer);
                if (m.digest !== pendingAck) return reject(new Error('J4A_BINDING_REJECTED'));
                digest = pendingAck;
                return resolve(api);
            }
            if (m.t === 'rejected' && digest === null) { clearTimeout(confirmTimer); return reject(new Error('J4A_BINDING_REJECTED')); }
            if ((m.t === 'go' || m.t === 'createGo') && handlers.has(m.id)) {
                const act = handlers.get(m.id); handlers.delete(m.id);
                let value = null;
                // A throwing act is reported at once as failed (never as done), so the parent records the grant as lost now, not at exit.
                try { value = await act(m); } catch { try { port.send({ t: 'failed', id: m.id }); } catch { /* the parent is gone */ } return; }
                port.send({ t: m.t === 'go' ? 'done' : 'createResult', id: m.id, value });
                return;
            }
            if (m.t === 'res' && waiting.has(m.id)) { const w = waiting.get(m.id); waiting.delete(m.id); w(m); }
        });
        const request = (op, fields, act) => new Promise((res) => {
            const id = `r-${(next += 1)}`;
            if (act) handlers.set(id, act);
            waiting.set(id, res);
            port.send({ t: 'req', id, op, ...fields });
        });
        const api = Object.freeze({
            /** The child's own bound identity (its runId names the J4.a reservation email). */
            identity,
            get digest() { return digest; },
            /** Reserved first; `act()` runs only on the parent's grant. Resolves { granted, ok, value }. */
            send: (kind, act) => request('send', { kind }, () => act()),
            cleanup: (act) => request('cleanup', {}, () => act()),
            /** One guarded create: `act({ retries })` runs once, only after the parent recorded the attempt durably. */
            /** `options.emailDomain`: the run's fixed test domain, recorded durably with the attempt before it is sent. */
            createAccount: (lookupRef, act, { emailDomain } = {}) => request('createAccount', { lookupRef, ...(emailDomain === undefined ? {} : { emailDomain }) }, (m) => act({ retries: m.retries })),
            created: (resource) => request('created', { resource }),
            /** The owner the parent independently confirmed for the guarded create: { ok, ownerId } or { ok: false, reason: 'HOLD: ...' }. Once. */
            confirmOwner: () => request('confirmOwner', {}),
            reportCleanup: (report) => request('reportCleanup', { digest, report }),
        });
    });
}

// The child's OWN identity, built inside run-guarded.cjs before browser launch. Campaign, case, config hash and the exact
// source/served release come from what the child itself validated (the admitted --campaign-id, the hash-checked case config);
// only run id, request and plan hashes come from the runtime-start receipt, and only when its bytes match the SHA-256 pinned on
// the command line and every overlapping field agrees with the child's own values. Any mismatch refuses: no fall-through.
const RUNTIME_START_SCHEMA = 'speaksharp.cloud-test.runtime-start-consumption.v1';
function childIdentity({ runtimeStartBytes, runtimeStartSha256, campaignId, caseConfig, caseConfigSha256 }) {
    const refuse = (why) => { const e = new Error(`J4A_BINDING_REFUSED: ${why}`); e.code = 'J4A_BINDING_REFUSED'; throw e; };
    if (!caseConfig || caseConfig.caseId !== 'AHT-05') refuse('not the J4.a case');
    if (!Buffer.isBuffer(runtimeStartBytes) || !/^[a-f0-9]{64}$/.test(runtimeStartSha256 || '')) refuse('runtime-start receipt unbound');
    if (require('node:crypto').createHash('sha256').update(runtimeStartBytes).digest('hex') !== runtimeStartSha256) refuse('runtime-start receipt changed');
    let rs; try { rs = JSON.parse(runtimeStartBytes); } catch { refuse('runtime-start receipt unreadable'); }
    if (!rs || rs.schema !== RUNTIME_START_SCHEMA || rs.consumer !== 'runtime-start' || rs.attempt !== 1) refuse('runtime-start receipt invalid');
    const own = { campaignId, caseId: caseConfig.caseId, configSha256: caseConfigSha256, sourceSha: caseConfig.sourceSha, servedSha: caseConfig.servedSha };
    if (caseConfig.campaignId !== campaignId) refuse('campaign differs');
    for (const [k, v] of Object.entries(own)) if (rs[k] !== v) refuse(`${k} differs`);
    return Object.freeze({ campaignId, runId: rs.runId, attempt: 1, caseId: own.caseId, requestSha256: rs.requestSha256,
        planSha256: rs.planSha256, configSha256: own.configSha256, sourceSha: own.sourceSha, servedSha: own.servedSha });
}

/**
 * The supervisor's pre-launch step (run-guarded.cjs calls exactly this, before launchGuarded): `args` are run-guarded's parsed
 * arguments, `caseConfig` the hash-checked, validated case config. Resolves to the step's narrow capability, or throws, and the
 * supervisor then stops with exit 78 before any browser launch.
 */
async function bindSupervisedChild(args, caseConfig, { port = process, readFile = require('node:fs').readFileSync, timeoutMs } = {}) {
    if (args['j4a-binding'] !== 'true' || !port || typeof port.send !== 'function') {
        const e = new Error('J4A_BINDING_REFUSED: no supervised channel'); e.code = 'J4A_BINDING_REFUSED'; throw e;
    }
    const identity = childIdentity({ runtimeStartBytes: readFile(args['runtime-start']), runtimeStartSha256: args['runtime-start-sha256'],
        campaignId: args['campaign-id'], caseConfig, caseConfigSha256: args['case-config-sha256'] });
    return connectChildChannel({ port, identity, timeoutMs });
}

module.exports = { RESIDUE_KINDS, attachParentChannel, bindSupervisedChild, childIdentity, connectChildChannel, validCleanupReport };
