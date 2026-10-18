// Run: node --test local-packets/1593-campaign-helper/collect.test.mjs   (no network, no GitHub, no dispatch)
// Needs `tsx` (node_modules/.bin/tsx, or TSX_BIN): fixtures are judged by the REPOSITORY finalizer at this checkout, and
// every fixture row comes from the suite's own inventory (evaluate.mts --inventory) — no row label is invented here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import * as adapter from './collect.mjs';
import { assess, CASE_MAXIMA } from '../1593-bootstrap/contract.mjs';
import {
    BASE_URL, CASES, CANARY_ACK, FRESHNESS_MS, GATE3_JOB, WORKFLOW_PATH, WRITES_ACK, attemptsInWindow, bindingsFromPlaywrightConfig,
    campaignStartPreflight, classifyActivity, classifyPriorAttempt, cleanupFromLog, configRecord, dispatchArgv, evaluateWithFinalizer,
    expectedInputs, finalReconciliation, invocationFor, observationAt, parseGateLog, parseStepEnv, priorAttemptStates, suiteFacts, verifyCaseRun, verifyLedger,
    windowAttempts,
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
    return { suite: suite ?? c.suite, release, meta: { fixtureKind: 'human', humanReflexMs: 500 }, rows,
        readback: { journeys: declared ? [{ journeyId: `journey-${n}`, stages: ['session_during'] }] : [], reportedJourneyIds: [], missingBindings: [] } };
}
const verdictsFor = (n, verdict = 'QUALIFIED', release = S) => ({ suite: CASES[n - 1].suite, release,
    journeys: [{ journeyId: `journey-${n}`, stages: ['session_during'], verdict }], missingBindings: [] });

const ts = (s) => `2026-10-18T10:00:${String(s).padStart(2, '0')}.0000000Z`;
/** The diagnostic step header and its printed `env:` block, in GitHub's real log format (rc-gates run 39076238188). */
function envBlock(n, { env = {}, drop = [], head = S } = {}) {
    const values = { ...expectedInputs(n, head), SUPABASE_URL: 'https://example.supabase.co', ...env };
    const keys = Object.keys(values).filter((k) => !drop.includes(k));
    return [`${ts(0)} ##[group]Run echo "DIAGNOSTIC_SINGLE_SPEC=true"`, `${ts(0)} echo "DIAGNOSTIC_SINGLE_SPEC=true"`, `${ts(0)} env:`,
        ...keys.map((k) => `${ts(0)}   ${k}: ${values[k]}`), `${ts(0)} ##[endgroup]`];
}
/** A Gate 3 log in the real format, including the step's own script text (which must never be read as output). */
function logFor(n, body, { spec, grep, cleanup, env, drop, noEnv } = {}) {
    const c = CASES[n - 1];
    const lines = [
        ...(noEnv ? [] : envBlock(n, { env, drop })),
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
        attempt, jobs: o.jobs ?? GATE_JOBS(),
        log: o.log ?? logFor(n, o.logReceipt ?? body, o.logOpts),
        artifacts: o.artifacts ?? [{ name: `rwt-receipts-attempt-${runAttempt}`, expired: false }],
        files,
        evaluation: files.receipts.length === 1 ? judge(files.receipts[0].name, files.receipts[0].text, c.readback === 'declared' ? (files.readbacks[0]?.text ?? null) : null) : null,
        inventory: facts.get(n).inventory, observedConfigDigest: o.configDigest ?? D64('a'), observedCleanupScope: o.cleanupScope ?? D64('c'), window,
    });
}

/** The real rc-gates job set (run 39076238188): only Gate 3 runs for a `gate-3-dast` dispatch; the rest are skipped. */
const GATE_JOBS = (over = {}) => [GATE3_JOB, 'Gate 4 - SCA / Dependency Review', 'Gate 5 - UX Smoke', 'Gate 1 - Product Truth',
    'Gate 2 - SAST / OWASP Code Review', 'Model Comparison Authorization']
    .map((name, i) => ({ id: i + 1, name, conclusion: over[name] ?? (name === GATE3_JOB ? 'success' : 'skipped') }));
