'use strict';
// J8 nightly entry, live adapters (Jack, 21 Nov). These are the four calls `runJ8Nightly` takes, built the way rc-gates already
// runs them, so the dedicated entry reads RECEIVED evidence exactly as the reviewed workflow does:
//   runSpec   — the J8 live spec on the deployed-live Playwright project, with the entry's admission, run and attempt bound in env.
//               Its outcome names the admission, run and attempt it ran with, and whether the deadline killed it;
//   qualify   — `pnpm telemetry:readback-qualification` per bound journey (canary), exit 0 QUALIFIED / 3 FAIL (final) / else retried,
//               after one wait for ingestion before the first readback of the run. It returns the CLI's OWN evidence line, so the
//               entry can check what the readback actually checked (release, journey, stages, attempts), never an exit code alone;
//   coaching  — the same CLI in coaching-diagnostic mode, anchored by the entry to J8.b's one journey; only the CLI's own bound
//               receipt whose verdict agrees with its exit code is returned;
//   lookup    — the parent's complete exact-email lookup through the admin listing (`enumerateUsers` + `exactEmailLookup`), bounded;
// and, for the parent's landed-and-cleaned recovery (Sam on 27ee1856, route (b); j8-parent-recovery.cjs), over the caller's admin client:
//   readAccount  — the account re-read by id: its email, creation time and run binding (app_metadata.ct_run);
//   scopedDelete — the established scoped path (scripts/rwt-j8-parent-delete.mts -> runOwnedCleanup.ts cleanupRunOwnedAccount) as its
//                  own process, bound to the run the parent checked; deleted only on exit 0 with exactly one verified-cleanup line;
//   readResidue  — the parent's own read of one required store: a head count by owner id or reserved email, the save journal through
//                  its count function (service_role cannot read that table), the account itself by a not-found re-read.
// Sam on b1f8323f (4): every process and the lookup is bounded. A process over its deadline is killed (SIGKILL) and is never a
// terminal outcome; a lookup over its deadline is `unreadable`.
// Sam on 65365f36: a HOLD must never be reported while a delete or a browser is still running. Every process starts in its own
// process group with a per-run tag in its environment, which its whole tree inherits (pnpm, Playwright, the browser Playwright
// starts in a group of its own, tsx's node). When it exits, or is killed at its deadline, the runner kills every process still
// carrying that tag and resolves only once none is left (`drained`). A tree it cannot confirm gone (no /proc, or still there after
// the drain window) is `drained: false`, and nothing that depends on it counts: the spec is not an exit, a delete is not deleted.
// Nothing here opens the J8 live gate: `main` still refuses, and `no-j8-harness-adapter` stays NEVER_SATISFIED until Sam opens it.
// The adapters read no credential themselves: the spec and the readback inherit the parent's environment, and the admin listing
// comes from a client the caller builds. Every malformed input is refused before a process starts (HOLD), never guessed.
const path = require('node:path');
const { enumerateUsers, exactEmailLookup } = require('./account-lookup.cjs');

