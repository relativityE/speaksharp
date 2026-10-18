// #1593 campaign helper — App Dev's READ-ONLY integration adapter for the Browser PM's decision table
// (`../1593-bootstrap/contract.mjs`, vendored byte-identical from ecd2c048, blob fe5b6c79).
//
// It gathers the facts `assess()` needs from their real sources, asks `assess()` for GO/HOLD, and PRINTS the exact
// dispatch command for the case. It never dispatches, writes, deletes, claims, cleans up or creates a receipt.
//
// Correction 2 (Sam 1792317800; CLI Dev cross-check 2026-10-18):
//  §1 rows are judged by the repository's own finalizer at S (evaluate.mts → automatedEvaluation), never by labels written
//     here; the identity rows a case must PASS are the identity steps in that suite's OWN inventory.
//  §2 the exact run-attempt artifact `rwt-receipts-attempt-<n>` and `<suite>.readback-verdicts.json` are consumed; a suite
//     that declares readback needs its qualified verdicts, a bridge suite needs explicit, validated N/A.
//  §3 run / workflow / head / branch / event / attempt / job / spec / grep / artifact identity is observed and checked; the
//     receipt, its log line and the numeric cleanup line come from the SAME attempt; nothing is stamped from authority.
//  §4 privacy, identity, unknown provider cost, missing readback, outage and effect stops are DOMINANT: they set
//     `dominantStop`, which no `continuationApproved` can override in the contract.
//  §5 the ledger is verified, never asserted: required fields are required (no empty defaults), every rc-gates run since
//     the authority window opened is accounted for (paginated), active runs of any age are busy, bootstrap reconciliation
//     is read from the actual earlier runs on S, dependency identity is checked, and `now` is taken after collection.
//
// Usage (read-only):
//   node local-packets/1593-campaign-helper/collect.mjs --case <1..15> --authority <authority.json> --ledger <ledger.json> \
//        [--first-dispatch]   (case 1 only: the operator's explicit statement that this is the campaign's first dispatch)
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assess, CASE_MAXIMA } from '../1593-bootstrap/contract.mjs';

export const REPO = 'relativityE/speaksharp';
export const BASE_URL = 'https://speaksharp-public.vercel.app';
export const WORKFLOW_PATH = '.github/workflows/rc-gates.yml';
export const GATE3_JOB = 'Gate 3 - DAST / Running App';
export const WRITES_ACK = 'RWT-DISPOSABLE-ACCOUNT-WRITES';
export const CANARY_ACK = 'RWT-CANARY-CLAIM-RUN-OWNED';
export const REFLEX_MS = 500;
export const FRESHNESS_MS = 5 * 60_000;
/** The vendored reference contract's blob (ecd2c048). A different contract is a different decision table. */
export const CONTRACT_BLOB = 'fe5b6c79';
/** Files whose exact bytes at S define the effective run configuration (bound into configDigest). */
export const CONFIG_FILES = Object.freeze(['.github/workflows/rc-gates.yml', 'playwright.deployed-live.config.ts']);
/** Trees the evaluator and the specs execute; their ids at S are bound into configDigest and the local checkout must equal S. */
export const EVALUATED_TREES = Object.freeze(['tests/live/helpers', 'frontend/src/services/telemetry']);
/** The run-owned cleanup implementation; its blob at the run's head IS the cleanup scope (what "this run only" deletes). */
export const CLEANUP_SOURCE = 'tests/live/helpers/runOwnedCleanup.ts';
export const PRODUCTION_WORKFLOWS = Object.freeze(['deploy-supabase-edge-release.yml', 'canary.yml', 'apply-exact-allowlisted-migration.yml', 'deploy-supabase-migrations.yml']);
const ACTIVE_STATUSES = Object.freeze(['queued', 'in_progress', 'waiting', 'requested', 'pending']);

/**
 * The 15 selected cases. `suite` is the receipt's own suite id; `readback` says whether the suite DECLARES journey
 * readback (its inventory requires the received-telemetry row, so the workflow writes verdicts) or is a bridge (the
 * workflow writes none: rc-gates.yml "no declared stages (bridge)"). Both are cross-checked against the source in tests.
 */
