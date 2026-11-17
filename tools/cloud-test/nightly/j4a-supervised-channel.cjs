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
//   - reportCleanup: accepted once, only under the bound digest, before the child ends. It becomes the case's
//     `nightlyCleanup`; the bridge still checks the required account/session/lease queries against the CONFIRMED create
//     scope, so the child cannot choose the audit scope. A disconnect or exit before the report leaves cleanup unproven.
// Every request id is used once; a replayed id is refused and recorded as a violation. Content-free: kinds, counts, refs.
const { acknowledgeBinding, beginBinding } = require('./j4a-supervised-binding.cjs');

const LEG = 'J4.a';
const OPS = Object.freeze(['send', 'cleanup', 'createAccount', 'created', 'reportCleanup']);
const KINDS = Object.freeze(['starts', 'coaching']);
const ID = /^[a-z0-9-]{1,40}$/;
const REF = /^[A-Za-z0-9._:-]{1,120}$/;
const COUNT = (v) => Number.isSafeInteger(v) && v >= 0;

/** A cleanup report's shape: steps, leftovers and a zero-residue verification; content-free refs, kinds and counts only. */
function validCleanupReport(r) {
    const resource = (x) => x && typeof x === 'object' && typeof x.kind === 'string' && typeof x.ref === 'string' && REF.test(x.ref);
    return !!r && typeof r === 'object' && Array.isArray(r.steps) && Array.isArray(r.left)
        && r.steps.every((s) => resource(s) && typeof s.action === 'string' && ['done', 'failed', 'not attempted'].includes(s.outcome))
        && r.left.every(resource)
        && r.verification && r.verification.kind === 'zero-residue' && Array.isArray(r.verification.queries)
        && r.verification.queries.every((q) => q && typeof q.kind === 'string' && typeof q.scope === 'string' && REF.test(q.scope)
            && (q.count === null || COUNT(q.count)));
}

/**
 * Parent end. `port`: the ChildProcess (send / on('message') / on('disconnect') / on('exit')). `nightly`: the bridge's object
 * for this case (runner-bridge.cjs `runCase` opts). Returns { bound, outcome() }. Never throws into the supervisor's flow:
 * every refusal is recorded in `violations`, and nothing reaches `nightly` without a bound digest.
 */
