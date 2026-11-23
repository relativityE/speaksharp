"use strict";
// #1884 (Sam, 17 Nov): the parent admin client's ONLY transport (createClient(..., { global: { fetch } })). Bounds are enforced where
// the request is actually sent, not assumed:
//   - every request carries its own deadline (a referenced timer aborting an AbortController), combined with the caller's own signal,
//     so a stalled read aborts and caller cancellation still works;
//   - each phase has its own capped allowance, counted per ACTUAL send: `bind` (the owner lookup, which may page) never borrows from
//     `teardown`, and a request past its phase's allowance is refused before anything is sent;
//   - with no phase set, nothing is sent.
// Content-free: counts and phase names only.
const PHASES = Object.freeze(['bind', 'teardown']);

/** `fetchImpl` the real fetch; `deadlineMs` per request; `allowances` { bind, teardown } whole numbers of sends. */
function boundedAdminTransport({ fetchImpl = globalThis.fetch, deadlineMs = 10_000, allowances }) {
    if (typeof fetchImpl !== 'function') throw new Error('admin transport: no fetch');
    if (!Number.isSafeInteger(deadlineMs) || deadlineMs <= 0) throw new Error('admin transport: the per-request deadline must be a positive whole number');
    for (const p of PHASES) if (!Number.isSafeInteger(allowances?.[p]) || allowances[p] < 0) throw new Error(`admin transport: the ${p} allowance must be a whole number`);
    const sent = { bind: 0, teardown: 0 };
    let phase = null;
    const refuse = (code, why) => { const e = new Error(`${code}: ${why}`); e.code = code; return e; };
    return Object.freeze({
        deadlineMs,
        setPhase(p) { if (!PHASES.includes(p)) throw refuse('ADMIN_PHASE', 'unknown phase'); phase = p; },
        sent: () => ({ ...sent }),
        remaining: (p) => (PHASES.includes(p) ? allowances[p] - sent[p] : null),
        async fetch(input, init = {}) {
            if (phase === null) throw refuse('ADMIN_PHASE', 'no phase set, so nothing is sent');
            if (sent[phase] >= allowances[phase]) throw refuse('ADMIN_ALLOWANCE', `the ${phase} allowance of ${allowances[phase]} is spent, so nothing is sent`);
            sent[phase] += 1;
            // A referenced timer while the request is in flight (AbortSignal.timeout's timer is unreferenced, so a stalled request with
            // nothing else pending would never be aborted); once headers arrive it is unreferenced but still aborts a stalled body read.
            const deadline = new AbortController();
            const timer = setTimeout(() => deadline.abort(Object.assign(new Error('ADMIN_DEADLINE: the per-request deadline elapsed'), { code: 'ADMIN_DEADLINE' })), deadlineMs);
            const signal = init.signal ? AbortSignal.any([init.signal, deadline.signal]) : deadline.signal;
            try { return await fetchImpl(input, { ...init, signal }); }
            catch (e) { clearTimeout(timer); throw e; }
            finally { timer.unref?.(); }
        },
    });
}

module.exports = { PHASES, boundedAdminTransport };