export const CASES = Object.freeze([
    { n: 1, spec: 'tests/live/rwt-open-mic-first-session.live.spec.ts', grep: 'a new person completes a first Open Mic session', suite: 'open-mic-first-session', readback: 'declared' },
    { n: 2, spec: 'tests/live/rwt-focus-points-session.live.spec.ts', grep: 'PO corpus', suite: 'focus-points-session', readback: 'declared' },
    { n: 3, spec: 'tests/live/rwt-focus-points-partial.live.spec.ts', grep: 'partial fixture', suite: 'focus-points-partial', readback: 'declared' },
    { n: 4, spec: 'tests/live/rwt-pending-start-navigation.live.spec.ts', grep: 'leaving during a cold Start', suite: 'pending-start-navigation', readback: 'bridge' },
    { n: 5, spec: 'tests/live/rwt-save-retry-recovery.live.spec.ts', grep: 'request lost', suite: 'save-retry-recovery-request-lost', readback: 'bridge' },
    { n: 6, spec: 'tests/live/rwt-save-retry-recovery.live.spec.ts', grep: 'response lost', suite: 'save-retry-recovery-response-lost', readback: 'bridge' },
    { n: 7, spec: 'tests/live/rwt-feedback-association-boundaries.live.spec.ts', grep: 'feedback selected for an older take', suite: 'feedback-association-boundaries-older-take', readback: 'declared' },
    { n: 8, spec: 'tests/live/rwt-feedback-association-boundaries.live.spec.ts', grep: 'No session feedback', suite: 'feedback-association-boundaries-no-session', readback: 'declared' },
    { n: 9, spec: 'tests/live/rwt-abandon-and-two-tabs.live.spec.ts', grep: 'navigate away mid-recording', suite: 'abandon-and-two-tabs-navigate-away', readback: 'bridge' },
    { n: 10, spec: 'tests/live/rwt-abandon-and-two-tabs.live.spec.ts', grep: 'close the tab mid-recording', suite: 'abandon-and-two-tabs-close-tab', readback: 'bridge' },
    { n: 11, spec: 'tests/live/rwt-abandon-and-two-tabs.live.spec.ts', grep: 'one account, two places', suite: 'abandon-and-two-tabs-take-over', readback: 'bridge' },
    { n: 12, spec: 'tests/live/rwt-adverse-mic-model.live.spec.ts', grep: 'mic denied', suite: 'adverse-mic-model-mic-denied', readback: 'bridge' },
    { n: 13, spec: 'tests/live/rwt-adverse-mic-model.live.spec.ts', grep: 'model download fails', suite: 'adverse-mic-model-download-fails', readback: 'bridge' },
    { n: 14, spec: 'tests/live/rwt-adverse-mic-model.live.spec.ts', grep: 'offline mid-download', suite: 'adverse-mic-model-offline-mid-download', readback: 'bridge' },
    { n: 15, spec: 'tests/live/rwt-products-navigation.live.spec.ts', grep: 'an existing user signs in', suite: 'returning-user-navigation', readback: 'bridge' },
].map((c) => Object.freeze({ ...c, maximum: CASE_MAXIMA[c.n - 1], readOnly: c.n === 15 })));

export const caseFor = (n) => CASES.find((c) => c.n === n) ?? null;

/** The acknowledgements a case is dispatched with. Case 15 is the maintained read-only account: BOTH absent (''). */
export function invocationFor(n) {
    const c = caseFor(n);
    if (!c) return null;
    return c.readOnly ? { writesAck: '', canaryAck: '' } : { writesAck: WRITES_ACK, canaryAck: CANARY_ACK };
}

/** The exact dispatch, as an argv array. PRINTED for the operator; this module never executes it. */
export function dispatchArgv(n) {
    const c = caseFor(n);
    const inv = invocationFor(n);
    if (!c || !inv) return null;
    const argv = ['gh', 'workflow', 'run', 'rc-gates.yml', '--repo', REPO, '--ref', 'main',
        '-f', 'gate=gate-3-dast', '-f', `base_url=${BASE_URL}`,
        '-f', `diagnostic_dast_spec=${c.spec}`, '-f', `diagnostic_dast_grep=${c.grep}`,
        '-f', 'comparison_cell=none', '-f', `rwt_human_reflex_ms=${REFLEX_MS}`];
    if (inv.writesAck) argv.push('-f', `rwt_writes_ack=${inv.writesAck}`);
    if (inv.canaryAck) argv.push('-f', `rwt_canary_claim_ack=${inv.canaryAck}`);
    return argv;
}

/** Workers/retries are bound by the live Playwright config itself; both must be exactly 1 / 0 at S. */
export function bindingsFromPlaywrightConfig(source) {
    const workers = Number(/\bworkers:\s*(\d+)\s*,/.exec(source ?? '')?.[1]);
    const retries = Number(/\bretries:\s*(\d+)\s*,/.exec(source ?? '')?.[1]);
    const parallel = /\bfullyParallel:\s*false\b/.test(source ?? '');
    return { workers, retries, fullyParallelFalse: parallel, ok: workers === 1 && retries === 0 && parallel };
}

export const sha256 = (s) => createHash('sha256').update(s).digest('hex');

/** The effective-configuration record at a SHA and its digest: exact config/spec blobs, evaluated trees, bindings. */
export function configRecord({ releaseSha, blobs, bindings }) {
    const record = { releaseSha, baseUrl: BASE_URL, reflexMs: REFLEX_MS, gate: 'gate-3-dast',
        workers: bindings.workers, retries: bindings.retries,
        blobs: Object.fromEntries(Object.entries(blobs).sort(([a], [b]) => a.localeCompare(b))) };
    return { record, digest: sha256(JSON.stringify(record)) };
}