const SPEC = 'tests/live/rwt-feedback-association-boundaries.live.spec.ts';
const LIVE_CONFIG = 'playwright.deployed-live.config.ts';
const LIVE_PROJECT = 'deployed-live-chromium';
// Sam on 27ee1856: only the J8 test uses the journaled reservation, so the adapter selects exactly it, by its exact combined title
// (describe, a space, the test; Playwright matches --grep against the title path), and proves the selection with --list first.
const J8_DESCRIBE = 'RWT — Share Feedback association boundaries @live';
const J8_TEST = 'J8: one account — No session before any take, older-take feedback, No session with both takes listed';
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const SPEC_GREP = `${escapeRe(J8_DESCRIBE)} ${escapeRe(J8_TEST)}$`;
const LIST_TIMEOUT_MS = 2 * 60_000;
const specArgs = (...extra) => ['exec', 'playwright', 'test', SPEC, `--config=${LIVE_CONFIG}`, `--project=${LIVE_PROJECT}`, `--grep=${SPEC_GREP}`, ...extra];
/** The --list output selects exactly one test, and it is the J8 test of the J8 spec. */
function listsOnlyJ8(stdout) {
    const lines = String(stdout ?? '').split('\n').map((l) => l.trim());
    const listed = lines.filter((l) => l.startsWith('[') && l.includes(' › '));
    return listed.length === 1 && listed[0].endsWith(` › ${J8_DESCRIBE} › ${J8_TEST}`)
        && listed[0].includes(` › ${SPEC.replace(/^tests\//, '')}:`) && lines.includes('Total: 1 test in 1 file');
}
const INGESTION_WAIT_MS = 120_000;
const RETRY_WAIT_MS = 60_000;
const ATTEMPTS = 3;
const READBACK_TIMEOUT_MS = 5 * 60_000;
// The list, the spec and both settles (drain plus close grace) end inside the entry's 32-minute spec deadline, so the entry never
// moves on while they run.
const SPEC_TIMEOUT_MS = 28 * 60_000;
const DRAIN_TIMEOUT_MS = 30_000;
// After the drain, how long the runner waits for the child's stdout to reach end of file. A pipe still open then is held by a process
// that does not carry the tag, so the tree is not confirmed stopped (Sam on eb8165a0).
const CLOSE_GRACE_MS = 2_000;
// The most a runner can take after its deadline: the drain window, then the close grace.
const SETTLE_MS = DRAIN_TIMEOUT_MS + CLOSE_GRACE_MS;
const PROC_TAG_ENV = 'RWT_J8_PROC_TAG';
const LOOKUP_TIMEOUT_MS = 2 * 60_000;
const SHA = /^[a-f0-9]{40}$/;
const ID = /^[A-Za-z0-9._:-]{1,120}$/;
const STAGE = /^[a-z_]{1,40}$/;
const RECEIPT_PREFIX = 'COACHING_DIAGNOSTIC_RECEIPT ';
const EVIDENCE_PREFIX = 'TELEMETRY_READBACK_QUALIFICATION_EVIDENCE ';
const DELETE_SCRIPT = 'scripts/rwt-j8-parent-delete.mts';
const DELETE_TIMEOUT_MS = 5 * 60_000;
const DELETE_VERDICT = /^RUN_OWNED_CLEANUP cleanup_verified residue=0 tables_verified=\d+$/;
const SAVE_JOURNAL_COUNT_FN = 'count_account_save_journal_v1';
const BINDING_ENV = Object.freeze({ repository: 'GITHUB_REPOSITORY', workflow: 'GITHUB_WORKFLOW_REF', runId: 'GITHUB_RUN_ID', runAttempt: 'GITHUB_RUN_ATTEMPT' });
/** runOwnedCleanup.ts isNotFoundError, the same rule: only the documented not-found answer proves the account is gone. */
const isNotFound = (e) => !!e && e.status === 404 && /user_not_found|not[_\s-]?found|does not exist|no user/i.test(`${e.code ?? ''} ${e.message ?? ''}`);
const countOf = (r) => (!r?.error && Number.isSafeInteger(r?.count) && r.count >= 0 ? r.count : null);

const realSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Reading a process's environment fails with ENOENT once it has exited and ESRCH when it has no address space (a kernel thread, or
// a process already exiting); neither can carry the tag or run code, so neither is a process to drain.
const NO_ENVIRONMENT = new Set(['ENOENT', 'ESRCH']);
/**
 * Field 22 of /proc/<pid>/stat, the start time in clock ticks since boot: a number, 'gone', or null when it cannot be read.
 * A zombie (Z) or dead (X) process is 'gone': it has already closed every file and runs nothing, it only waits to be reaped, and
 * the kernel refuses a non-root reader its environment (EACCES) even when it was this run's (CI on 87fef151).
 */
function startTicksOf(pid, procFs) {
    let stat;
    try { stat = procFs.readFileSync(`/proc/${pid}/stat`, 'latin1'); } catch (e) { return NO_ENVIRONMENT.has(e?.code) ? 'gone' : null; }
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    if (fields[0] === 'Z' || fields[0] === 'X') return 'gone';
    return /^\d+$/.test(fields[19] ?? '') ? Number(fields[19]) : null;
}
/** The real uid (the first Uid: field) of /proc/<pid>/status: a number, 'gone', or null when it cannot be read. */
function realUidOf(pid, procFs) {
    let status;
    try { status = procFs.readFileSync(`/proc/${pid}/status`, 'latin1'); } catch (e) { return NO_ENVIRONMENT.has(e?.code) ? 'gone' : null; }
    const m = /^Uid:\s+(\d+)\s/m.exec(status);
    return m ? Number(m[1]) : null;
}
/**
 * Whether a process whose environment cannot be read may still be this run's (Sam on eb8165a0): true unless it has exited, started
 * before this runner's own process (so it cannot descend from it), or runs with another real uid (a program this run starts keeps
 * ours, setuid or not). Anything that cannot be read is treated as this run's.
 */
