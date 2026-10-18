// Run: node --test local-packets/1593-campaign-helper/collect.test.mjs   (no network, no GitHub, no dispatch)
// Needs `tsx` (node_modules/.bin/tsx, or TSX_BIN): fixtures are judged by the REPOSITORY finalizer at this checkout, and
// every fixture row comes from the suite's own inventory (evaluate.mts --inventory) — no row label is invented here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { assess, CASE_MAXIMA } from '../1593-bootstrap/contract.mjs';
import {
    CASES, CANARY_ACK, FRESHNESS_MS, GATE3_JOB, WORKFLOW_PATH, WRITES_ACK, bindingsFromPlaywrightConfig, campaignStartPreflight,
    classifyActivity, cleanupFromLog, configRecord, dispatchArgv, evaluateWithFinalizer, invocationFor, observationAt, parseGateLog,
    suiteFacts, verifyCaseRun, verifyLedger,
} from './collect.mjs';

const S = '18487853bc0d0f117e639fc0477ee6b30a932289';
const OTHER = 'b'.repeat(40);
const D64 = (c) => c.repeat(64);
const NOW = 1_800_000_000_000;
const authority = {
    verified: true, campaignId: 'rwt-campaign-1', releaseSha: S, configDigest: D64('a'), budget: 30, firstCase: 1, lastCase: 15,
    validFrom: NOW - 3_600_000, validUntil: NOW + 3_600_000, allowRunOwnedCreation: true, allowPermanentRunOwnedCleanup: true,
    allowRunOwnedCanaryClaim: true, allowMaintainedReadOnly: true, cleanupScopeDigest: D64('c'),
};
const window = { validFrom: authority.validFrom, validUntil: authority.validUntil };
const activityIdle = { main: 'idle', rcGates: 'idle', production: 'idle' };
const observation = observationAt({ startedAt: NOW - 10, mainSha: S, servedSha: S, configDigest: D64('a'), bindingsOk: true, dependencyIdentical: true, activity: activityIdle });

// ── source-faithful fixtures ───────────────────────────────────────────────────────────────────────────────────────
const facts = new Map(CASES.map((c) => [c.n, suiteFacts(c.suite)]));
const dir = mkdtempSync(path.join(tmpdir(), 'rwt-helper-test-'));
const evalCache = new Map();
/** Judge a receipt (and readback) exactly as the I/O layer does: files on disk → the repository finalizer. */
function judge(name, receiptText, readbackText) {
    const key = `${name}\0${receiptText}\0${readbackText ?? ''}`;
    if (!evalCache.has(key)) {
        const rf = path.join(dir, `${evalCache.size}-${name}`);
        writeFileSync(rf, receiptText);
        let bf = null;
        if (readbackText !== null) { bf = `${rf}.readback.json`; writeFileSync(bf, readbackText); }
        evalCache.set(key, evaluateWithFinalizer(rf, bf));
    }
    return evalCache.get(key);
}

/** A receipt the suite would write on its success path: every inventory row, the suite's human rows, real bindings. */
function receiptFor(n, { release = S, verdicts = {}, requests, drop = [], suite } = {}) {
    const c = CASES[n - 1];
    const f = facts.get(n);
    const steps = [...new Set([...f.inventory.required, ...f.inventory.product])].filter((s) => !drop.includes(s));
    const rows = steps.map((step) => ({ step, verdict: verdicts[step] ?? (step === 'journey telemetry received' ? 'HOLD' : 'PASS'), detail: 'fixture',
        ...(step === 'coaching request budget' ? { evidence: { browserRequests: requests ?? c.maximum } } : {}) }));
    for (const id of f.human) rows.push({ step: `human: ${id}`, verdict: 'HUMAN', detail: 'pending', evidence: { observationId: id, runbookRow: 'r', passCriterion: 'p', recorded: 'pending' } });
    const declared = c.readback === 'declared';
    return { suite: suite ?? c.suite, release, meta: { fixtureKind: 'human' }, rows,
        readback: { journeys: declared ? [{ journeyId: `journey-${n}`, stages: ['session_during'] }] : [], reportedJourneyIds: [], missingBindings: [] } };
}
const verdictsFor = (n, verdict = 'QUALIFIED', release = S) => ({ suite: CASES[n - 1].suite, release,
    journeys: [{ journeyId: `journey-${n}`, stages: ['session_during'], verdict }], missingBindings: [] });