const ledgerOf = (entries) => ({ verified: true, campaignId: 'rwt-campaign-1', entries, inFlight: [], unresolvedCleanup: [] });
const decide = (n, entries, extra = {}) => assess({ caseNumber: n, now: NOW, authority, observation, ledger: ledgerOf(entries),
    bootstrap: null, previousReceipt: entries.at(-1), invocation: invocationFor(n), ...extra });
const honest = (upTo) => Array.from({ length: upTo }, (_, i) => caseRun(i + 1).entry);

// Independent CLI successor regression: the positive control passes, both former terminal defects must HOLD.
// Calls the UNCHANGED main() with fully mocked network/child-process ports. Finalizer outputs are precomputed
// with the real evaluator above, before mocking any port. Never dispatches or contacts a live service.
async function mockedFinal({ badDependencies = false, authorityChanges = {} } = {}) {
    const receipts = new Map(CASES.map((c) => [c.n, receiptFor(c.n)]));
    const evaluations = new Map(CASES.map((c) => [c.suite, judge(`${c.suite}.receipt.json`, JSON.stringify(receipts.get(c.n)),
        c.readback === 'declared' ? JSON.stringify(verdictsFor(c.n)) : null)]));
    const blob = 'a'.repeat(40);
    const tree = 'b'.repeat(40);
    const bindings = { workers: 1, retries: 0, fullyParallelFalse: true, ok: true };
    const blobs = Object.fromEntries([...adapter.CONFIG_FILES, ...new Set(CASES.map((c) => c.spec))].map((p) => [p, blob]));
    for (const p of adapter.EVALUATED_TREES) blobs[`${p}/`] = tree;
    const digest = configRecord({ releaseSha: S, blobs, bindings }).digest;
    const a = { ...authority, configDigest: digest, cleanupScopeDigest: adapter.cleanupScopeDigest(blob), ...authorityChanges };
    const f = { campaignId: authority.campaignId, entries: CASES.map((c) => ({ caseNumber: c.n, runId: String(39_200_000 + c.n),
        runAttempt: 1, reviewed: true, continuationApproved: true })), inFlight: [], unresolvedCleanup: [] };
    const scratch = mkdtempSync(path.join(tmpdir(), 'cli-final-probe-'));
    const af = path.join(scratch, 'authority.json');
    const lf = path.join(scratch, 'ledger.json');
    writeFileSync(af, JSON.stringify(a)); writeFileSync(lf, JSON.stringify(f));
    const originalExec = childProcess.execFileSync;
    const originalFetch = globalThis.fetch;
    const originalNow = Date.now;
    const originalWrite = process.stdout.write;
    let output = '';
    let dependencyRefusals = 0;
    let commands = 0;
    childProcess.execFileSync = (cmd, args) => {
        commands++;
        if (cmd === 'git') {
            if (args[0] === 'ls-remote') return `${S}\trefs/heads/main\n`;
            if (args[0] === 'rev-parse') return `${tree}\n`;
            if (args[0] === 'hash-object') return 'fe5b6c79'.padEnd(40, 'a');
            if (args[0] === 'diff') {
                if (badDependencies) { dependencyRefusals++; throw new Error('mock dependency diff refused'); }
                return '';
            }
            throw new Error(`Unexpected git command: ${args[0]}`);
        }
        if (cmd === 'gh') {
            if (args[0] === 'run') {
                assert.equal(args[1], 'download', 'no gh dispatch or mutation may be called');
                const n = Number(args[2]) - 39_200_000;
                const c = CASES[n - 1];
                const folder = args[args.indexOf('-D') + 1];
                writeFileSync(path.join(folder, `${c.suite}.receipt.json`), JSON.stringify(receipts.get(n)));
                if (c.readback === 'declared') writeFileSync(path.join(folder, `${c.suite}.readback-verdicts.json`), JSON.stringify(verdictsFor(n)));
                return '';
            }
            assert.equal(args[0], 'api');
            const route = args.find((arg) => arg.startsWith('repos/'));
            if (route.includes('/contents/')) return args.some((arg) => arg.includes('application/vnd.github.raw')) ? 'workers: 1,\nretries: 0,\nfullyParallel: false,' : blob;
            if (route.endsWith('/actions/runs') || args.some((arg) => arg.startsWith('status='))) return '';
            if (route.endsWith('/rc-gates.yml/runs')) return CASES.map((c) => JSON.stringify({ id: 39_200_000 + c.n, run_attempt: 1,
                run_started_at: new Date(NOW - 600_000).toISOString() })).join('\n');
            let m = route.match(/\/runs\/(\d+)\/attempts\/1(\/jobs)?$/);
            if (m) {
                if (m[2]) return GATE_JOBS().map((j) => JSON.stringify({ ...j, id: Number(m[1]) * 10 + j.id })).join('\n');
                return JSON.stringify({ id: Number(m[1]), run_attempt: 1, path: WORKFLOW_PATH, head_sha: S, head_branch: 'main',
                    event: 'workflow_dispatch', status: 'completed', run_started_at: new Date(NOW - 600_000).toISOString() });
            }
            m = route.match(/\/runs\/(\d+)\/artifacts$/);
            if (m) return JSON.stringify({ name: 'rwt-receipts-attempt-1', expired: false });
            m = route.match(/\/jobs\/(\d+)\/logs$/);
            if (m) return logFor(Math.floor(Number(m[1]) / 10) - 39_200_000, receipts.get(Math.floor(Number(m[1]) / 10) - 39_200_000));
            throw new Error(`Unexpected mocked API route: ${route}`);
        }
        // The only other permitted child is the repository's evaluator. Return its ACTUAL precomputed result.
        assert.ok(cmd.endsWith('/tsx'), 'unexpected external command');
        if (args.includes('--inventory')) return JSON.stringify(facts.get(CASES.find((c) => c.suite === args[args.indexOf('--inventory') + 1]).n));
        const raw = JSON.parse(readFileSync(args[args.indexOf('--receipt') + 1], 'utf8'));
        return JSON.stringify(evaluations.get(raw.suite));
    };
    syncBuiltinESMExports();
    globalThis.fetch = async (url) => ({ text: async () => String(url).endsWith('/') ? '/assets/mock.js' : `VITE_VERCEL_GIT_COMMIT_SHA:"${S}"` });
    Date.now = () => NOW;
    process.stdout.write = (chunk) => { output += String(chunk); return true; };
    try {
        const exitCode = await adapter.main(['--final', '--authority', af, '--ledger', lf]);
        return { exitCode, report: JSON.parse(output), dependencyRefusals, mockedCommands: commands };
    } finally {
        childProcess.execFileSync = originalExec; syncBuiltinESMExports();
        globalThis.fetch = originalFetch; Date.now = originalNow; process.stdout.write = originalWrite;
    }
}