function attachParentChannel({ port, identity, nightly }) {
    const binding = beginBinding(identity);
    const state = { digest: null, refused: null, ended: false, report: null, violations: [], seen: new Set(), pending: new Map() };
    const reply = (msg) => { if (!state.ended) try { port.send(msg); } catch { /* the child is gone */ } };
    const refuse = (id, reason) => { state.violations.push(reason); reply({ t: 'res', id, ok: false, reason }); };
    /** Waits for the child's "done"/"createResult" for `id`; a disconnect or exit settles it as lost (never success). */
    const awaitChild = (id) => new Promise((resolve) => { state.pending.set(id, resolve); });
    const settleAll = () => { for (const [, resolve] of state.pending) resolve({ lost: true }); state.pending.clear(); };
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
            const r = await route(async () => { reply({ t: 'go', id }); childResult = await awaitChild(id); if (childResult.lost) throw new Error('lost'); return childResult.value; })
                .catch(() => ({ sent: true, lost: true }));
            return reply({ t: 'res', id, ok: r.sent === true && !r.lost, granted: r.sent === true, lost: r.lost === true || childResult?.lost === true,
                value: r.sent && !r.lost ? r.value ?? null : null, reason: r.sent ? undefined : r.reason });
        }
        if (op === 'createAccount') {
            if (typeof m.lookupRef !== 'string' || !REF.test(m.lookupRef)) return refuse(id, 'malformed lookupRef');
            const r = await nightly.createAccount(LEG, m.lookupRef, async ({ signal, retries }) => {
                reply({ t: 'createGo', id, retries });
                const answer = await Promise.race([awaitChild(id),
                    new Promise((res) => signal.addEventListener('abort', () => res({ lost: true }), { once: true }))]);
                if (answer.lost) throw new Error('create answer lost');
                return answer.value;
            }).catch(() => ({ sent: true, answered: false }));
            return reply({ t: 'res', id, ok: r.sent === true && r.answered === true, sent: r.sent === true, answered: r.answered === true,
                outcome: r.answered ? r.value?.outcome ?? null : null, reason: r.sent ? undefined : r.reason });
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
        state.report = { steps: m.report.steps, left: m.report.left, verification: m.report.verification };
        return reply({ t: 'res', id, ok: true });
    }

    port.on('message', (m) => {
        if (state.ended || !m || typeof m !== 'object') return;
        if (m.t === 'ack') {
            if (state.digest !== null || state.refused) { state.violations.push('second binding reply'); return; }
            try { state.digest = binding.accept(m.ack); resolveBound(state.digest); }
            catch (e) { state.refused = e.message; resolveBound(null); }
            return;
        }
        if (m.t === 'refusal') { if (state.digest === null && !state.refused) { state.refused = 'child refused the binding'; resolveBound(null); } return; }
        if ((m.t === 'done' || m.t === 'createResult') && state.pending.has(m.id)) {
            const resolve = state.pending.get(m.id); state.pending.delete(m.id); resolve({ value: m.value ?? null });
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
         * The case's nightlyCleanup for runner-bridge, from the verified report only. No report (child ended, refused or never
         * bound) is { steps: [], left: [] } with no verification: cleanup unproven, so the journey can never PASS on it.
         */
        outcome: () => Object.freeze({
            digest: state.digest, refused: state.refused, violations: [...state.violations],
            nightlyCleanup: state.report ? { ...state.report } : { steps: [], left: [] },
        }),
    });
}

/**
 * Child end. `port`: `process` (IPC). Resolves to the step's narrow capability after binding with the child's OWN identity,
 * or rejects (J4A_BINDING_REJECTED / J4A_CHANNEL_CLOSED) so the supervisor stops before any browser launch.
 */
function connectChildChannel({ port, identity, timeoutMs = 10_000 }) {
    let next = 0;
    let digest = null;
    const waiting = new Map();
    const handlers = new Map();
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('J4A_CHANNEL_CLOSED')), timeoutMs);
        port.on('disconnect', () => { clearTimeout(timer); reject(new Error('J4A_CHANNEL_CLOSED')); for (const [, w] of waiting) w({ ok: false, reason: 'channel closed' }); waiting.clear(); });
        port.on('message', async (m) => {
            if (!m || typeof m !== 'object') return;
            if (m.t === 'offer' && digest === null) {
                clearTimeout(timer);
                let ack;
                try { ack = acknowledgeBinding(identity, m.offer); } catch (e) { port.send({ t: 'refusal' }); return reject(e); }
                digest = ack.digest;
                port.send({ t: 'ack', ack });
                return resolve(api);
            }
            if ((m.t === 'go' || m.t === 'createGo') && handlers.has(m.id)) {
                const act = handlers.get(m.id); handlers.delete(m.id);
                let value = null;
                try { value = await act(m); } catch { return; } // a throwing act sends nothing back: the parent sees it as lost
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
            get digest() { return digest; },
            /** Reserved first; `act()` runs only on the parent's grant. Resolves { granted, ok, value }. */
            send: (kind, act) => request('send', { kind }, () => act()),
            cleanup: (act) => request('cleanup', {}, () => act()),
            /** One guarded create: `act({ retries })` runs once, only after the parent recorded the attempt durably. */
            createAccount: (lookupRef, act) => request('createAccount', { lookupRef }, (m) => act({ retries: m.retries })),
            created: (resource) => request('created', { resource }),
            reportCleanup: (report) => request('reportCleanup', { digest, report }),
        });
    });
}

module.exports = { attachParentChannel, connectChildChannel, validCleanupReport };