function mayBeRunOwned(pid, { procFs, selfPid, uid }) {
    const started = startTicksOf(pid, procFs);
    if (started === 'gone') return false;
    const self = startTicksOf(selfPid, procFs);
    if (Number.isInteger(started) && Number.isInteger(self) && started < self) return false;
    const owner = realUidOf(pid, procFs);
    if (owner === 'gone' || (Number.isInteger(owner) && owner !== uid)) return false;
    return true;
}

/**
 * The pids of every live process whose environment carries `PROC_TAG_ENV=tag`; null when /proc cannot be listed, or when a process
 * that may be this run's cannot be inspected (above), so the drain fails closed rather than skip it.
 */
function taggedPids(tag, { procFs = require('node:fs'), selfPid = process.pid, uid = process.getuid() } = {}) {
    let entries;
    try { entries = procFs.readdirSync('/proc'); } catch { return null; }
    const needle = `${PROC_TAG_ENV}=${tag}`;
    const pids = [];
    for (const e of entries) {
        if (!/^\d+$/.test(e) || Number(e) === selfPid) continue;
        let environ;
        try { environ = procFs.readFileSync(`/proc/${e}/environ`, 'latin1'); } catch (err) {
            if (NO_ENVIRONMENT.has(err?.code) || !mayBeRunOwned(e, { procFs, selfPid, uid })) continue;
            return null;
        }
        if (environ.split('\0').includes(needle)) pids.push(Number(e));
    }
    return pids;
}

/**
 * Kill every process carrying `tag` until none is left. true only once a scan finds none; false when /proc cannot be read or a
 * process is still there when the window closes. A killed process that is not yet reaped has no environment, so it is gone.
 */
async function drainTagged(tag, { list = taggedPids, kill = (pid) => process.kill(pid, 'SIGKILL'), sleep = realSleep, timeoutMs = DRAIN_TIMEOUT_MS, now = Date.now } = {}) {
    if (typeof tag !== 'string' || !tag) return false;
    const until = now() + timeoutMs;
    for (;;) {
        const pids = list(tag);
        if (!Array.isArray(pids)) return false;
        if (pids.length === 0) return true;
        for (const pid of pids) { try { kill(pid); } catch { /* already gone */ } }
        if (now() >= until) return false;
        await sleep(100);
    }
}

/**
 * The process runner: (command, args, { env, cwd, timeout }) -> Promise<{ status, stdout, timedOut, drained }>. The process starts in
 * its own group, tagged; at its deadline the group is killed (SIGKILL) and it is reported `timedOut` with no status. The drain (above)
 * starts when the child exits or its deadline passes, never from the stdout pipe closing, since a descendant that inherited stdout
 * holds the pipe open (Sam on eb8165a0). After the drain, stdout must reach end of file within the close grace; a pipe still held
 * then belongs to a process without the tag, so `drained` is false. It resolves within `timeout` + SETTLE_MS. Proofs inject a runner.
 */
function spawnRunner({ drain = drainTagged, newTag = () => require('node:crypto').randomUUID(), closeGraceMs = CLOSE_GRACE_MS,
    spawn = require('node:child_process').spawn } = {}) {
    return (command, args, { env, cwd, timeout }) => new Promise((resolve) => {
        const tag = newTag();
        let stdout = '';
        let timedOut = false;
        let settling = false;
        let child;
        let timer;
        let closed = false;
        let onClosed = () => {};
        const pipeClosed = () => { closed = true; onClosed(); };
        const endOfFile = () => new Promise((done) => {
            if (closed) { done(true); return; }
            const grace = setTimeout(() => done(false), closeGraceMs);
            onClosed = () => { clearTimeout(grace); done(true); };
        });
        const settle = (status) => {
            if (settling) return;
            settling = true;
            clearTimeout(timer);
            Promise.resolve().then(() => drain(tag)).then((drained) => drained === true, () => false)
                .then(async (drained) => {
                    const eof = await endOfFile();
                    if (!eof) { try { child.stdout.destroy(); } catch { /* already closed */ } }
                    resolve({ status: timedOut ? null : status, stdout, timedOut, drained: drained && eof });
                });
        };
        try { child = spawn(command, args, { env: { ...env, [PROC_TAG_ENV]: tag }, cwd, stdio: ['ignore', 'pipe', 'inherit'], detached: true }); }
        catch { closed = true; settle(null); return; }
        // Only while the child is alive is its pid its group's id, so the group is killed only here; then the tag decides.
        timer = setTimeout(() => {
            timedOut = true;
            try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch { /* gone */ } }
            settle(null);
        }, timeout);
        child.stdout.setEncoding('utf8');
        child.stdout.on('data', (d) => { if (stdout.length < 16 * 1024 * 1024) stdout += d; });
        child.stdout.on('close', pipeClosed);
        child.on('error', () => { if (!child.pid) closed = true; settle(null); });
        child.on('exit', (code) => settle(typeof code === 'number' ? code : null));
    });
}