test('CLI terminal control: valid observed context closes the complete fixture ledger', async () => {
    const out = await mockedFinal();
    assert.equal(out.exitCode, 0, JSON.stringify(out));
    assert.equal(out.report.final.complete, true);
    assert.equal(out.report.final.used, 30);
    assert.deepEqual(out.report.caseErrors, {});
    console.log(`CLI_TERMINAL control ${JSON.stringify(out)}`);
});

test('CLI terminal fixed: failed dependency identity returns HOLD', async () => {
    const out = await mockedFinal({ badDependencies: true });
    assert.equal(out.dependencyRefusals, 2);
    assert.equal(out.exitCode, 1, JSON.stringify(out));
    assert.equal(out.report.final.complete, false);
    assert.equal(out.report.final.outcome, 'HOLD');
    assert.ok(out.report.final.reasons.includes('dependency_identity_not_proven'));
    console.log(`CLI_TERMINAL failed_dependencies ${JSON.stringify(out)}`);
});

test('CLI terminal fixed: malformed authority budget returns HOLD', async () => {
    const out = await mockedFinal({ authorityChanges: { budget: 'unknown', firstCase: 2, allowMaintainedReadOnly: false } });
    assert.equal(out.exitCode, 1, JSON.stringify(out));
    assert.equal(out.report.final.complete, false);
    assert.equal(out.report.final.outcome, 'HOLD');
    assert.ok(out.report.final.reasons.includes('authority_missing_or_malformed'));
    console.log(`CLI_TERMINAL malformed_authority ${JSON.stringify(out)}`);
});
