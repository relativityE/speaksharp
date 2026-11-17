'use strict';
// #1884 (Sam, seal review of f34804e1): the INTENDED entry point for a nightly J4.a run. It composes the sealed campaign adapter
// (campaign-runner createAdapter) with the parent-owned J4.a hooks and wraps it in the nightly bridge (runner-bridge nightlyAdapter),
// so the real path reaches the parent's own owner confirmation, teardown and zero-residue checks:
//   - j4aOwner: confirmJ4aOwner over the journey's durable create record (evidenceDir, the bridge's runId), the reserved email (the
//     campaign's execution runId and the run's fixed test domain) and an exact lookup with the parent's admin client;
//   - j4aTeardown: j4aParentTeardown with the same inputs and the owner preserved at binding.
// The admin client is the parent's only (injected for offline proofs; built from the environment only by `main`, never in the child).
// Nothing here dispatches, deploys or reseals; `main` refuses unless every input is present and explicitly asked to execute.
const path = require('node:path');
const { confirmJ4aOwner, j4aParentTeardown } = require('./j4a-parent-teardown.cjs');
const { journeyCreateRecord } = require('./cleanup-evidence.cjs');
const { nightlyAdapter } = require('./runner-bridge.cjs');

const HARNESS = path.join(__dirname, '..', 'harness', 'bundle', 'harness');

/** The parent's J4.a hooks for createAdapter. `recordRunId`: the bridge's run id (durable records); `emailRunId`: the execution run id. */
function j4aParentHooks({ admin, evidenceDir, recordRunId, emailRunId, configuredDomain }) {
    if (!admin || typeof admin.from !== 'function' || typeof admin.auth?.admin?.listUsers !== 'function')
        throw new Error('the J4.a parent hooks need the parent admin client');
    const createRecord = () => journeyCreateRecord(evidenceDir, recordRunId, 'J4');
    const common = () => ({ admin, createRecord: createRecord(), runId: emailRunId, configuredDomain });
    return Object.freeze({
        j4aOwner: ({ nightly, confirmedAccount }) => confirmJ4aOwner({ nightly, confirmedAccount, ...common() }),
        j4aTeardown: ({ nightly, confirmedAccount, preservedOwner, childClosed }) =>
            j4aParentTeardown({ nightly, confirmedAccount, preservedOwner, childClosed, ...common() }),
    });
}

/**
 * The nightly J4.a composition: createAdapter (sealed) with the parent hooks, wrapped by the nightly bridge. Returns the bridge's
 * { io, outcome, finish }; the caller drives it with campaign-core runCampaign (main) or case by case (offline proofs).
 */
function composeJ4aNightly({ plan, bundle, admin, configuredDomain, nightly, adapterOptions = {} }) {
    const { createAdapter } = require(path.join(HARNESS, 'campaign-runner.cjs'));
    const hooks = j4aParentHooks({ admin, evidenceDir: nightly.evidenceDir, recordRunId: nightly.runId,
        emailRunId: plan?.executionIdentity?.runId, configuredDomain });
    const raw = createAdapter(plan, bundle, { executeR0: true, ...adapterOptions, j4aOwner: hooks.j4aOwner, j4aTeardown: hooks.j4aTeardown });
    return nightlyAdapter(raw, nightly);
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

/** CLI: refuses unless explicitly executing with every input; the admin client is built here, in the parent, from the environment. */
async function main(argv, env = process.env, deps = {}) {
    const a = {};
    for (let i = 0; i < argv.length; i += 2) a[argv[i]] = argv[i + 1];
    const need = ['--plan', '--bundle', '--evidence-dir', '--run-dir', '--run-id', '--execute'];
    if (need.some((k) => typeof a[k] !== 'string' || !a[k]) || a['--execute'] !== 'true')
        return { exitCode: 78, reason: 'BLOCKED_SETUP: --plan, --bundle, --evidence-dir, --run-dir, --run-id and --execute true are required' };
    for (const k of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'LIVE_TEST_EMAIL_DOMAIN'])
        if (!env[k]) return { exitCode: 78, reason: `BLOCKED_SETUP: ${k} is not set in the parent` };
    const fs = require('node:fs');
    const plan = JSON.parse(fs.readFileSync(a['--plan'], 'utf8'));
    let origin;
    try { origin = approvedAdminOrigin(env.SUPABASE_URL, deps.approvedHost); } catch (e) { return { exitCode: 78, reason: e.message }; }
    const createClient = deps.createClient ?? require('@supabase/supabase-js').createClient;
    const admin = createClient(origin, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const { io, outcome, finish } = composeJ4aNightly({ plan, bundle: a['--bundle'], admin, configuredDomain: env.LIVE_TEST_EMAIL_DOMAIN,
        nightly: { runDir: a['--run-dir'], evidenceDir: a['--evidence-dir'], runId: a['--run-id'], selected: ['J4.a'], satisfiedGates: [] } });
    const { runCampaign } = require(path.join(HARNESS, 'campaign-core.cjs'));
    const r = await runCampaign(plan, io, { executeR0: true });
    if (r.report) await finish(r.report);
    return { exitCode: r.exitCode, nightly: outcome() };
}

if (require.main === module) main(process.argv.slice(2)).then((r) => { if (r.reason) console.error(r.reason); process.exitCode = r.exitCode; });
module.exports = { approvedAdminOrigin, composeJ4aNightly, j4aParentHooks, main };