/** 0 and 3 are final; anything else (including a spawn failure or a kill at the deadline) is retried, then HOLD. */
function finalCode(status) { return status === 0 || status === 3; }

function readbackArgs(release, journeyId) {
    return ['-s', 'telemetry:readback-qualification', '--release-sha', release, '--journey-id', journeyId, '--traffic-type', 'canary'];
}

/** A readback whose process tree was not confirmed stopped: never final, so the entry HOLDs it. */
const UNCONFIRMED = Object.freeze({ status: null, stdout: '', unconfirmed: true });

/**
 * One wait for ingestion before the run's first readback (rc-gates' `sleep 120`), shared by `qualify` and `coaching`, then up to
 * three tries with a wait between them. Returns the last { status, stdout }.
 * A run whose process tree is not confirmed stopped (`drained !== true`, or a runner that threw) is never accepted, even with a
 * final code and a valid line, and nothing runs after it in this session: no retry and no later journey or coaching call, since
 * the earlier process may still be running (Sam on 87fef151).
 */
function readbackSession({ run, sleep, repoRoot, baseEnv }) {
    let waited = false;
    let unconfirmed = false;
    return async function readback(release, journeyId, extraEnv) {
        if (unconfirmed) return UNCONFIRMED;
        if (!waited) { waited = true; await sleep(INGESTION_WAIT_MS); }
        let last = { status: null, stdout: '' };
        for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
            try { last = await run('pnpm', readbackArgs(release, journeyId), { env: { ...baseEnv, ...extraEnv }, cwd: repoRoot, timeout: READBACK_TIMEOUT_MS }); }
            catch { last = null; }
            if (last?.drained !== true) { unconfirmed = true; return UNCONFIRMED; }
            if (last.timedOut === true) last = { status: null, stdout: '' };
            if (finalCode(last?.status)) return last;
            if (attempt < ATTEMPTS) await sleep(RETRY_WAIT_MS);
        }
        return last;
    };
}

/** Exactly one prefixed JSON line, or null. */
function oneLine(stdout, prefix) {
    const lines = String(stdout).split('\n').filter((l) => l.startsWith(prefix));
    if (lines.length !== 1) return null;
    try { const o = JSON.parse(lines[0].slice(prefix.length)); return o && typeof o === 'object' && !Array.isArray(o) ? o : null; } catch { return null; }
}

/** The coaching CLI's own receipt line, kept only when it is bound (release + expected binding) and agrees with the exit code. */
function boundCoachingReceipt(stdout, status) {
    const verdict = status === 0 ? 'PASS' : status === 3 ? 'FAIL' : 'HOLD';
    const o = oneLine(stdout, RECEIPT_PREFIX);
    if (!o || o.verdict !== verdict || !Array.isArray(o.reasons) || typeof o.release !== 'string' || !o.expected || typeof o.expected !== 'object') return null;
    return { verdict: o.verdict, reasons: o.reasons, release: o.release, expected: o.expected };
}

/**
 * The readback CLI's own evidence line for a final answer (exit 0 or 3), kept only when its verdict agrees with the exit code.
 * The entry then checks what it names (release, journey, traffic, stages, attempts) against what it asked for.
 */
function readbackEvidence(stdout, status) {
    if (!finalCode(status)) return null;
    const o = oneLine(stdout, EVIDENCE_PREFIX);
    const verdict = status === 0 ? 'QUALIFIED' : 'FAIL';
    if (!o || o.gate !== 'TELEMETRY-READBACK-COMPLETENESS' || o.verdict !== verdict) return null;
    return { verdict: o.verdict, release_sha: o.release_sha, journey_id: o.journey_id, boot_id: o.boot_id, traffic_type: o.traffic_type,
        stages_declared: o.stages_declared, attempts_declared: o.attempts_declared };
}

