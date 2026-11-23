'use strict';
// #1884 (Sam, seal review of f34804e1): the INTENDED entry point for a nightly J4.a run. It composes the sealed campaign adapter
// (campaign-runner createAdapter) with the parent-owned J4.a hooks and wraps it in the nightly bridge (runner-bridge nightlyAdapter),
// so the real path reaches the parent's own owner confirmation, teardown and zero-residue checks:
//   - j4aOwner: confirmJ4aOwner over the journey's durable create record (evidenceDir, the bridge's runId), the reserved email (the
//     campaign's execution runId and the run's fixed test domain) and an exact lookup with the parent's admin client;
//   - j4aTeardown: j4aParentTeardown with the same inputs and the owner preserved at binding.
// The parent admin client is injected for offline proofs. This entry never reads a privileged credential from its environment.
// Nothing here dispatches, deploys or reseals; `main` refuses unless every input is present and explicitly asked to execute.
const path = require('node:path');
const { confirmJ4aOwner, j4aParentTeardown } = require('./j4a-parent-teardown.cjs');
const { journeyCreateRecord } = require('./cleanup-evidence.cjs');
const { nightlyAdapter } = require('./runner-bridge.cjs');

const HARNESS = path.join(__dirname, '..', 'harness', 'bundle', 'harness');

/**
 * Sam (17 Nov): account_save_obligations has no Auth FK, service_role cannot read it, and completed rows survive the Auth delete. Run-owned
 * cleanup therefore needs a REVIEWED save-journal cleanup capability: { reviewed: <non-empty review reference>, bind({ runId, owner }) ->
 * { bound: { runId, owner }, settle, remove, readBack } }. None exists yet. A missing or malformed capability is HOLD at pilot ADMISSION,
 * before any lock, admin client, browser launch or signup; teardown re-checks the bound journal as defense in depth. Returns the
 * content-free HOLD reason, or null when the capability is present.
 */
function saveJournalCapabilityFault(cap) {
    if (!cap || typeof cap.bind !== 'function' || typeof cap.reviewed !== 'string' || !cap.reviewed.trim())
        return 'HOLD: no reviewed save-journal cleanup capability (account_save_obligations), so the J4.a pilot is not admitted: no signup, browser launch or admin call';
    return null;
}

/** The parent's J4.a hooks for createAdapter. `recordRunId`: the bridge's run id (durable records); `emailRunId`: the execution run id. */
function j4aParentHooks({ admin, transport, saveJournal, evidenceDir, recordRunId, emailRunId, configuredDomain, observeTakes = null }) {
    const fault = saveJournalCapabilityFault(saveJournal);
    if (fault) throw new Error(fault);
    if (!admin || typeof admin.from !== 'function' || typeof admin.auth?.admin?.listUsers !== 'function')
        throw new Error('the J4.a parent hooks need the parent admin client');
    if (!transport || typeof transport.setPhase !== 'function' || typeof transport.remaining !== 'function' || typeof transport.fetch !== 'function')
        throw new Error('the J4.a parent hooks need the admin client\'s bounded transport');
    const createRecord = () => journeyCreateRecord(evidenceDir, recordRunId, 'J4');
    const common = () => ({ admin, transport, createRecord: createRecord(), runId: emailRunId, configuredDomain });
    return Object.freeze({
        // BIND: the transport's own `bind` allowance; never the journey's cleanup reserve.
        j4aOwner: ({ confirmedAccount }) => confirmJ4aOwner({ confirmedAccount, ...common() }),
        // TEARDOWN: its own window, the J4 cleanup reserve's seconds (requests x enforced deadline), started when teardown starts.
        j4aTeardown: ({ nightly, confirmedAccount, preservedOwner, childClosed, stopped, binding }) => {
            const endsAt = Date.now() + teardownWindowMs();
            let journal = null; // bound to THIS run and the preserved owner; a bind failure leaves none, so teardown HOLDs before any request
            try { journal = saveJournal.bind({ runId: emailRunId, owner: preservedOwner }); } catch { journal = null; }
            return j4aParentTeardown({ nightly, confirmedAccount, preservedOwner, childClosed, stopped, binding, timeLeftMs: () => endsAt - Date.now(), saveJournal: journal, observeTakes, ...common() });
        },
    });
}

/**
 * The parent admin client's bounded transport (admin-transport.cjs): every request has the enforced per-request deadline the cleanup
 * reserve assumes (cleanup-plan CLEANUP_REQUEST_DEADLINE_S); the owner lookup gets its own allowance (every page of the exact-email
 * enumeration plus its re-read); teardown gets the journey's cleanup reserve. Each counts actual sends.
 */
