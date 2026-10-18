// Run: node --test local-packets/1593-campaign-helper/collect.test.mjs   (no network, no GitHub, no dispatch)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assess, CASE_MAXIMA } from '../1593-bootstrap/contract.mjs';
import {
    CASES, CANARY_ACK, WRITES_ACK, bindingsFromPlaywrightConfig, campaignStartPreflight, classifyActivity, configRecord,
    dispatchArgv, invocationFor, ledgerEntry, parseReceiptLog,
} from './collect.mjs';

const S = '3540103e8d86b5a284265443312c61e643bf5304';
const D64 = (c) => c.repeat(64);
const NOW = 1_800_000_000_000;
const authority = {
    verified: true, campaignId: 'rwt-campaign-1', releaseSha: S, configDigest: D64('a'), budget: 30, firstCase: 1, lastCase: 15,
    validFrom: NOW - 1000, validUntil: NOW + 3_600_000, allowRunOwnedCreation: true, allowPermanentRunOwnedCleanup: true,
    allowRunOwnedCanaryClaim: true, allowMaintainedReadOnly: true, cleanupScopeDigest: D64('c'),
};
const observation = { verified: true, observedAt: NOW - 10, validUntil: NOW + 60_000, mainSha: S, servedSha: S, workflowSha: S,
    configDigest: D64('a'), main: 'idle', rcGates: 'idle', production: 'idle' };
const ledgerOf = (entries) => ({ verified: true, campaignId: 'rwt-campaign-1', entries, inFlight: [], unresolvedCleanup: [] });

/** A Gate 3 log in the real format: the content-free receipt line and the run-owned cleanup line. */
const logOf = ({ release = S, rows, residue = 0 }) => [
    '2026-10-18T10:00:00.0000000Z RUN_OWNED_CLEANUP cleanup_verified residue=' + residue + ' tables_verified=23',
    '2026-10-18T10:00:00.1000000Z RWT_RECEIPT ' + JSON.stringify({ suite: 'x', release, meta: { humanReflexMs: 500 }, rows }),
].join('\n');
const passRows = (extra = []) => [
    { step: 'run-owned signup', verdict: 'PASS' }, { step: 'canary claim in fresh login', verdict: 'PASS' },
    { step: 'run-owned cleanup', verdict: 'PASS' }, { step: 'telemetry decodable', verdict: 'PASS' }, ...extra,
];

test('15 cases, the selected maxima (30 total), one spec + grep each; case 15 alone is read-only', () => {
    assert.equal(CASES.length, 15);
    assert.deepEqual(CASES.map((c) => c.maximum), [...CASE_MAXIMA]);
    assert.equal(CASES.reduce((a, c) => a + c.maximum, 0), 30);
    assert.deepEqual(CASES.filter((c) => c.readOnly).map((c) => c.n), [15]);
});