const ts = (s) => `2026-10-18T10:00:${String(s).padStart(2, '0')}.0000000Z`;
/** A Gate 3 log in the real format, including the step's own script text (which must never be read as output). */
function logFor(n, body, { spec, grep, cleanup } = {}) {
    const c = CASES[n - 1];
    const lines = [
        `${ts(1)} echo "spec=$DIAGNOSTIC_DAST_SPEC grep=\${DIAGNOSTIC_DAST_GREP:-<none>}"`,
        `${ts(2)} spec=${spec ?? c.spec} grep=${grep ?? c.grep}`,
        `${ts(3)} RWT_RECEIPT ${JSON.stringify(body)}`,
    ];
    const cl = cleanup ?? (c.readOnly ? [] : ['cleanup_verified residue=0 tables_verified=23']);
    cl.forEach((l, i) => lines.push(`${ts(4 + i)} RUN_OWNED_CLEANUP ${l}`));
    return lines.join('\n');
}

/** One honest case attempt, with any observation overridden — then verified exactly as collect.mjs does. */
function caseRun(n, o = {}) {
    const c = CASES[n - 1];
    const runId = o.runId ?? String(39_200_000 + n);
    const runAttempt = o.runAttempt ?? 1;
    const body = o.receipt ?? receiptFor(n);
    const receiptText = o.receiptText ?? `${JSON.stringify(body, null, 2)}\n`;
    const readbackBody = o.readback === undefined ? (c.readback === 'declared' ? verdictsFor(n) : null) : o.readback;
    const readbackText = readbackBody === null ? null : JSON.stringify(readbackBody);
    const files = o.files ?? {
        receipts: [{ name: `${body.suite}.receipt.json`, text: receiptText }],
        readbacks: readbackText === null ? [] : [{ name: `${c.suite}.readback-verdicts.json`, text: readbackText }],
    };
    const attempt = { id: Number(runId), run_attempt: runAttempt, path: WORKFLOW_PATH, head_sha: S, head_branch: 'main',
        event: 'workflow_dispatch', status: 'completed', run_started_at: new Date(NOW - 600_000).toISOString(), ...o.attempt };
    return verifyCaseRun({
        caseNumber: n, runId, runAttempt, ledgerCampaignId: 'rwt-campaign-1', reviewed: o.reviewed ?? true,
        continuationApproved: o.continuationApproved ?? true,
        attempt, jobs: o.jobs ?? [{ id: 1, name: GATE3_JOB }, { id: 2, name: 'Gate 1 - Static' }],
        log: o.log ?? logFor(n, o.logReceipt ?? body, o.logOpts),
        artifacts: o.artifacts ?? [{ name: `rwt-receipts-attempt-${runAttempt}`, expired: false }],
        files,
        evaluation: files.receipts.length === 1 ? judge(files.receipts[0].name, files.receipts[0].text, c.readback === 'declared' ? (files.readbacks[0]?.text ?? null) : null) : null,
        inventory: facts.get(n).inventory, observedConfigDigest: o.configDigest ?? D64('a'), observedCleanupScope: o.cleanupScope ?? D64('c'), window,
    });
}

const ledgerOf = (entries) => ({ verified: true, campaignId: 'rwt-campaign-1', entries, inFlight: [], unresolvedCleanup: [] });
const decide = (n, entries, extra = {}) => assess({ caseNumber: n, now: NOW, authority, observation, ledger: ledgerOf(entries),
    bootstrap: null, previousReceipt: entries.at(-1), invocation: invocationFor(n), ...extra });
const honest = (upTo) => Array.from({ length: upTo }, (_, i) => caseRun(i + 1).entry);

// ── static bindings (unchanged behaviour) ──────────────────────────────────────────────────────────────────────────
test('15 cases, the selected maxima (30 total), one spec + grep each; case 15 alone is read-only', () => {
    assert.equal(CASES.length, 15);
    assert.deepEqual(CASES.map((c) => c.maximum), [...CASE_MAXIMA]);
    assert.equal(CASES.reduce((a, c) => a + c.maximum, 0), 30);
    assert.deepEqual(CASES.filter((c) => c.readOnly).map((c) => c.n), [15]);
});