/** The cleanup scope a run executed: the cleanup implementation's blob at that run's head. */
export const cleanupScopeDigest = (cleanupBlob) => sha256(`run_owned_cleanup:${CLEANUP_SOURCE}:${cleanupBlob}`);

/** Activity from a COMPLETE list of active runs: any entry is busy; an unreadable list is unknown. */
export function classifyActivity(runs) {
    if (!Array.isArray(runs)) return 'unknown';
    return runs.some((r) => r?.status !== 'completed') ? 'busy' : 'idle';
}

/** Identity steps a suite may carry. Which of them a suite REQUIRES is read from that suite's own inventory. */
export const IDENTITY_STEPS = Object.freeze(['signup', 'sign-in', 'session bears canary claim', 'run-owned signup',
    'canary claim in fresh login', 'returning-user sign-in', 'returning account state']);
/** Rows whose non-PASS is a stop no continuation can override (privacy, telemetry integrity, provider cost, effects). */
export const DOMINANT_STEPS = Object.freeze(['receipt content-free', 'telemetry decodable', 'coaching request budget',
    'run-owned cleanup', 'no Cloud STT request', 'navigation writes nothing', 'no mic on navigation']);
const RECEIVED_ROW = 'journey telemetry received';
const BUDGET_ROW = 'coaching request budget';

/** Lines GitHub prints for STEP OUTPUT start with the timestamp; the step's own script text never matches (it is `echo …`). */
const out = (pattern) => new RegExp(`^\\d{4}-\\d{2}-\\d{2}T[\\d:.]+Z ${pattern}$`);
const SPEC_LINE = out('spec=(\\S+) grep=(.*)');
const RECEIPT_LINE = out('RWT_RECEIPT (\\{.*\\})');
const CLEANUP_LINE = out('RUN_OWNED_CLEANUP (cleanup_verified|cleanup_not_required) residue=(\\d+) tables_verified=(\\d+)');
const ANY_CLEANUP = out('RUN_OWNED_CLEANUP .*');

