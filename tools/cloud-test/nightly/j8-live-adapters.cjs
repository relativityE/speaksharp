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
//   lookup    — the parent's complete exact-email lookup through the admin listing (`enumerateUsers` + `exactEmailLookup`), bounded.
// Sam on b1f8323f (4): every process and the lookup is bounded. A process over its deadline is killed (SIGKILL) and is never a
// terminal outcome; a lookup over its deadline is `unreadable`.
// Nothing here opens the J8 live gate: `main` still refuses, and `no-j8-harness-adapter` stays NEVER_SATISFIED until Sam opens it.
// The adapters read no credential themselves: the spec and the readback inherit the parent's environment, and the admin listing
// comes from a client the caller builds. Every malformed input is refused before a process starts (HOLD), never guessed.
const path = require('node:path');
const { enumerateUsers, exactEmailLookup } = require('./account-lookup.cjs');

const SPEC = 'tests/live/rwt-feedback-association-boundaries.live.spec.ts';
const LIVE_CONFIG = 'playwright.deployed-live.config.ts';
const LIVE_PROJECT = 'deployed-live-chromium';
const INGESTION_WAIT_MS = 120_000;
const RETRY_WAIT_MS = 60_000;
const ATTEMPTS = 3;
const READBACK_TIMEOUT_MS = 5 * 60_000;
const SPEC_TIMEOUT_MS = 30 * 60_000;
const LOOKUP_TIMEOUT_MS = 2 * 60_000;
const SHA = /^[a-f0-9]{40}$/;
const ID = /^[A-Za-z0-9._:-]{1,120}$/;
const STAGE = /^[a-z_]{1,40}$/;
const RECEIPT_PREFIX = 'COACHING_DIAGNOSTIC_RECEIPT ';
const EVIDENCE_PREFIX = 'TELEMETRY_READBACK_QUALIFICATION_EVIDENCE ';

/**
 * The process runner: (command, args, { env, cwd, timeout }) -> Promise<{ status, stdout, timedOut }>. A process still running at
 * its deadline is killed with SIGKILL and reported `timedOut` with no status. Proofs inject a runner instead.
 */
function spawnRunner() {
    const { spawn } = require('node:child_process');
    return (command, args, { env, cwd, timeout }) => new Promise((resolve) => {
        let stdout = '';
        let timedOut = false;
        let child;
        try { child = spawn(command, args, { env, cwd, stdio: ['ignore', 'pipe', 'inherit'] }); }
        catch { resolve({ status: null, stdout: '', timedOut: false }); return; }
        const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeout);
        child.stdout.setEncoding('utf8');
        child.stdout.on('data', (d) => { if (stdout.length < 16 * 1024 * 1024) stdout += d; });
        child.on('error', () => { clearTimeout(timer); resolve({ status: null, stdout, timedOut }); });
        child.on('close', (code) => { clearTimeout(timer); resolve({ status: timedOut ? null : (typeof code === 'number' ? code : null), stdout, timedOut }); });
    });
}
const realSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 0 and 3 are final; anything else (including a spawn failure or a kill at the deadline) is retried, then HOLD. */
function finalCode(status) { return status === 0 || status === 3; }

function readbackArgs(release, journeyId) {
    return ['-s', 'telemetry:readback-qualification', '--release-sha', release, '--journey-id', journeyId, '--traffic-type', 'canary'];
}

/**
 * One wait for ingestion before the run's first readback (rc-gates' `sleep 120`), shared by `qualify` and `coaching`, then up to
 * three tries with a wait between them. Returns the last { status, stdout }.
 */
function readbackSession({ run, sleep, repoRoot, baseEnv }) {
    let waited = false;
    return async function readback(release, journeyId, extraEnv) {
        if (!waited) { waited = true; await sleep(INGESTION_WAIT_MS); }
        let last = { status: null, stdout: '' };
        for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
            try { last = await run('pnpm', readbackArgs(release, journeyId), { env: { ...baseEnv, ...extraEnv }, cwd: repoRoot, timeout: READBACK_TIMEOUT_MS }); }
            catch { last = { status: null, stdout: '' }; }
            if (last?.timedOut === true) last = { status: null, stdout: '' };
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
    listUsers = null, lookupTimeoutMs = LOOKUP_TIMEOUT_MS } = {}) {
    const readback = readbackSession({ run, sleep, repoRoot, baseEnv });
    const adapters = {
        /** -> { exitCode, admissionFile, runId, runAttempt, timedOut }: the spec's terminal outcome, naming what it ran with. */
        async runSpec({ env }) {
            if (!env || typeof env !== 'object') return { exitCode: null, timedOut: false };
            let r;
            try {
                r = await run('pnpm', ['exec', 'playwright', 'test', SPEC, `--config=${LIVE_CONFIG}`, `--project=${LIVE_PROJECT}`, '--reporter=line'],
                    { env: { ...baseEnv, VITE_USE_LIVE_DB: 'true', ...env }, cwd: repoRoot, timeout: SPEC_TIMEOUT_MS });
            } catch { r = null; }
            const timedOut = r?.timedOut === true;
            return { exitCode: !timedOut && typeof r?.status === 'number' ? r.status : null, timedOut,
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
    return adapters;
}

module.exports = {
    SPEC, LIVE_CONFIG, LIVE_PROJECT, INGESTION_WAIT_MS, RETRY_WAIT_MS, ATTEMPTS, READBACK_TIMEOUT_MS, SPEC_TIMEOUT_MS, LOOKUP_TIMEOUT_MS, EVIDENCE_PREFIX,
    boundCoachingReceipt, j8LiveAdapters, readbackEvidence, spawnRunner,
};