test('every case grep selects EXACTLY ONE test title in its spec', () => {
    for (const c of CASES) {
        const titles = [...readFileSync(c.spec, 'utf8').matchAll(/\btest\(\s*'([^']+)'/g)].map((m) => m[1]);
        assert.equal(titles.filter((t) => t.includes(c.grep)).length, 1, `case ${c.n}: '${c.grep}'`);
    }
});

test('dispatch argv: run-owned cases carry both literal acks; case 15 carries NEITHER; all pin main, Gate 3, reflex 500', () => {
    const one = dispatchArgv(1);
    assert.ok(one.includes(`rwt_writes_ack=${WRITES_ACK}`) && one.includes(`rwt_canary_claim_ack=${CANARY_ACK}`));
    for (const flag of ['--ref', 'main', 'gate=gate-3-dast', 'rwt_human_reflex_ms=500', 'comparison_cell=none']) assert.ok(one.includes(flag));
    assert.ok(!dispatchArgv(15).some((a) => a.startsWith('rwt_writes_ack') || a.startsWith('rwt_canary_claim_ack')));
    assert.deepEqual(invocationFor(15), { writesAck: '', canaryAck: '' });
    assert.equal(dispatchArgv(16), null);
});

test('workers=1 / retries=0 / fullyParallel=false are read from the ACTUAL live config, and drift is caught', () => {
    assert.deepEqual(bindingsFromPlaywrightConfig(readFileSync('playwright.deployed-live.config.ts', 'utf8')), { workers: 1, retries: 0, fullyParallelFalse: true, ok: true });
    assert.equal(bindingsFromPlaywrightConfig('  retries: 1,\n  workers: 1,\n  fullyParallel: false,').ok, false);
    assert.equal(bindingsFromPlaywrightConfig('  retries: 0,\n  workers: 2,\n  fullyParallel: false,').ok, false);
});

test('config digest is deterministic and changes when any bound blob or binding changes', () => {
    const base = { releaseSha: S, blobs: { b: '2', a: '1' }, bindings: { workers: 1, retries: 0 } };
    assert.equal(configRecord(base).digest, configRecord({ ...base, blobs: { a: '1', b: '2' } }).digest);
    assert.notEqual(configRecord(base).digest, configRecord({ ...base, blobs: { a: '1', b: '3' } }).digest);
    assert.notEqual(configRecord(base).digest, configRecord({ ...base, bindings: { workers: 1, retries: 1 } }).digest);
});

// ── §1 source-faithful suites, identity rows and readback declarations ─────────────────────────────────────────────
test('§1 every case suite is one the repository finalizer knows, and its readback declaration matches the source inventory', () => {
    for (const c of CASES) {
        const f = facts.get(c.n);
        assert.ok(f?.inventory, `case ${c.n}: finalizer does not know ${c.suite}`);
        const declares = f.inventory.required.includes('journey telemetry received');
        const bridges = f.inventory.absent.includes('journey telemetry received');
        assert.deepEqual([c.n, c.readback], [c.n, declares ? 'declared' : bridges ? 'bridge' : 'unknown']);
    }
});

test('§1 identity rows are the suite\'s OWN identity steps — Focus has no signup row (flagged, not normalized away)', () => {
    const identity = Object.fromEntries(CASES.map((c) => [c.n, caseRun(c.n).entry.identityRows]));
    const runOwned = ['run-owned signup', 'canary claim in fresh login'];
    assert.deepEqual(identity, {
        1: ['signup', 'sign-in', 'session bears canary claim'], 2: ['session bears canary claim'], 3: ['session bears canary claim'],
        4: runOwned, 5: runOwned, 6: runOwned, 7: runOwned, 8: runOwned, 9: runOwned, 10: runOwned, 11: runOwned, 12: runOwned,
        13: runOwned, 14: runOwned, 15: ['returning-user sign-in', 'returning account state'],
    });
});

test('§1 an identity row that is not PASS is dominant (Open Mic signup FAIL; Focus canary claim HOLD)', () => {
    assert.ok(caseRun(1, { receipt: receiptFor(1, { verdicts: { signup: 'FAIL' } }) }).entry.dominantReasons.includes('identity:signup'));
    assert.ok(caseRun(2, { receipt: receiptFor(2, { verdicts: { 'session bears canary claim': 'HOLD' } }) }).entry.dominantReasons.includes('identity:session bears canary claim'));
});

// ── honest runs → the contract admits the next case ─────────────────────────────────────────────────────────────────
test('INTEGRATION: every honest case run verifies with no error, readback settled or validated N/A, counted requests', () => {
    for (const c of CASES) {
        const { entry, errors } = caseRun(c.n);
        assert.deepEqual([c.n, errors], [c.n, []]);
        assert.equal(entry.dominantStop, false, `case ${c.n}: ${entry.dominantReasons}`);
        assert.equal(entry.mandatoryReadbackComplete, true);
        assert.equal(entry.readback, c.readback === 'declared' ? 'declared' : 'not_applicable_source_defined');
        assert.equal(entry.requests, c.maximum);
        assert.equal(entry.outcome, 'PASS');
        if (!c.readOnly) assert.deepEqual([entry.cleanup.verified, entry.cleanup.residue, entry.cleanup.ownerScope], [true, 0, 'this_run_only']);
    }
});

test('INTEGRATION case 1 bootstrap: explicit, no earlier attempt, prior runs reconciled → GO; each missing fact holds', () => {
    const bootstrap = (o = {}) => campaignStartPreflight({ authority, explicitFirstDispatch: true, windowRuns: [], priorRuns: [{ readOnly: false, cleanupOk: true, residue: 0 }], ...o });
    const base = { caseNumber: 1, now: NOW, authority, observation, ledger: ledgerOf([]), previousReceipt: null, invocation: invocationFor(1) };
    assert.equal(assess({ ...base, bootstrap: bootstrap() }).reason, 'explicit_bootstrap');
    assert.equal(assess({ ...base, bootstrap: bootstrap({ explicitFirstDispatch: false }) }).reason, 'bootstrap_missing_or_not_fresh');
    assert.equal(assess({ ...base, bootstrap: bootstrap({ windowRuns: [{ id: 1, run_attempt: 1 }] }) }).reason, 'bootstrap_missing_or_not_fresh');
    assert.equal(assess({ ...base, bootstrap: bootstrap({ priorRuns: [{ readOnly: false, cleanupOk: false, residue: null }] }) }).reason, 'bootstrap_missing_or_not_fresh');
    assert.equal(assess({ ...base, bootstrap: bootstrap({ priorRuns: [{ readOnly: false, cleanupOk: true, residue: 1 }] }) }).reason, 'bootstrap_missing_or_not_fresh');
    assert.equal(assess({ ...base, bootstrap: bootstrap({ priorRuns: null }) }).reason, 'bootstrap_missing_or_not_fresh');
});

test('INTEGRATION full chain: honest cases 1–14 admit case 15 (read-only, no acks); every intermediate case is admitted', () => {
    const entries = honest(14);
    for (let n = 2; n <= 15; n += 1) assert.equal(decide(n, entries.slice(0, n - 1)).eligible, true, `case ${n}`);
    assert.equal(decide(15, entries, { invocation: invocationFor(1) }).reason, 'maintained_account_must_be_read_only_without_acks');
});

test('an ordinary product HOLD/FAIL still needs continuation review — and only that row class can be continued', () => {
    const ordinary = caseRun(1, { receipt: receiptFor(1, { verdicts: { 'coaching length': 'FAIL' } }), continuationApproved: false }).entry;
    assert.equal(ordinary.dominantStop, false);
    assert.equal(decide(2, [ordinary]).reason, 'ordinary_outcome_needs_review');
    const continued = caseRun(1, { receipt: receiptFor(1, { verdicts: { 'coaching length': 'FAIL' } }), continuationApproved: true }).entry;
    assert.equal(decide(2, [continued]).eligible, true);
});

// ── §2/§3 negatives: wrong suite / attempt / artifact / spec, missing readback ─────────────────────────────────────
const heldOn = (entry) => decide(2, [entry]).reason;

test('NEGATIVE wrong suite: case 1 artifact holds case 2\'s receipt → error, dominant, held even with continuation', () => {
    const r = caseRun(1, { receipt: receiptFor(2), readback: verdictsFor(2) });
    assert.ok(r.errors.includes('artifact_receipt_is_not_exactly_this_suite'));
    assert.ok(r.errors.includes('finalizer_suite_is_not_this_case'));
    assert.equal(heldOn(r.entry), 'unfinished_or_dominant_receipt');
});

test('NEGATIVE wrong attempt: ledger names attempt 1, the run is attempt 2 / only attempt-2 artifact exists → held', () => {
    assert.ok(caseRun(1, { attempt: { run_attempt: 2 } }).errors.includes('attempt_number_mismatch'));
    const art = caseRun(1, { artifacts: [{ name: 'rwt-receipts-attempt-2', expired: false }] });
    assert.ok(art.errors.includes('not_exactly_one_attempt_artifact'));
    assert.equal(heldOn(art.entry), 'unfinished_or_dominant_receipt');
});

test('NEGATIVE wrong artifact: expired, duplicated, two receipts, or a receipt that differs from the job-log receipt', () => {
    assert.ok(caseRun(1, { artifacts: [{ name: 'rwt-receipts-attempt-1', expired: true }] }).errors.includes('attempt_artifact_expired_or_unknown'));
    assert.ok(caseRun(1, { artifacts: [{ name: 'rwt-receipts-attempt-1', expired: false }, { name: 'rwt-receipts-attempt-1', expired: false }] }).errors.includes('not_exactly_one_attempt_artifact'));
    const body = receiptFor(1);
    const two = caseRun(1, { files: { receipts: [{ name: 'open-mic-first-session.receipt.json', text: JSON.stringify(body) }, { name: 'focus-points-session.receipt.json', text: JSON.stringify(receiptFor(2)) }], readbacks: [] } });
    assert.ok(two.errors.includes('artifact_receipt_is_not_exactly_this_suite'));
    const differs = caseRun(1, { logReceipt: receiptFor(1, { verdicts: { 'coaching length': 'FAIL' } }) });
    assert.ok(differs.errors.includes('artifact_receipt_differs_from_job_log_receipt'));
    assert.equal(heldOn(differs.entry), 'unfinished_or_dominant_receipt');
});

test('NEGATIVE run identity: wrong workflow, not a main dispatch, outside the window, no single Gate 3 job, receipt for another release', () => {
    assert.ok(caseRun(1, { attempt: { path: '.github/workflows/ci.yml' } }).errors.includes('workflow_path_mismatch'));
    assert.ok(caseRun(1, { attempt: { event: 'push' } }).errors.includes('not_a_main_workflow_dispatch'));
    assert.ok(caseRun(1, { attempt: { run_started_at: new Date(authority.validFrom - 1).toISOString() } }).errors.includes('attempt_outside_authority_window'));
    assert.ok(caseRun(1, { jobs: [{ id: 2, name: 'Gate 1 - Static' }] }).errors.includes('not_exactly_one_gate3_job'));
    const other = caseRun(1, { receipt: receiptFor(1, { release: OTHER }), readback: verdictsFor(1, 'QUALIFIED', OTHER) });
    assert.ok(other.errors.includes('receipt_release_is_not_the_run_head'));
});

test('NEGATIVE observed spec/grep: another case\'s spec or grep, or none — and the step\'s script text is never read as output', () => {
    assert.ok(caseRun(1, { logOpts: { spec: CASES[1].spec } }).errors.includes('observed_spec_or_grep_is_not_this_case'));
    assert.ok(caseRun(5, { logOpts: { grep: 'response lost' } }).errors.includes('observed_spec_or_grep_is_not_this_case'));
    const scriptOnly = logFor(1, receiptFor(1)).split('\n').filter((l) => !/Z spec=/.test(l)).join('\n');
    assert.deepEqual(parseGateLog(scriptOnly).specs, []);
    assert.ok(caseRun(1, { log: scriptOnly }).errors.includes('not_exactly_one_observed_spec_line'));
});

test('NEGATIVE missing readback: a declared suite with no verdicts file, a HOLD journey, or a FAIL journey is DOMINANT', () => {
    const none = caseRun(1, { readback: null });
    assert.ok(none.errors.includes('declared_readback_verdicts_missing_or_ambiguous'));
    assert.ok(none.entry.dominantReasons.includes('stop:readback_not_qualified'));
    assert.equal(heldOn(none.entry), 'unfinished_or_dominant_receipt');
    for (const v of ['HOLD', 'FAIL']) {
        const r = caseRun(7, { readback: verdictsFor(7, v) });
        assert.deepEqual([v, r.entry.dominantStop, r.entry.mandatoryReadbackComplete], [v, true, false]);
        assert.equal(decide(8, [...honest(6), r.entry]).reason, 'unfinished_or_dominant_receipt');
    }
});

test('NEGATIVE bridge N/A is validated: a bridge with a verdicts file or declared bindings is an error, not "complete"', () => {
    assert.ok(caseRun(4, { readback: verdictsFor(4) }).errors.includes('bridge_suite_has_unexpected_readback_verdicts'));
    const bound = receiptFor(4);
    bound.readback.journeys = [{ journeyId: 'journey-4', stages: ['session_during'] }];
    assert.ok(caseRun(4, { receipt: bound }).errors.includes('bridge_suite_declares_readback_bindings'));
});

// ── §4 dominant stops survive continuationApproved ──────────────────────────────────────────────────────────────────
test('NEGATIVE unknown cost: an unanswered/HOLD budget, a FAIL budget, or no budget row is dominant despite continuation', () => {
    for (const receipt of [receiptFor(1, { verdicts: { 'coaching request budget': 'HOLD' } }), receiptFor(1, { verdicts: { 'coaching request budget': 'FAIL' } })]) {
        const r = caseRun(1, { receipt, continuationApproved: true });
        assert.ok(r.entry.dominantReasons.includes('stop:unknown_or_unanswered_provider_cost'));
        assert.equal(r.entry.requests, null);
        assert.equal(heldOn(r.entry), 'unfinished_or_dominant_receipt');
    }
    const stripped = caseRun(1, { receipt: receiptFor(1, { drop: ['coaching request budget'] }) });
    assert.ok(stripped.errors.some((e) => /coaching request budget/.test(e)));
    assert.equal(heldOn(stripped.entry), 'unfinished_or_dominant_receipt');
});

test('NEGATIVE privacy FAIL: receipt content-free ≠ PASS is dominant despite continuation (and a leak-redacted receipt is an error)', () => {
    const r = caseRun(1, { receipt: receiptFor(1, { verdicts: { 'receipt content-free': 'FAIL' } }), continuationApproved: true });
    assert.ok(r.entry.dominantReasons.includes('stop:receipt content-free'));
    assert.equal(heldOn(r.entry), 'unfinished_or_dominant_receipt');
    const redacted = { suite: 'open-mic-first-session', release: S, contaminated: true, acceptance: 'FAIL', leakCount: 1 };
    assert.equal(heldOn(caseRun(1, { receipt: redacted, readback: null }).entry), 'unfinished_or_dominant_receipt');
});

test('NEGATIVE effect and outage stops: Cloud STT used, navigation wrote, or an EXTERNAL provider outage row', () => {
    assert.ok(caseRun(9, { receipt: receiptFor(9, { verdicts: { 'no Cloud STT request': 'FAIL' } }) }).entry.dominantReasons.includes('stop:no Cloud STT request'));
    assert.ok(caseRun(15, { receipt: receiptFor(15, { verdicts: { 'navigation writes nothing': 'FAIL' } }) }).entry.dominantStop);
    assert.equal(caseRun(1, { receipt: receiptFor(1, { verdicts: { 'coaching rendered': 'EXTERNAL' } }) }).entry.dominantStop, true);
});

// ── cleanup provenance ──────────────────────────────────────────────────────────────────────────────────────────────
test('cleanup: exactly one verified line FIRST from this job; partial-suite afterEach not_required after it is allowed', () => {
    const parse = (ls) => cleanupFromLog(parseGateLog(ls.map((l, i) => `${ts(i)} RUN_OWNED_CLEANUP ${l}`).join('\n')));
    assert.deepEqual(parse(['cleanup_verified residue=0 tables_verified=23', 'cleanup_not_required residue=0 tables_verified=0']), { ok: true, residue: 0, lines: 2 });
    assert.equal(parse(['cleanup_not_required residue=0 tables_verified=0', 'cleanup_verified residue=0 tables_verified=23']).ok, false);
    assert.equal(parse(['cleanup_verified residue=0 tables_verified=23', 'cleanup_verified residue=0 tables_verified=23']).ok, false);
    assert.equal(parse(['cleanup_verified residue=0 tables_verified=0']).ok, false);
    assert.equal(parse([]).ok, false);
    assert.equal(parse(['cleanup_verified residue=null tables_verified=23']).ok, false);
});

test('NEGATIVE cleanup: no line, a non-zero residue, or a cleanup line in the read-only case → held', () => {
    assert.ok(caseRun(4, { logOpts: { cleanup: [] } }).errors.includes('cleanup_line_missing_ambiguous_or_unverified'));
    const residue = caseRun(1, { logOpts: { cleanup: ['cleanup_verified residue=2 tables_verified=23'] } });
    assert.equal(residue.entry.cleanup.residue, 2);
    assert.equal(heldOn(residue.entry), 'cleanup_missing_mismatched_or_not_zero');
    assert.ok(caseRun(15, { logOpts: { cleanup: ['cleanup_not_required residue=0 tables_verified=0'] } }).errors.includes('read_only_case_logged_a_cleanup'));
    assert.equal(heldOn(caseRun(1, { cleanupScope: D64('d') }).entry), 'cleanup_missing_mismatched_or_not_zero');
});

// ── §5 ledger, activity, freshness, dependency identity ─────────────────────────────────────────────────────────────
const fileEntry = (n, runId = String(39_200_000 + n)) => ({ caseNumber: n, runId, runAttempt: 1, reviewed: true, continuationApproved: true });
const ledgerFileOf = (n, o = {}) => ({ campaignId: 'rwt-campaign-1', entries: Array.from({ length: n }, (_, i) => fileEntry(i + 1)), inFlight: [], unresolvedCleanup: [], ...o });
const windowOf = (n) => Array.from({ length: n }, (_, i) => ({ id: 39_200_000 + i + 1, run_attempt: 1 }));

test('ledger: a complete, accounted ledger verifies; `verified` is computed, never read from the file', () => {
    assert.deepEqual(verifyLedger({ ledgerFile: ledgerFileOf(2), authority, verifiedEntries: honest(2), windowRuns: windowOf(2) }), { verified: true, reasons: [] });
    assert.ok(verifyLedger({ ledgerFile: { ...ledgerFileOf(2), verified: true }, authority, verifiedEntries: honest(2), windowRuns: windowOf(2) }).reasons.includes('ledger_file_must_not_assert_verified'));
});

test('NEGATIVE omitted ledger state: missing inFlight / unresolvedCleanup / entries, or an incomplete entry, never defaults to empty', () => {
    for (const k of ['inFlight', 'unresolvedCleanup', 'entries']) {
        const f = ledgerFileOf(0);
        delete f[k];
        assert.deepEqual([k, verifyLedger({ ledgerFile: f, authority, verifiedEntries: [], windowRuns: [] }).verified], [k, false]);
    }
    const partial = ledgerFileOf(1);
    delete partial.entries[0].reviewed;
    assert.ok(verifyLedger({ ledgerFile: partial, authority, verifiedEntries: honest(1), windowRuns: windowOf(1) }).reasons.includes('ledger_entry_1_incomplete'));
    assert.equal(verifyLedger({ ledgerFile: ledgerFileOf(1), authority, verifiedEntries: [null], windowRuns: windowOf(1) }).verified, false);
    assert.ok(verifyLedger({ ledgerFile: ledgerFileOf(1), authority, verifiedEntries: honest(1), windowRuns: null }).reasons.includes('campaign_window_runs_unreadable'));
});

test('NEGATIVE accounting: an unlisted rc-gates attempt in the window, or an entry from outside it, leaves the ledger unverified', () => {
    const extra = verifyLedger({ ledgerFile: ledgerFileOf(1), authority, verifiedEntries: honest(1), windowRuns: [...windowOf(1), { id: 39_299_999, run_attempt: 1 }, { id: 39_200_001, run_attempt: 2 }] });
    assert.deepEqual(extra.reasons, ['unaccounted_rc_gates_run_39299999_attempt_1', 'unaccounted_rc_gates_run_39200001_attempt_2']);
    assert.ok(verifyLedger({ ledgerFile: ledgerFileOf(1), authority, verifiedEntries: honest(1), windowRuns: [] }).reasons.includes('ledger_entry_run_39200001_not_in_campaign_window'));
    const inFlight = verifyLedger({ ledgerFile: ledgerFileOf(1, { inFlight: [{ runId: 39_299_999, runAttempt: 1 }] }), authority, verifiedEntries: honest(1), windowRuns: [...windowOf(1), { id: 39_299_999, run_attempt: 1 }] });
    assert.equal(inFlight.verified, true); // accounted — and the contract then holds on the in-flight attempt
    assert.equal(decide(2, honest(1), { ledger: { ...ledgerOf(honest(1)), inFlight: [{}] } }).reason, 'unresolved_attempt_or_cleanup');
});

test('NEGATIVE older active runs: any non-completed run of any age is busy; the active-run reads are complete, not latest-20', () => {
    assert.equal(classifyActivity([{ status: 'completed' }, { status: 'waiting', created_at: '2026-01-01T00:00:00Z' }]), 'busy');
    assert.equal(classifyActivity(null), 'unknown');
    const src = readFileSync('local-packets/1593-campaign-helper/collect.mjs', 'utf8');
    assert.doesNotMatch(src, /'--limit'/);
    assert.match(src, /ACTIVE_STATUSES = Object\.freeze\(\['queued', 'in_progress', 'waiting', 'requested', 'pending'\]\)/);
    assert.match(src, /--paginate/);
    const busy = observationAt({ startedAt: NOW - 10, mainSha: S, servedSha: S, configDigest: D64('a'), bindingsOk: true, dependencyIdentical: true, activity: { ...activityIdle, rcGates: 'busy' } });
    assert.equal(decide(2, honest(1), { observation: busy }).reason, 'overlapping_or_unknown_activity');
});

test('NEGATIVE expiry during collection: the decision uses time AFTER collection, so an observation or authority that expired holds', () => {
    const startedAt = NOW - FRESHNESS_MS - 1;
    const stale = observationAt({ startedAt, mainSha: S, servedSha: S, configDigest: D64('a'), bindingsOk: true, dependencyIdentical: true, activity: activityIdle });
    assert.equal(decide(2, honest(1), { observation: stale }).reason, 'release_config_or_freshness');
    assert.equal(decide(2, honest(1), { authority: { ...authority, validUntil: NOW - 1 } }).reason, 'authority_missing_expired_or_wrong_scope');
    const src = readFileSync('local-packets/1593-campaign-helper/collect.mjs', 'utf8');
    assert.ok(src.indexOf('const now = Date.now(); // after every read') > src.indexOf('const observation = observationAt('));
});

test('NEGATIVE dependency identity / config: a checkout that differs from S, an unbound config, or another release holds', () => {
    const differs = observationAt({ startedAt: NOW - 10, mainSha: S, servedSha: S, configDigest: D64('a'), bindingsOk: true, dependencyIdentical: false, activity: activityIdle });
    assert.equal(decide(2, honest(1), { observation: differs }).reason, 'release_config_or_freshness');
    assert.equal(decide(2, [caseRun(1, { configDigest: D64('e') }).entry]).reason, 'receipt_identity_or_order');
    assert.equal(decide(2, honest(1), { observation: { ...observation, servedSha: OTHER } }).reason, 'release_config_or_freshness');
});

test('no authority field is stamped as observed: entry release/config/cleanup scope come only from the run and its head', () => {
    const e = caseRun(1, { configDigest: D64('9'), cleanupScope: D64('8'), attempt: { head_sha: OTHER } }).entry;
    assert.deepEqual([e.releaseSha, e.configDigest, e.cleanup.scopeDigest, e.cleanup.releaseSha], [OTHER, D64('9'), D64('8'), OTHER]);
    const src = readFileSync('local-packets/1593-campaign-helper/collect.mjs', 'utf8');
    const verify = src.slice(src.indexOf('export function verifyCaseRun'), src.indexOf('export function verifyLedger'));
    assert.doesNotMatch(verify, /authority\./);
});