/** Parse one Gate 3 job log: the observed spec/grep, the receipt line and the cleanup lines. Nothing else is trusted. */
export function parseGateLog(log) {
    const lines = String(log ?? '').split('\n').map((l) => l.replace(/\r$/, '').replace(/\x1b\[[0-9;]*[A-Za-z]/g, ''));
    const specs = lines.map((l) => SPEC_LINE.exec(l)).filter(Boolean).map((m) => ({ spec: m[1], grep: m[2] }));
    const receipts = lines.map((l) => RECEIPT_LINE.exec(l)).filter(Boolean).map((m) => m[1]);
    const cleanups = lines.map((l) => CLEANUP_LINE.exec(l)).filter(Boolean)
        .map((m) => ({ verdict: m[1], residue: Number(m[2]), tablesVerified: Number(m[3]) }));
    const unparsedCleanup = lines.filter((l) => ANY_CLEANUP.test(l)).length - cleanups.length;
    return { specs, receipts, cleanups, unparsedCleanup };
}

/**
 * The run-owned cleanup a case proved, from its own job log: exactly one `cleanup_verified` line, FIRST, with a positive
 * table count. A later `cleanup_not_required` (the afterEach after an in-body cleanup) is allowed. Residue is the
 * numeric value printed, or null — never a default.
 */
export function cleanupFromLog(parsedLog) {
    const verified = parsedLog.cleanups.filter((c) => c.verdict === 'cleanup_verified');
    const firstVerified = parsedLog.cleanups.findIndex((c) => c.verdict === 'cleanup_verified');
    const ok = parsedLog.unparsedCleanup === 0 && verified.length === 1 && firstVerified === 0
        && Number.isSafeInteger(verified[0].tablesVerified) && verified[0].tablesVerified > 0;
    return { ok, residue: verified.length === 1 ? verified[0].residue : null, lines: parsedLog.cleanups.length };
}

/**
 * Verify ONE case's actual run attempt and produce its ledger entry. Pure: every input is an observation the I/O layer
 * read, `evaluation` is the repository finalizer at S on the artifact's receipt (and readback), and `inventory` is the
 * suite's own required rows at S. Every failed check is named in `errors`; any error, and any dominant row, sets
 * `dominantStop` — never a softer outcome.
 */
export function verifyCaseRun({ caseNumber, runId, runAttempt, ledgerCampaignId, reviewed, continuationApproved,
    attempt, jobs, log, artifacts, files, evaluation, inventory, observedConfigDigest, observedCleanupScope, window }) {
    const c = caseFor(caseNumber);
    if (!c) return { entry: null, errors: ['case_out_of_range'] };
    const errors = [];
    const fail = (why) => { errors.push(why); };

    // §3 — the attempt is the dispatch this case names: rc-gates on main, workflow_dispatch, completed, this attempt.
    if (!attempt || typeof attempt !== 'object') fail('attempt_unreadable');
    else {
        if (String(attempt.id) !== String(runId)) fail('attempt_run_id_mismatch');
        if (attempt.run_attempt !== runAttempt) fail('attempt_number_mismatch');
        if (attempt.path !== WORKFLOW_PATH) fail('workflow_path_mismatch');
        if (attempt.head_branch !== 'main' || attempt.event !== 'workflow_dispatch') fail('not_a_main_workflow_dispatch');
        if (!/^[0-9a-f]{40}$/.test(String(attempt.head_sha))) fail('head_sha_unreadable');
        const started = Date.parse(attempt.run_started_at ?? '');
        if (!Number.isFinite(started) || !window || started < window.validFrom || started > window.validUntil) fail('attempt_outside_authority_window');
    }
    const gate3 = Array.isArray(jobs) ? jobs.filter((j) => j?.name === GATE3_JOB) : [];
    if (gate3.length !== 1) fail('not_exactly_one_gate3_job');

    const parsedLog = parseGateLog(log);
    if (parsedLog.specs.length !== 1) fail('not_exactly_one_observed_spec_line');
    else if (parsedLog.specs[0].spec !== c.spec || parsedLog.specs[0].grep !== c.grep) fail('observed_spec_or_grep_is_not_this_case');
    if (parsedLog.receipts.length !== 1) fail('not_exactly_one_receipt_line');

    // §2 — the exact attempt's artifact, the case suite's single receipt, and readback per the suite's declaration.
    const expectedArtifact = `rwt-receipts-attempt-${runAttempt}`;
    const named = Array.isArray(artifacts) ? artifacts.filter((a) => a?.name === expectedArtifact) : [];
    if (named.length !== 1) fail('not_exactly_one_attempt_artifact');
    else if (named[0].expired !== false) fail('attempt_artifact_expired_or_unknown');
    const receiptFiles = Array.isArray(files?.receipts) ? files.receipts : [];
    const readbackFiles = Array.isArray(files?.readbacks) ? files.readbacks : [];
    if (receiptFiles.length !== 1 || receiptFiles[0].name !== `${c.suite}.receipt.json`) fail('artifact_receipt_is_not_exactly_this_suite');
    const parse = (text) => { try { return JSON.parse(text); } catch { return null; } };
    const receiptBody = receiptFiles.length === 1 ? parse(receiptFiles[0].text) : null;
    const logBody = parsedLog.receipts.length === 1 ? parse(parsedLog.receipts[0]) : null;
    if (!receiptBody || !logBody || JSON.stringify(receiptBody) !== JSON.stringify(logBody)) fail('artifact_receipt_differs_from_job_log_receipt');
    const bindings = receiptBody?.readback;
    const bound = Array.isArray(bindings?.journeys) ? bindings.journeys.length : null;
    const missing = Array.isArray(bindings?.missingBindings) ? bindings.missingBindings.length : 0;
    let readbackState;
    if (c.readback === 'declared') {
        if (readbackFiles.length !== 1 || readbackFiles[0].name !== `${c.suite}.readback-verdicts.json`) fail('declared_readback_verdicts_missing_or_ambiguous');
        if (!bound) fail('declared_readback_has_no_bound_journey');
        readbackState = 'declared';
    } else {
        // Bridge: the source declares no readback, so the workflow writes none. N/A is VALIDATED, never assumed.
        if (readbackFiles.length !== 0) fail('bridge_suite_has_unexpected_readback_verdicts');
        if (bound !== 0 || missing !== 0) fail('bridge_suite_declares_readback_bindings');
        readbackState = 'not_applicable_source_defined';
    }

    // §1 — the repository finalizer at S judges the receipt (and the readback it settles).
    if (!evaluation || !Array.isArray(evaluation.errors) || !Array.isArray(evaluation.rows)) fail('finalizer_evaluation_unavailable');
    else {
        for (const e of evaluation.errors) fail(`finalizer: ${e}`);
        if (evaluation.suite !== c.suite) fail('finalizer_suite_is_not_this_case');
        if (!attempt || evaluation.release !== attempt.head_sha) fail('receipt_release_is_not_the_run_head');
    }
    const rows = Array.isArray(evaluation?.rows) ? evaluation.rows : [];
    const verdictOf = (step) => { const hits = rows.filter((r) => r.step === step); return hits.length === 1 ? hits[0].verdict : null; };
    if (!inventory || !Array.isArray(inventory.product) || !Array.isArray(inventory.required)) fail('suite_inventory_unavailable');
    const inventorySteps = new Set([...(inventory?.required ?? []), ...(inventory?.product ?? [])]);
    const identity = IDENTITY_STEPS.filter((s) => inventorySteps.has(s));
    if (identity.length === 0) fail('suite_inventory_names_no_identity_row');

    // §4 — dominant stops. continuationApproved never reaches these.
    const dominant = [];
    for (const step of identity) if (verdictOf(step) !== 'PASS') dominant.push(`identity:${step}`);
    for (const step of DOMINANT_STEPS) {
        const present = rows.some((r) => r.step === step);
        if (present ? verdictOf(step) !== 'PASS' : inventorySteps.has(step)) dominant.push(`stop:${step}`);
    }
    if (rows.some((r) => r.verdict === 'EXTERNAL')) dominant.push('stop:provider_outage');
    if (c.readback === 'declared' && verdictOf(RECEIVED_ROW) !== 'PASS') dominant.push('stop:readback_not_qualified');
    const budget = rows.filter((r) => r.step === BUDGET_ROW);
    const requests = budget.length === 1 && budget[0].verdict === 'PASS' && Number.isSafeInteger(budget[0].browserRequests)
        && budget[0].browserRequests >= 0 ? budget[0].browserRequests : null;
    if (requests === null) dominant.push('stop:unknown_or_unanswered_provider_cost');

    // Cleanup: run-owned cases need exactly one verified zero-residue line in THIS job; the read-only case needs none.
    const cleanup = cleanupFromLog(parsedLog);
    if (c.readOnly) { if (cleanup.lines !== 0 || parsedLog.unparsedCleanup !== 0) fail('read_only_case_logged_a_cleanup'); }
    else if (!cleanup.ok) fail('cleanup_line_missing_ambiguous_or_unverified');

    const verdicts = rows.map((r) => r.verdict);
    const outcome = rows.length === 0 ? null : verdicts.includes('FAIL') ? 'FAIL' : verdicts.every((v) => v === 'PASS') ? 'PASS' : 'HOLD';
    const releaseSha = attempt?.head_sha ?? null;
    const runIdText = String(runId);
    const entry = {
        caseNumber, runId: runIdText, runAttempt, campaignId: ledgerCampaignId, releaseSha, configDigest: observedConfigDigest ?? null,
        receiptDigest: receiptFiles.length === 1 ? sha256(receiptFiles[0].text) : null,
        terminal: attempt?.status === 'completed',
        reviewed: reviewed === true,
        mandatoryReadbackComplete: errors.length === 0 && (c.readback === 'declared' ? verdictOf(RECEIVED_ROW) === 'PASS' : readbackState === 'not_applicable_source_defined'),
        dominantStop: errors.length > 0 || dominant.length > 0,
        outcome, continuationApproved: continuationApproved === true, requests,
        cleanup: c.readOnly ? null : {
            kind: 'run_owned_cleanup', verified: cleanup.ok, residue: cleanup.residue, ownerScope: cleanup.ok ? 'this_run_only' : null,
            scopeDigest: observedCleanupScope ?? null, runId: runIdText, runAttempt, campaignId: ledgerCampaignId, releaseSha,
        },
        readback: readbackState, identityRows: identity, dominantReasons: dominant,
    };
    return { entry, errors };
}

/**
 * §5 — the operator ledger file is INPUT, never trusted: every field is required (no defaults), entries are in case
 * order, and every rc-gates run attempt since the authority window opened is an entry or explicitly in flight — or the
 * ledger is unverified. `verified` is computed here; a file that asserts it is refused.
 */
export function verifyLedger({ ledgerFile, authority, verifiedEntries, windowRuns }) {
    const reasons = [];
    const f = ledgerFile;
    if (!f || typeof f !== 'object' || Array.isArray(f)) return { verified: false, reasons: ['ledger_not_an_object'] };
    if (typeof f.campaignId !== 'string' || f.campaignId !== authority?.campaignId) reasons.push('ledger_campaign_mismatch');
    for (const k of ['entries', 'inFlight', 'unresolvedCleanup']) if (!Array.isArray(f[k])) reasons.push(`ledger_${k}_missing`);
    if ('verified' in f) reasons.push('ledger_file_must_not_assert_verified');
    const entries = Array.isArray(f.entries) ? f.entries : [];
    const inFlight = Array.isArray(f.inFlight) ? f.inFlight : [];
    entries.forEach((e, i) => {
        if (!e || e.caseNumber !== i + 1 || !/^\d+$/.test(String(e.runId ?? '')) || !Number.isSafeInteger(e.runAttempt)
            || typeof e.reviewed !== 'boolean' || typeof e.continuationApproved !== 'boolean') reasons.push(`ledger_entry_${i + 1}_incomplete`);
    });
    if (!Array.isArray(verifiedEntries) || verifiedEntries.length !== entries.length || verifiedEntries.some((e) => !e)) reasons.push('ledger_entries_not_all_collected');
    if (!Array.isArray(windowRuns)) reasons.push('campaign_window_runs_unreadable');
    else {
        const key = (id, attempt) => `${id}/${attempt}`;
        const listed = new Set([...entries.map((e) => key(e.runId, e.runAttempt)), ...inFlight.map((r) => key(r?.runId, r?.runAttempt))]);
        for (const r of windowRuns) if (!listed.has(key(r.id, r.run_attempt))) reasons.push(`unaccounted_rc_gates_run_${r.id}_attempt_${r.run_attempt}`);
        const seen = new Set(windowRuns.map((r) => key(r.id, r.run_attempt)));
        for (const e of entries) if (!seen.has(key(e.runId, e.runAttempt))) reasons.push(`ledger_entry_run_${e.runId}_not_in_campaign_window`);
    }
    return { verified: reasons.length === 0, reasons };
}

/**
 * Case 1's campaign-start preflight, every flag from evidence: the operator's explicit first-dispatch statement, no
 * rc-gates run since the window opened, and every earlier RWT run on S reconciled to a verified zero-residue cleanup
 * (or the read-only case). Never a cleanup receipt and never an invented predecessor. Unreadable sources → not verified.
 */
export function campaignStartPreflight({ authority, explicitFirstDispatch, windowRuns, priorRuns }) {
    const readable = Array.isArray(windowRuns) && Array.isArray(priorRuns);
    return { kind: 'campaign_start_preflight', verified: readable, campaignId: authority.campaignId,
        releaseSha: authority.releaseSha, configDigest: authority.configDigest, previousReceipt: null,
        explicitFirstDispatch: explicitFirstDispatch === true,
        noEarlierAttempt: readable && windowRuns.length === 0,
        priorCampaignCleanupReconciled: readable && priorRuns.every((p) => p && (p.readOnly === true || (p.cleanupOk === true && p.residue === 0))) };
}

/** Freshness is judged at the DECISION, after collection: the observation window starts when observation began. */
export function observationAt({ startedAt, mainSha, servedSha, configDigest, bindingsOk, dependencyIdentical, activity }) {
    return { verified: bindingsOk === true && dependencyIdentical === true, observedAt: startedAt, validUntil: startedAt + FRESHNESS_MS,
        mainSha, servedSha, workflowSha: mainSha /* --ref main runs main's workflow at dispatch */, configDigest,
        main: activity.main, rcGates: activity.rcGates, production: activity.production };
}

// ── I/O (read-only) ────────────────────────────────────────────────────────────────────────────────────────────────
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 256 * 1024 * 1024, ...opts });
const ghApi = (route, params = {}, { paginate = false, jq = null } = {}) => run('gh', ['api', '--method', 'GET', ...(paginate ? ['--paginate'] : []), route,
    ...Object.entries(params).flatMap(([k, v]) => ['-f', `${k}=${v}`]), ...(jq ? ['--jq', jq] : [])]);
