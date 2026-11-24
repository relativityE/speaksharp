"use strict";
/**
 * J8's protected live entry (Sam, 23 Nov: the credential-bearing J8 composition lives in the protected release-runner layer, outside
 * tools/cloud-test, which stays key-free). The rc-gates J8 job runs this file; nothing else supplies J8's live parts.
 *
 * It alone reads SUPABASE_SERVICE_ROLE_KEY. In order, with every refusal 78, content-free, and nothing built, recorded or sent:
 *   1. the entry's own CLI checks (arguments, domain, run binding, the runner step's start);
 *   2. the dispatch's two RWT acknowledgements, exactly (disposable-account writes and the run-owned canary claim);
 *   3. SUPABASE_URL and the key, and the URL must be the approved project (J4.a's approvedAdminOrigin, exact https origin).
 * Then it builds two clients for that project only, each over its own bounded transport: teardown's (the parent recovery) and the
 * parent operations' (the four named operations the spec reaches through loopback). The key-free adapters and `main` get an env
 * WITHOUT the key; the key is handed to the adapters only as the scoped delete child's held value, which they refuse to see in the
 * spec, readback or coaching env. Every runJ8Nightly guard is unchanged.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const NIGHTLY = path.join(__dirname, '..', 'tools', 'cloud-test', 'nightly');
const entry = require(path.join(NIGHTLY, 'j8-nightly-entry.cjs'));

/** The rc-gates acknowledgements a J8 run needs (inputs rwt_writes_ack and rwt_canary_claim_ack). */
const J8_WRITES_ACK = 'RWT-DISPOSABLE-ACCOUNT-WRITES';
const J8_CANARY_ACK = 'RWT-CANARY-CLAIM-RUN-OWNED';
/** The one credential this entry holds. Only the scoped delete child receives it. */
const KEY_NAME = 'SUPABASE_SERVICE_ROLE_KEY';

const without = (env, names) => Object.fromEntries(Object.entries(env).filter(([k]) => !names.includes(k)));

/**
 * `inject` is for offline proofs only: createClient, fetchImpl, approvedHost, liveAdapters, finalize and run (default entry.main).
 */
async function liveMain(argv, env = process.env, inject = {}) {
    const cli = entry.cliArgs(argv, env);
    if (!cli.args) return cli;
    // Explicit disposable canary scope: the dispatch's own write and canary-claim acknowledgements, exactly, or nothing is built.
    // The spec checks them again before its signup; the readback reads canary traffic only.
    if (env.RWT_WRITES_ACK !== J8_WRITES_ACK || env.RWT_CANARY_CLAIM_ACK !== J8_CANARY_ACK)
        return { exitCode: 78, reason: 'BLOCKED_SETUP: J8 needs the exact disposable-account write and canary-claim acknowledgements' };
    if (!env.SUPABASE_URL || !env[KEY_NAME])
        return { exitCode: 78, reason: `BLOCKED_SETUP: SUPABASE_URL and ${KEY_NAME} are required in the parent` };
    let origin;
    try { origin = require(path.join(NIGHTLY, 'j4a-nightly-entry.cjs')).approvedAdminOrigin(env.SUPABASE_URL, inject.approvedHost); }
    catch (e) { return { exitCode: 78, reason: e.message }; }
    const createClient = inject.createClient ?? require('@supabase/supabase-js').createClient;
    const opts = (transport) => ({ auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: transport.fetch } });
    const admin = createClient(origin, env[KEY_NAME], opts(entry.j8AdminTransport(inject.fetchImpl)));
    // The parent operations' client: same approved origin, its own capped transport (never teardown's allowance).
    const opsAdmin = createClient(origin, env[KEY_NAME], opts(entry.j8OpsTransport(inject.fetchImpl)));
    const childEnv = without(env, [KEY_NAME]);
    const adapters = (inject.liveAdapters ?? require(path.join(NIGHTLY, 'j8-live-adapters.cjs')).j8LiveAdapters)({
        admin, opsAdmin, baseEnv: childEnv, heldEnv: { [KEY_NAME]: env[KEY_NAME] } });
    const finalize = inject.finalize ?? entry.finalizerEvaluate;
    const workDir = fs.mkdtempSync(path.join(env.RUNNER_TEMP || os.tmpdir(), 'j8-evaluation-'));
    try {
        fs.chmodSync(workDir, 0o700);
        return await (inject.run ?? entry.main)(argv, childEnv, { ...adapters, evaluate: (receipt, readback) => finalize(receipt, readback, { workDir }) });
    } finally { fs.rmSync(workDir, { recursive: true, force: true }); }
}

if (require.main === module) liveMain(process.argv.slice(2)).then((r) => {
    if (r.reason) console.error(r.reason);
    console.log(`J8_RUNNER_RESULT ${JSON.stringify(entry.j8RunSummary(r))}`);
    process.exitCode = r.exitCode;
});

module.exports = { J8_CANARY_ACK, J8_WRITES_ACK, KEY_NAME, liveMain };