/** A promise bounded by `ms`: past it, `onTimeout()` is the answer. */
async function bounded(promise, ms, onTimeout) {
    let timer;
    try { return await Promise.race([promise, new Promise((resolve) => { timer = setTimeout(() => resolve(onTimeout()), ms); })]); }
    finally { clearTimeout(timer); }
}

/**
 * The four live calls for `runJ8Nightly`. `listUsers` is the caller's admin listing (`admin.auth.admin.listUsers`); with none,
 * `lookup` is absent and the entry cannot prove zero residue, so the run cannot be admitted by `main`.
 */
function j8LiveAdapters({ repoRoot = path.join(__dirname, '..', '..', '..'), baseEnv = process.env, run = spawnRunner(), sleep = realSleep,
    listUsers = null, admin = null, lookupTimeoutMs = LOOKUP_TIMEOUT_MS, clock = Date.now } = {}) {
    if (!listUsers && admin?.auth?.admin && typeof admin.auth.admin.listUsers === 'function') listUsers = (args) => admin.auth.admin.listUsers(args);
    const readback = readbackSession({ run, sleep, repoRoot, baseEnv });
    const adapters = {
        /**
         * Where the spec writes its receipt: Playwright runs with `cwd: repoRoot` and the receipt writer resolves `test-results/rwt`
         * against its working directory. The entry admits a run only when its run directory is this one (Codex on 4a5d718a).
         */
        artifactRoot: repoRoot,
        /** -> { exitCode, admissionFile, runId, runAttempt, timedOut, drained }: the spec's terminal outcome, naming what it ran with. */
        async runSpec({ env }) {
            if (!env || typeof env !== 'object') return { exitCode: null, timedOut: false };
            const specEnv = { ...baseEnv, VITE_USE_LIVE_DB: 'true', ...env };
            let listed;
            try { listed = await run('pnpm', specArgs('--list'), { env: specEnv, cwd: repoRoot, timeout: LIST_TIMEOUT_MS }); } catch { listed = null; }
            if (listed?.timedOut === true || listed?.status !== 0 || listed?.drained !== true || !listsOnlyJ8(listed?.stdout))
                return { exitCode: null, timedOut: false, drained: listed?.drained === true, notRun: 'the selector did not list exactly the J8 test', admissionFile: env.RWT_J8_RUNNER_ADMISSION, runId: env.GITHUB_RUN_ID, runAttempt: env.GITHUB_RUN_ATTEMPT };
            let r;
            try {
                r = await run('pnpm', specArgs('--reporter=line'), { env: specEnv, cwd: repoRoot, timeout: SPEC_TIMEOUT_MS });
            } catch { r = null; }
            const timedOut = r?.timedOut === true;
            return { exitCode: !timedOut && typeof r?.status === 'number' ? r.status : null, timedOut, drained: r?.drained === true,
                admissionFile: env.RWT_J8_RUNNER_ADMISSION, runId: env.GITHUB_RUN_ID, runAttempt: env.GITHUB_RUN_ATTEMPT };
        },
        /** -> { status, evidence }: the readback's exit code and its own evidence line (null unless final and agreeing). */
        async qualify({ journeyId, stages, attemptIds, firstDownload, release }) {
            if (!SHA.test(String(release)) || !ID.test(String(journeyId)) || !Array.isArray(stages) || stages.length === 0
                || !stages.every((s) => STAGE.test(String(s))) || !Array.isArray(attemptIds) || !attemptIds.every((a) => ID.test(String(a)))) return { status: 1, evidence: null };
            const r = await readback(release, journeyId, { TELEMETRY_READBACK_ACQUISITION_RECEIPT: firstDownload === true ? '1' : '0',
                QUALIFICATION_ATTEMPT_IDS: attemptIds.join(','), QUALIFICATION_STAGES: stages.join(',') });
            const status = typeof r?.status === 'number' ? r.status : 1;
            return { status, evidence: readbackEvidence(r?.stdout ?? '', status) };
        },
        async coaching({ journeyId, expectation, release }) {
            if (!SHA.test(String(release)) || !ID.test(String(journeyId)) || !expectation || typeof expectation !== 'object') return null;
            const r = await readback(release, journeyId, { TELEMETRY_READBACK_COACHING_DIAGNOSTIC: '1', COACHING_DIAGNOSTIC_EXPECTATION: JSON.stringify(expectation) });
            return boundCoachingReceipt(r?.stdout ?? '', r?.status);
        },
    };
    if (typeof listUsers === 'function') {
        adapters.lookup = async ({ email, runOwnedPrefix }) => {
            const enumeration = await bounded(enumerateUsers(listUsers).catch(() => ({ complete: false, reason: 'the listing threw', users: [] })), lookupTimeoutMs,
                () => ({ complete: false, reason: `the listing did not finish within ${lookupTimeoutMs} ms`, users: [] }));
            return exactEmailLookup(enumeration, { email, runOwnedPrefix });
        };
    }
    if (admin && typeof admin.from === 'function' && typeof admin.rpc === 'function' && typeof admin.auth?.admin?.getUserById === 'function') {
        adapters.readAccount = async (uid) => {
            const r = await admin.auth.admin.getUserById(uid);
            const user = r?.error ? null : r?.data?.user;
            return user ? { email: user.email ?? null, createdAt: user.created_at ?? null, ctRun: user.app_metadata?.ct_run ?? null } : null;
        };
        adapters.readResidue = async ({ store, table, column, key, uid, email }) => {
            if (store === 'auth:account') {
                const r = await admin.auth.admin.getUserById(uid);
                return isNotFound(r?.error) ? 0 : r?.data?.user ? 1 : null;
            }
            if (table === 'account_save_obligations') {
                const r = await admin.rpc(SAVE_JOURNAL_COUNT_FN, { p_user_id: uid });
                return !r?.error && Number.isSafeInteger(r?.data) && r.data >= 0 ? r.data : null;
            }
            if (typeof table !== 'string' || typeof column !== 'string' || !['owner', 'email'].includes(key)) return null;
            return countOf(await admin.from(table).select(column, { count: 'exact', head: true }).eq(column, key === 'email' ? String(email).toLowerCase() : uid));
        };
        // `timeoutMs`: what is left of the parent's cleanup budget (Sam on 65365f36). The delete is killed early enough that the kill,
        // the drain and the close grace all end inside it, and it is told its deadline; with no room for them, it does not start.
        adapters.scopedDelete = async ({ uid, email, binding, timeoutMs }) => {
            if (typeof uid !== 'string' || !uid || typeof email !== 'string' || !email || !binding
                || Object.keys(BINDING_ENV).some((k) => typeof binding[k] !== 'string' || !binding[k])) return { deleted: false, drained: true };
            if (!Number.isFinite(timeoutMs) || timeoutMs <= SETTLE_MS) return { deleted: false, drained: true };
            const processTimeout = Math.min(DELETE_TIMEOUT_MS, timeoutMs - SETTLE_MS);
            const env = { ...baseEnv, RWT_J8_DELETE_UID: uid, RWT_J8_DELETE_EMAIL: email, RWT_J8_DELETE_DEADLINE_AT: String(clock() + processTimeout) };
            for (const [k, name] of Object.entries(BINDING_ENV)) env[name] = binding[k];
            let r;
            try { r = await run(path.join(repoRoot, 'node_modules', '.bin', 'tsx'), [path.join(repoRoot, DELETE_SCRIPT)], { env, cwd: repoRoot, timeout: processTimeout }); }
            catch { r = null; }
            const drained = r?.drained === true;
            const verdicts = String(r?.stdout ?? '').split('\n').filter((l) => l.startsWith('RUN_OWNED_CLEANUP '));
            return { deleted: drained && r?.timedOut !== true && r?.status === 0 && verdicts.length === 1 && DELETE_VERDICT.test(verdicts[0]), drained };
        };
    }
    return adapters;
}

module.exports = {
    CLOSE_GRACE_MS, DELETE_SCRIPT, DELETE_TIMEOUT_MS, DRAIN_TIMEOUT_MS, PROC_TAG_ENV, SETTLE_MS, drainTagged, taggedPids, J8_DESCRIBE, J8_TEST, SPEC_GREP, LIST_TIMEOUT_MS, listsOnlyJ8, SPEC, LIVE_CONFIG, LIVE_PROJECT, INGESTION_WAIT_MS, RETRY_WAIT_MS, ATTEMPTS, READBACK_TIMEOUT_MS, SPEC_TIMEOUT_MS, LOOKUP_TIMEOUT_MS, EVIDENCE_PREFIX,
    boundCoachingReceipt, j8LiveAdapters, readbackEvidence, spawnRunner,
};