function j4aAdminTransport(fetchImpl = globalThis.fetch) {
    const { CLEANUP_REQUEST_DEADLINE_S, cleanupReserve } = require('./cleanup-plan.cjs');
    const { boundedAdminTransport } = require('./admin-transport.cjs');
    return boundedAdminTransport({ fetchImpl, deadlineMs: CLEANUP_REQUEST_DEADLINE_S * 1000,
        allowances: { bind: BIND_LOOKUP_PAGES + 1, teardown: cleanupReserve('J4').requests } });
}
const BIND_LOOKUP_PAGES = 50; // account-lookup enumerateUsers' page cap
const teardownWindowMs = () => require('./cleanup-plan.cjs').cleanupReserve('J4').seconds * 1000;

/**
 * The nightly J4.a composition: createAdapter (sealed) with the parent hooks, wrapped by the nightly bridge. Returns the bridge's
 * { io, outcome, finish }; the caller drives it with campaign-core runCampaign (main) or case by case (offline proofs).
 * `saveWitness` (j4a-save-witness.cjs, offline only): the parent's save journal around the one case launch. It supplies the stopped-writer
 * verifier, sees teardown's takes read and holds the case's save rows unless the lost save, the one Retry, the one saved take, the stopped
 * writer and the takes all agree. It never comes with a separate offline verifier: one source of writer proof.
 */
function composeJ4aNightly({ plan, bundle, admin, transport, saveJournal, configuredDomain, nightly, adapterOptions = {}, offlineStoppedWritersVerifier = null, saveWitness = null }) {
    const { createAdapter } = require(path.join(HARNESS, 'campaign-runner.cjs'));
    if (saveWitness !== null && (offlineStoppedWritersVerifier !== null || ['commandRunner', 'verifier', 'observeTakes', 'gate'].some((k) => typeof saveWitness?.[k] !== 'function')))
        throw new Error('the J4.a save witness is the only writer proof: no second verifier, and all four of its parts');
    const hooks = j4aParentHooks({ admin, transport, saveJournal, evidenceDir: nightly.evidenceDir, recordRunId: nightly.runId,
        emailRunId: plan?.executionIdentity?.runId, configuredDomain, observeTakes: saveWitness ? saveWitness.observeTakes : null });
    const options = saveWitness
        ? { ...adapterOptions, commandRunner: saveWitness.commandRunner(adapterOptions.commandRunner ?? require(path.join(HARNESS, 'admission.cjs')).supervisedCommand) }
        : adapterOptions;
    const raw = createAdapter(plan, bundle, { executeR0: true, ...options, verifyJ4aStopped: saveWitness ? saveWitness.verifier : offlineStoppedWritersVerifier,
        j4aOwner: hooks.j4aOwner, j4aTeardown: hooks.j4aTeardown });
    // The gate sits between the sealed adapter and the bridge, so the bridge splits only rows the parent witness has seen.
    const io = saveWitness ? { ...raw, runCase: async (...args) => saveWitness.gate(await raw.runCase(...args)) } : raw;
    return nightlyAdapter(io, nightly);
}

/**
 * Sam (release boundary 2): the parent admin client may target ONLY the approved project, bound before the client is built or any call
 * is made. The approved identity is the reviewed save oracle's own readback host (draft-adapters durable-save-oracle readbackContract,
 * the same host the adapter's preflight requires the case readback to match), never the environment's say-so. Exact https origin only:
 * no other host, scheme, port, credentials, path, query or fragment. Returns the origin or throws (content-free).
 */
function approvedAdminOrigin(supabaseUrl, approvedHost = require(path.join(__dirname, '..', 'harness', 'draft-adapters', 'durable-save-oracle.cjs')).readbackContract.host) {
    const refuse = () => { const e = new Error('BLOCKED_SETUP: SUPABASE_URL is not the approved project'); e.code = 'WRONG_PROJECT'; throw e; };
    if (typeof approvedHost !== 'string' || !/^[a-z0-9]{20}\.supabase\.co$/.test(approvedHost)) refuse();
    let u;
    try { u = new URL(String(supabaseUrl)); } catch { refuse(); }
    if (u.protocol !== 'https:' || u.host !== approvedHost || u.username || u.password || u.search || u.hash || !['', '/'].includes(u.pathname)) refuse();
    return u.origin;
}

// Discovery chooses the currently served release. The immutable plan remains an
// assertion for this attempt, never a fallback for an unavailable live marker.
async function j4aProductionBinding(plan, deps = {}) {
    const { discoverServedRelease } = await import('../../../scripts/production-release-policy.mjs');
    const observed = await discoverServedRelease(deps.releaseFetch, deps.readReleaseGitHub).catch(() => null);
    if (!observed?.allowed) return 'BLOCKED_SETUP: live production release could not be verified';
    if (observed.releaseSha !== plan.servedSha || observed.releaseSha !== plan.sourceSha)
        return 'BLOCKED_SETUP: approved J4.a plan does not match the live production release';
    return null;
}

// The campaign's status is only provisional until the nightly bridge has
// reconciled the selected leg and written its run-owned cleanup proof.
async function finishJ4aNightly(campaign, { finish, outcome }) {
    if (campaign.report) await finish(campaign.report);
    const nightly = outcome();
    const scope = nightly?.run?.scope;
    let { exitCode } = campaign;
    if (exitCode === 0 && scope?.outcome === 'FAIL') exitCode = 1;
    if (exitCode === 0 && (!campaign.report || scope?.outcome !== 'PASS' || nightly?.cleanup?.result !== 'complete'))
        exitCode = 78;
    return { exitCode, nightly };
}