/** Paginated list: one JSON item per line via jq, so every page is read and concatenated without guessing. */
const ghList = (route, params, key) => ghApi(route, { per_page: '100', ...params }, { paginate: true, jq: `.${key}[] | @json` })
    .split('\n').filter(Boolean).map((l) => JSON.parse(l));

const TSX = process.env.TSX_BIN || path.join(ROOT, 'node_modules/.bin/tsx');
/** The repository finalizer at this checkout (evaluate.mts). null when it cannot run — the case then holds. */
export function evaluateWithFinalizer(receiptFile, readbackFile) {
    const args = [path.join(HERE, 'evaluate.mts'), '--receipt', receiptFile, ...(readbackFile ? ['--readback', readbackFile] : [])];
    try { return JSON.parse(run(TSX, args, { cwd: ROOT })); } catch { return null; }
}
/** The suite's own inventory and required human observations at this checkout (null when unavailable). */
export function suiteFacts(suite) {
    try { return JSON.parse(run(TSX, [path.join(HERE, 'evaluate.mts'), '--inventory', suite], { cwd: ROOT })); } catch { return null; }
}
export const inventoryFor = (suite) => suiteFacts(suite)?.inventory ?? null;

export async function servedSha() {
    const html = await (await fetch(`${BASE_URL}/`)).text();
    const found = new Set();
    for (const js of new Set(html.match(/\/assets\/[^"]+\.js/g) ?? [])) {
        const body = await (await fetch(`${BASE_URL}${js}`)).text();
        for (const m of body.matchAll(/VITE_VERCEL_GIT_COMMIT_SHA:"([0-9a-f]{40})"/g)) found.add(m[1]);
    }
    return found.size === 1 ? [...found][0] : null;
}

const blobAt = (sha, p) => ghApi(`repos/${REPO}/contents/${p}`, { ref: sha }, { jq: '.sha' }).trim();
const treeAt = (sha, p) => run('git', ['rev-parse', `${sha}:${p}`], { cwd: ROOT }).trim();
const rawAt = (sha, p) => run('gh', ['api', '--method', 'GET', `repos/${REPO}/contents/${p}`, '-f', `ref=${sha}`, '-H', 'Accept: application/vnd.github.raw']);

/** Config digest and cleanup scope AT a SHA, from that SHA's own blobs (observed, never copied from authority). */
export function configAt(sha) {
    const bindings = bindingsFromPlaywrightConfig(rawAt(sha, 'playwright.deployed-live.config.ts'));
    const blobs = Object.fromEntries([...CONFIG_FILES, ...new Set(CASES.map((c) => c.spec))].map((p) => [p, blobAt(sha, p)]));
    for (const t of EVALUATED_TREES) blobs[`${t}/`] = treeAt(sha, t);
    return { bindings, config: configRecord({ releaseSha: sha, blobs, bindings }), cleanupScope: cleanupScopeDigest(blobAt(sha, CLEANUP_SOURCE)) };
}

/** The local checkout must execute exactly S's evaluator dependencies, and the vendored contract must be the reviewed one. */
export function dependencyIdentity(releaseSha) {
    try {
        run('git', ['diff', '--quiet', releaseSha, '--', ...EVALUATED_TREES], { cwd: ROOT });
        return run('git', ['hash-object', path.join(HERE, '../1593-bootstrap/contract.mjs')]).trim().startsWith(CONTRACT_BLOB);
    } catch { return false; }
}

/** Complete active-run lists (every page, every active status, any age): main, rc-gates, production workflows. */
export function activity() {
    const active = (route, params = {}) => ACTIVE_STATUSES.flatMap((status) => ghList(route, { ...params, status }, 'workflow_runs'));
    const safe = (fn) => { try { return classifyActivity(fn()); } catch { return 'unknown'; } };
    return {
        main: safe(() => active(`repos/${REPO}/actions/runs`, { branch: 'main' })),
        rcGates: safe(() => active(`repos/${REPO}/actions/workflows/rc-gates.yml/runs`)),
        production: safe(() => PRODUCTION_WORKFLOWS.flatMap((w) => active(`repos/${REPO}/actions/workflows/${w}/runs`))),
    };
}

/** Every rc-gates run ATTEMPT created since the authority window opened (paginated; every attempt of each run). */
export function campaignWindowRuns(validFrom) {
    const runs = ghList(`repos/${REPO}/actions/workflows/rc-gates.yml/runs`, { created: `>=${new Date(validFrom).toISOString()}` }, 'workflow_runs');
    return runs.flatMap((r) => Array.from({ length: r.run_attempt }, (_, i) => ({ id: r.id, run_attempt: i + 1 })));
}

/** Read one attempt's facts: attempt metadata, jobs, Gate 3 log, artifacts, and the downloaded receipt/readback files. */
export function readAttempt(runId, runAttempt) {
    const attempt = JSON.parse(ghApi(`repos/${REPO}/actions/runs/${runId}/attempts/${runAttempt}`));
    const jobs = ghList(`repos/${REPO}/actions/runs/${runId}/attempts/${runAttempt}/jobs`, {}, 'jobs');
    const gate3 = jobs.filter((j) => j.name === GATE3_JOB);
    const log = gate3.length === 1 ? run('gh', ['api', `repos/${REPO}/actions/jobs/${gate3[0].id}/logs`]) : '';
    const artifacts = ghList(`repos/${REPO}/actions/runs/${runId}/artifacts`, {}, 'artifacts');
    const dir = mkdtempSync(path.join(tmpdir(), 'rwt-case-'));
    const files = { receipts: [], readbacks: [], dir };
    const name = `rwt-receipts-attempt-${runAttempt}`;
    if (artifacts.filter((a) => a.name === name && a.expired === false).length === 1) {
        run('gh', ['run', 'download', String(runId), '--repo', REPO, '-n', name, '-D', dir]);
        for (const f of readdirSync(dir)) {
            const entry = () => ({ name: f, text: readFileSync(path.join(dir, f), 'utf8'), file: path.join(dir, f) });
            if (f.endsWith('.receipt.json')) files.receipts.push(entry());
            if (f.endsWith('.readback-verdicts.json')) files.readbacks.push(entry());
        }
    }
    return { attempt, jobs, log, artifacts, files };
}

/** Earlier rc-gates runs on S, before the window: each must be non-RWT, the read-only case, or a verified zero-residue cleanup. */
export function priorRunsOnRelease(releaseSha, validFrom) {
    const runs = ghList(`repos/${REPO}/actions/workflows/rc-gates.yml/runs`, { head_sha: releaseSha }, 'workflow_runs')
        .filter((r) => Date.parse(r.created_at) < validFrom);
    return runs.map((r) => {
        const jobs = ghList(`repos/${REPO}/actions/runs/${r.id}/attempts/${r.run_attempt}/jobs`, {}, 'jobs').filter((j) => j.name === GATE3_JOB);
        const parsed = parseGateLog(jobs.length === 1 ? run('gh', ['api', `repos/${REPO}/actions/jobs/${jobs[0].id}/logs`]) : '');
        const spec = parsed.specs.length === 1 ? parsed.specs[0].spec : null;
        const rwt = typeof spec === 'string' && spec.startsWith('tests/live/rwt-');
        const cleanup = cleanupFromLog(parsed);
        return { runId: String(r.id), rwt, readOnly: !rwt || spec === caseFor(15).spec, cleanupOk: cleanup.ok, residue: cleanup.residue };
    });
}

// ── CLI ────────────────────────────────────────────────────────────────────────────────────────────────────────────
export async function main(argv = process.argv.slice(2)) {
    const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
    const n = Number(arg('--case'));
    const authority = JSON.parse(readFileSync(arg('--authority'), 'utf8'));
    const ledgerFile = JSON.parse(readFileSync(arg('--ledger'), 'utf8'));
    const startedAt = Date.now();
    const window = { validFrom: authority.validFrom, validUntil: authority.validUntil };

    const mainSha = run('git', ['ls-remote', `https://github.com/${REPO}.git`, 'refs/heads/main']).split('\t')[0];
    const atMain = configAt(mainSha);
    const served = await servedSha();
    const act = activity();
    const configCache = new Map([[mainSha, atMain]]);
    const atSha = (sha) => { if (!configCache.has(sha)) configCache.set(sha, configAt(sha)); return configCache.get(sha); };

    const verified = [];
    const caseErrors = {};
    for (const e of Array.isArray(ledgerFile.entries) ? ledgerFile.entries : []) {
        const c = caseFor(e?.caseNumber);
        let result = { entry: null, errors: ['ledger_entry_unreadable'] };
        try {
            const read = readAttempt(e.runId, e.runAttempt);
            const receipt = read.files.receipts.length === 1 ? read.files.receipts[0].file : null;
            const readback = read.files.readbacks.length === 1 ? read.files.readbacks[0].file : null;
            const at = /^[0-9a-f]{40}$/.test(String(read.attempt?.head_sha)) ? atSha(read.attempt.head_sha) : null;
            result = verifyCaseRun({ caseNumber: e.caseNumber, runId: e.runId, runAttempt: e.runAttempt,
                ledgerCampaignId: ledgerFile.campaignId, reviewed: e.reviewed, continuationApproved: e.continuationApproved,
                attempt: read.attempt, jobs: read.jobs, log: read.log, artifacts: read.artifacts, files: read.files,
                evaluation: receipt ? evaluateWithFinalizer(receipt, c?.readback === 'declared' ? readback : null) : null,
                inventory: c ? inventoryFor(c.suite) : null, observedConfigDigest: at?.config.digest, observedCleanupScope: at?.cleanupScope, window });
            rmSync(read.files.dir, { recursive: true, force: true });
        } catch { /* an unreadable attempt stays an error: the entry is missing and the ledger cannot verify */ }
        verified.push(result.entry);
        if (result.errors.length) caseErrors[e?.caseNumber] = result.errors;
    }
    const windowRuns = (() => { try { return campaignWindowRuns(authority.validFrom); } catch { return null; } })();
    const ledgerCheck = verifyLedger({ ledgerFile, authority, verifiedEntries: verified, windowRuns });
    const ledger = { verified: ledgerCheck.verified, campaignId: ledgerFile.campaignId, entries: verified,
        inFlight: ledgerFile.inFlight, unresolvedCleanup: ledgerFile.unresolvedCleanup };
    const bootstrap = n === 1 ? campaignStartPreflight({ authority, explicitFirstDispatch: argv.includes('--first-dispatch'), windowRuns,
        priorRuns: (() => { try { return priorRunsOnRelease(authority.releaseSha, authority.validFrom); } catch { return null; } })() }) : null;
    const observation = observationAt({ startedAt, mainSha, servedSha: served, configDigest: atMain.config.digest,
        bindingsOk: atMain.bindings.ok, dependencyIdentical: dependencyIdentity(authority.releaseSha), activity: act });

    const now = Date.now(); // after every read: an observation or authority that expired during collection holds
    const decision = assess({ caseNumber: n, now, authority, observation, ledger, bootstrap,
        previousReceipt: n === 1 ? null : verified.at(-1) ?? undefined, invocation: invocationFor(n) });
    const report = { case: n, decision, collectionMs: now - startedAt, ledgerReasons: ledgerCheck.reasons, caseErrors,
        dominant: Object.fromEntries(verified.filter((e) => e?.dominantStop).map((e) => [e.caseNumber, e.dominantReasons])),
        observation: { ...observation, bindings: atMain.bindings, configRecord: atMain.config.record },
        dispatch: decision.eligible ? dispatchArgv(n) : null };
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return decision.eligible ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exitCode = await main();