test('every case grep selects EXACTLY ONE test title in its spec (the binding is exact, not a pattern over many)', () => {
    for (const c of CASES) {
        const src = readFileSync(c.spec, 'utf8');
        const titles = [...src.matchAll(/\btest\(\s*'([^']+)'/g)].map((m) => m[1]);
        const hits = titles.filter((t) => t.includes(c.grep));
        assert.equal(hits.length, 1, `case ${c.n}: '${c.grep}' matched ${hits.length} titles in ${c.spec}`);
    }
});

test('dispatch argv: run-owned cases carry both literal acks; case 15 carries NEITHER; all pin main, Gate 3, reflex 500', () => {
    const one = dispatchArgv(1);
    assert.ok(one.includes(`rwt_writes_ack=${WRITES_ACK}`) && one.includes(`rwt_canary_claim_ack=${CANARY_ACK}`));
    for (const flag of ['--ref', 'main', 'gate=gate-3-dast', 'rwt_human_reflex_ms=500', 'comparison_cell=none']) assert.ok(one.includes(flag));
    const last = dispatchArgv(15);
    assert.ok(!last.some((a) => a.startsWith('rwt_writes_ack') || a.startsWith('rwt_canary_claim_ack')));
    assert.deepEqual(invocationFor(15), { writesAck: '', canaryAck: '' });
    assert.equal(dispatchArgv(16), null);
});

test('workers=1 / retries=0 / fullyParallel=false are read from the ACTUAL live config, and drift is caught', () => {
    const actual = bindingsFromPlaywrightConfig(readFileSync('playwright.deployed-live.config.ts', 'utf8'));
    assert.deepEqual(actual, { workers: 1, retries: 0, fullyParallelFalse: true, ok: true });
    assert.equal(bindingsFromPlaywrightConfig('  retries: 1,\n  workers: 1,\n  fullyParallel: false,').ok, false);
    assert.equal(bindingsFromPlaywrightConfig('  retries: 0,\n  workers: 2,\n  fullyParallel: false,').ok, false);
});

test('config digest is deterministic and changes when any bound blob or binding changes', () => {
    const base = { releaseSha: S, blobs: { b: '2', a: '1' }, bindings: { workers: 1, retries: 0 } };
    assert.equal(configRecord(base).digest, configRecord({ ...base, blobs: { a: '1', b: '2' } }).digest);
    assert.notEqual(configRecord(base).digest, configRecord({ ...base, blobs: { a: '1', b: '3' } }).digest);
    assert.notEqual(configRecord(base).digest, configRecord({ ...base, bindings: { workers: 1, retries: 1 } }).digest);
});

test('activity: any in-progress or queued run is busy; an unreadable list is unknown (the contract holds on both)', () => {
    assert.equal(classifyActivity([{ status: 'completed' }]), 'idle');
    assert.equal(classifyActivity([{ status: 'completed' }, { status: 'queued' }]), 'busy');
    assert.equal(classifyActivity(null), 'unknown');
});

test('receipt parsing: numeric residue, request count, outcome; dominant rows vs ordinary rows', () => {
    const ok = parseReceiptLog(logOf({ rows: passRows([{ step: 'coaching request budget', verdict: 'HOLD', evidence: { browserRequests: 2 } }]) }));
    assert.equal(ok.residue, 0); assert.equal(ok.requests, 2); assert.equal(ok.outcome, 'HOLD'); assert.equal(ok.dominantStop, false);
    assert.match(ok.receiptDigest, /^[a-f0-9]{64}$/);
    // A cleanup FAIL is dominant even when everything else passes; a missing identity row is dominant too.
    assert.equal(parseReceiptLog(logOf({ rows: passRows().map((r) => r.step === 'run-owned cleanup' ? { ...r, verdict: 'FAIL' } : r) })).dominantStop, true);
    assert.equal(parseReceiptLog(logOf({ rows: passRows().filter((r) => r.step !== 'canary claim in fresh login') })).dominantStop, true);
    // No cleanup line → residue null (never a string "0" or an assumed zero).
    assert.equal(parseReceiptLog('RWT_RECEIPT ' + JSON.stringify({ release: S, rows: passRows() })).residue, null);
    // A receipt without the coaching budget row does not EMIT a request count (cases 1–3 today) → null, never 0.
    assert.equal(parseReceiptLog(logOf({ rows: passRows() })).requests, null);
});

test('INTEGRATION case 1: explicit campaign-start preflight, null predecessor → eligible; reused/absent bootstrap holds', () => {
    const bootstrap = campaignStartPreflight({ authority, explicitFirstDispatch: true, noEarlierAttempt: true, priorCampaignCleanupReconciled: true });
    const input = { caseNumber: 1, now: NOW, authority, observation, ledger: ledgerOf([]), bootstrap, previousReceipt: null, invocation: invocationFor(1) };
    assert.deepEqual({ ...assess(input) }, { eligible: true, reason: 'explicit_bootstrap', used: 0, maximum: 4, remainingAfterReservation: 26, theoreticalProviderReservation: 12 });
    assert.equal(assess({ ...input, bootstrap: { ...bootstrap, noEarlierAttempt: false } }).reason, 'bootstrap_missing_or_not_fresh');
    assert.equal(assess({ ...input, observation: { ...observation, servedSha: D64('0').slice(0, 40) } }).reason, 'release_config_or_freshness');
    assert.equal(assess({ ...input, observation: { ...observation, rcGates: 'busy' } }).reason, 'overlapping_or_unknown_activity');
});

const entryFor = (n, rows, residue = 0) => ledgerEntry({
    caseNumber: n, runId: String(39_000_000 + n), runAttempt: 1, conclusionTerminal: true, parsed: parseReceiptLog(logOf({ rows, residue })),
    authority, reviewed: true, continuationApproved: true,
});

test('INTEGRATION case 2 after a REAL-format case-1 receipt: holds while case 1 emits no request count (the reported gap)', () => {
    const e1 = entryFor(1, passRows()); // today's Open Mic receipt: no coaching-budget row
    assert.equal(e1.requests, null);
    const input = { caseNumber: 2, now: NOW, authority, observation, ledger: ledgerOf([e1]), bootstrap: null, previousReceipt: e1, invocation: invocationFor(2) };
    assert.equal(assess(input).reason, 'unknown_or_exceeded_case_requests');
    // With a count emitted (e.g. a budget row added to the spec), the same chain is eligible.
    const counted = entryFor(1, passRows([{ step: 'coaching request budget', verdict: 'PASS', evidence: { browserRequests: 3 } }]));
    assert.equal(assess({ ...input, ledger: ledgerOf([counted]), previousReceipt: counted }).eligible, true);
});

test('INTEGRATION dominant stop and cleanup: a dominant receipt or non-zero residue stops the next case', () => {
    const budget = { step: 'coaching request budget', verdict: 'PASS', evidence: { browserRequests: 1 } };
    const dominant = entryFor(1, passRows([budget]).map((r) => r.step === 'run-owned signup' ? { ...r, verdict: 'FAIL' } : r));
    const base = { caseNumber: 2, now: NOW, authority, observation, bootstrap: null, invocation: invocationFor(2) };
    assert.equal(assess({ ...base, ledger: ledgerOf([dominant]), previousReceipt: dominant }).reason, 'unfinished_or_dominant_receipt');
    const residue = entryFor(1, passRows([budget]), 2);
    assert.equal(assess({ ...base, ledger: ledgerOf([residue]), previousReceipt: residue }).reason, 'cleanup_missing_mismatched_or_not_zero');
});

test('INTEGRATION case 15: maintained read-only account passes with both acks absent and no cleanup receipt of its own', () => {
    const budget = (k) => ({ step: 'coaching request budget', verdict: 'PASS', evidence: { browserRequests: k } });
    const entries = CASES.slice(0, 14).map((c) => entryFor(c.n, passRows([budget(c.maximum)])));
    const input = { caseNumber: 15, now: NOW, authority, observation, ledger: ledgerOf(entries), bootstrap: null, previousReceipt: entries.at(-1), invocation: invocationFor(15) };
    assert.equal(assess(input).eligible, true);
    assert.equal(assess({ ...input, invocation: invocationFor(1) }).reason, 'maintained_account_must_be_read_only_without_acks');
});