/**
 * CLI (Sam, seal review of dc7a5ccb): the campaign runner's OWN admission path (loadPinnedCampaign: sha-pinned plan bytes, the fixed
 * bundle, validated paths, no replay, exclusive lock), a plan that selects exactly the J4.a case, then the approved admin target, all
 * before any admin client is built. No --bundle and no unknown or repeated argument. Refusals return 78 with nothing built or run.
 */
async function main(argv, env = process.env, deps = {}) {
    const ALLOWED = ['--plan', '--plan-sha256', '--evidence-dir', '--run-dir', '--run-id', '--execute'];
    const a = {};
    if (argv.length % 2) return { exitCode: 78, reason: 'BLOCKED_SETUP: explicit key/value arguments required' };
    for (let i = 0; i < argv.length; i += 2) {
        if (!ALLOWED.includes(argv[i]) || argv[i] in a) return { exitCode: 78, reason: `BLOCKED_SETUP: unknown or repeated argument ${String(argv[i]).slice(0, 40)}` };
        a[argv[i]] = argv[i + 1];
    }
    if (ALLOWED.some((k) => typeof a[k] !== 'string' || !a[k]) || a['--execute'] !== 'true' || !/^[a-f0-9]{64}$/.test(a['--plan-sha256']))
        return { exitCode: 78, reason: 'BLOCKED_SETUP: --plan, --plan-sha256, --evidence-dir, --run-dir, --run-id and --execute true are required' };
    for (const k of ['SUPABASE_URL', 'LIVE_TEST_EMAIL_DOMAIN'])
        if (!env[k]) return { exitCode: 78, reason: `BLOCKED_SETUP: ${k} is not set in the parent` };
    // Pilot ADMISSION (Sam, 17 Nov): no reviewed save-journal cleanup capability, no run. Nothing is locked, built, launched or sent.
    // Production supplies none today; `deps.saveJournal` exists for the reviewed capability and for offline proofs only, and so does
    // `deps.saveWitness` (the production guard writes no save journal yet).
    const journalFault = saveJournalCapabilityFault(deps.saveJournal);
    if (journalFault) return { exitCode: 78, reason: journalFault };
    if (typeof deps.createClient !== 'function' || typeof deps.releaseFetch !== 'function' || typeof deps.readReleaseGitHub !== 'function')
        return { exitCode: 78, reason: 'HOLD: no offline admin and release fixtures; this entry cannot take production credentials' };
    const runner = require(path.join(HARNESS, 'campaign-runner.cjs'));
    let pinned = null;
    try {
        try { pinned = runner.loadPinnedCampaign({ planFile: a['--plan'], planSha256: a['--plan-sha256'], execute: true }); }
        catch (e) { return { exitCode: 78, reason: `BLOCKED_SETUP: ${String(e.message).slice(0, 160)}` }; }
        const { plan, bundle, root } = pinned;
        const { selectedOrder, runCampaign } = require(path.join(HARNESS, 'campaign-core.cjs'));
        const selected = selectedOrder(plan);
        if (selected.length !== 1 || selected[0] !== 'AHT-05') return { exitCode: 78, reason: 'BLOCKED_SETUP: the J4.a entry runs exactly the AHT-05 case' };
        let origin;
        try { origin = approvedAdminOrigin(env.SUPABASE_URL, deps.approvedHost); } catch (e) { return { exitCode: 78, reason: e.message }; }
        const releaseFault = await j4aProductionBinding(plan, deps);
        if (releaseFault) return { exitCode: 78, reason: releaseFault };
        const transport = j4aAdminTransport(deps.fetchImpl);
        const admin = deps.createClient(origin, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: transport.fetch } });
        const { io, outcome, finish } = composeJ4aNightly({ plan: { ...plan, runRoot: root }, bundle, admin, transport, saveJournal: deps.saveJournal,
            adapterOptions: deps.adapterOptions ?? {}, configuredDomain: env.LIVE_TEST_EMAIL_DOMAIN, saveWitness: deps.saveWitness ?? null,
            nightly: { runDir: a['--run-dir'], evidenceDir: a['--evidence-dir'], runId: a['--run-id'], selected: ['J4.a'], satisfiedGates: [] } });
        const r = await runCampaign(plan, io, { executeR0: true });
        return await finishJ4aNightly(r, { finish, outcome });
    } finally { pinned?.release(); }
}

if (require.main === module) main(process.argv.slice(2)).then((r) => { if (r.reason) console.error(r.reason); process.exitCode = r.exitCode; });
module.exports = { BIND_LOOKUP_PAGES, saveJournalCapabilityFault, teardownWindowMs, approvedAdminOrigin, composeJ4aNightly, finishJ4aNightly, j4aAdminTransport, j4aParentHooks, main };
