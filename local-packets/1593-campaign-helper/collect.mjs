// #1593 campaign helper — App Dev's READ-ONLY integration adapter for the Browser PM's decision table
// (`../1593-bootstrap/contract.mjs`, vendored byte-identical from ecd2c048, blob fe5b6c79).
//
// It gathers the facts `assess()` needs from their real sources, asks `assess()` for GO/HOLD, and PRINTS the exact
// dispatch command for the case. It never dispatches, writes, deletes, claims, cleans up or creates a receipt. Every
// fact it cannot prove is passed as missing, so the contract holds instead of guessing.
//
// Usage (read-only):  node local-packets/1593-campaign-helper/collect.mjs --case <1..15> --authority <authority.json> --ledger <ledger.json>
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { assess, CASE_MAXIMA } from '../1593-bootstrap/contract.mjs';

export const REPO = 'relativityE/speaksharp';
export const BASE_URL = 'https://speaksharp-public.vercel.app';
export const WRITES_ACK = 'RWT-DISPOSABLE-ACCOUNT-WRITES';
export const CANARY_ACK = 'RWT-CANARY-CLAIM-RUN-OWNED';
export const REFLEX_MS = 500;
/** Files whose exact bytes at S define the effective run configuration (bound into configDigest). */
export const CONFIG_FILES = Object.freeze(['.github/workflows/rc-gates.yml', 'playwright.deployed-live.config.ts']);

/** The 15 selected cases (#1593 revision 2; App maxima 6243875268). Spec + grep select exactly one test each. */
export const CASES = Object.freeze([
    { n: 1, spec: 'tests/live/rwt-open-mic-first-session.live.spec.ts', grep: 'a new person completes a first Open Mic session' },
    { n: 2, spec: 'tests/live/rwt-focus-points-session.live.spec.ts', grep: 'PO corpus' },
    { n: 3, spec: 'tests/live/rwt-focus-points-partial.live.spec.ts', grep: 'partial fixture' },
    { n: 4, spec: 'tests/live/rwt-pending-start-navigation.live.spec.ts', grep: 'leaving during a cold Start' },
    { n: 5, spec: 'tests/live/rwt-save-retry-recovery.live.spec.ts', grep: 'request lost' },
    { n: 6, spec: 'tests/live/rwt-save-retry-recovery.live.spec.ts', grep: 'response lost' },
    { n: 7, spec: 'tests/live/rwt-feedback-association-boundaries.live.spec.ts', grep: 'feedback selected for an older take' },
    { n: 8, spec: 'tests/live/rwt-feedback-association-boundaries.live.spec.ts', grep: 'No session feedback' },
    { n: 9, spec: 'tests/live/rwt-abandon-and-two-tabs.live.spec.ts', grep: 'navigate away mid-recording' },
    { n: 10, spec: 'tests/live/rwt-abandon-and-two-tabs.live.spec.ts', grep: 'close the tab mid-recording' },
    { n: 11, spec: 'tests/live/rwt-abandon-and-two-tabs.live.spec.ts', grep: 'one account, two places' },
    { n: 12, spec: 'tests/live/rwt-adverse-mic-model.live.spec.ts', grep: 'mic denied' },
    { n: 13, spec: 'tests/live/rwt-adverse-mic-model.live.spec.ts', grep: 'model download fails' },
    { n: 14, spec: 'tests/live/rwt-adverse-mic-model.live.spec.ts', grep: 'offline mid-download' },
    { n: 15, spec: 'tests/live/rwt-products-navigation.live.spec.ts', grep: 'an existing user signs in' },
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

const sha256 = (s) => createHash('sha256').update(s).digest('hex');

/** The effective-configuration record at S and its digest: exact config-file blobs, every case spec blob, bindings. */
export function configRecord({ releaseSha, blobs, bindings }) {
    const record = { releaseSha, baseUrl: BASE_URL, reflexMs: REFLEX_MS, gate: 'gate-3-dast',
        workers: bindings.workers, retries: bindings.retries,
        blobs: Object.fromEntries(Object.entries(blobs).sort(([a], [b]) => a.localeCompare(b))) };
    return { record, digest: sha256(JSON.stringify(record)) };
}

/** Main / RC gates / production activity from run lists: anything in progress or queued is NOT idle. */
export function classifyActivity(runs) {
    if (!Array.isArray(runs)) return 'unknown';
    return runs.some((r) => r.status !== 'completed') ? 'busy' : 'idle';
}

/**
 * Rows whose failure (or absence) is a DOMINANT stop — identity, authority, privacy or cleanup — which no ordinary
 * continuation disposition can override (SPEC "dominant stop"). Product rows such as the coaching budget are ordinary.
 */
export const DOMINANT_ROWS = Object.freeze(['run-owned signup', 'canary claim in fresh login', 'run-owned cleanup', 'telemetry decodable']);

/** Parse one Gate 3 job log: the content-free RWT receipt and the run-owned cleanup line. Nothing else is trusted. */
export function parseReceiptLog(log, { readOnly = false } = {}) {
    const text = String(log ?? '');
    const line = text.split('\n').find((l) => l.includes('RWT_RECEIPT {'));
    let receipt = null;
    try { receipt = line ? JSON.parse(line.slice(line.indexOf('RWT_RECEIPT ') + 'RWT_RECEIPT '.length)) : null; } catch { receipt = null; }
    const rows = Array.isArray(receipt?.rows) ? receipt.rows : [];
    const verdict = (step) => rows.find((r) => r.step === step)?.verdict ?? null;
    const cleanupMatch = /RUN_OWNED_CLEANUP cleanup_verified residue=(\d+)\b/.exec(text);
    const budget = rows.find((r) => r.step === 'coaching request budget');
    const requests = Number.isSafeInteger(budget?.evidence?.browserRequests) ? budget.evidence.browserRequests : null;
    const dominantStop = readOnly
        ? rows.some((r) => DOMINANT_ROWS.includes(r.step) && r.verdict === 'FAIL')
        : DOMINANT_ROWS.some((step) => verdict(step) !== 'PASS');
    const verdicts = rows.map((r) => r.verdict);
    const outcome = !receipt ? null : verdicts.includes('FAIL') ? 'FAIL' : verdicts.includes('HOLD') ? 'HOLD' : 'PASS';
    return {
        receipt, release: typeof receipt?.release === 'string' ? receipt.release : null,
        receiptDigest: line ? sha256(line.slice(line.indexOf('RWT_RECEIPT '))) : null,
        // Numeric zero only: the contract rejects a string "0", an attempted cleanup or a missing line.
        residue: cleanupMatch ? Number(cleanupMatch[1]) : null,
        requests, requestsEmitted: requests !== null, dominantStop, outcome,
    };
}

/** A ledger entry for a finished case, from its actual run + parsed receipt. Review/continuation are operator inputs. */
export function ledgerEntry({ caseNumber, runId, runAttempt, conclusionTerminal, parsed, authority, reviewed, continuationApproved }) {
    const base = { caseNumber, runId: String(runId), runAttempt, campaignId: authority.campaignId,
        releaseSha: parsed.release, configDigest: authority.configDigest };
    return {
        ...base, receiptDigest: parsed.receiptDigest, terminal: conclusionTerminal === true,
        reviewed: reviewed === true, mandatoryReadbackComplete: parsed.receipt !== null,
        dominantStop: parsed.dominantStop, outcome: parsed.outcome, continuationApproved: continuationApproved === true,
        requests: parsed.requests,
        cleanup: caseFor(caseNumber)?.readOnly ? null : {
            kind: 'run_owned_cleanup', verified: parsed.residue !== null, residue: parsed.residue,
            ownerScope: 'this_run_only', scopeDigest: authority.cleanupScopeDigest, ...base,
        },
    };
}

/** Case 1's explicit campaign-start preflight (never a cleanup receipt). Every flag is evidence the caller proved. */
export function campaignStartPreflight({ authority, explicitFirstDispatch, noEarlierAttempt, priorCampaignCleanupReconciled }) {
    return { kind: 'campaign_start_preflight', verified: true, campaignId: authority.campaignId,
        releaseSha: authority.releaseSha, configDigest: authority.configDigest, previousReceipt: null,
        explicitFirstDispatch: explicitFirstDispatch === true, noEarlierAttempt: noEarlierAttempt === true,
        priorCampaignCleanupReconciled: priorCampaignCleanupReconciled === true };
}

// ── I/O (read-only) ────────────────────────────────────────────────────────────────────────────────────────────────
const run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const ghJson = (args) => JSON.parse(run('gh', args));

export async function servedSha() {
    const html = await (await fetch(`${BASE_URL}/`)).text();
    const found = new Set();
    for (const js of new Set(html.match(/\/assets\/[^"]+\.js/g) ?? [])) {
        const body = await (await fetch(`${BASE_URL}${js}`)).text();
        for (const m of body.matchAll(/VITE_VERCEL_GIT_COMMIT_SHA:"([0-9a-f]{40})"/g)) found.add(m[1]);
    }
    return found.size === 1 ? [...found][0] : null;
}

export function observeAt(releaseSha) {
    const main = run('git', ['ls-remote', `https://github.com/${REPO}.git`, 'refs/heads/main']).split('\t')[0];
    const blob = (path) => run('gh', ['api', `repos/${REPO}/contents/${path}?ref=${releaseSha}`, '--jq', '.sha']).trim();
    const raw = (path) => run('gh', ['api', `repos/${REPO}/contents/${path}?ref=${releaseSha}`, '-H', 'Accept: application/vnd.github.raw']);
    const bindings = bindingsFromPlaywrightConfig(raw('playwright.deployed-live.config.ts'));
    const blobs = Object.fromEntries([...CONFIG_FILES, ...new Set(CASES.map((c) => c.spec))].map((p) => [p, blob(p)]));
    const runs = (extra) => ghJson(['run', 'list', '--repo', REPO, ...extra, '--limit', '20', '--json', 'status,name,databaseId']);
    const mainRuns = runs(['--branch', 'main']);
    const rcRuns = runs(['--workflow', 'rc-gates.yml']);
    const prodRuns = [...runs(['--workflow', 'deploy-supabase-edge-release.yml']), ...runs(['--workflow', 'canary.yml']),
        ...runs(['--workflow', 'apply-exact-allowlisted-migration.yml'])];
    return { mainSha: main, bindings, config: configRecord({ releaseSha, blobs, bindings }),
        main: classifyActivity(mainRuns), rcGates: classifyActivity(rcRuns), production: classifyActivity(prodRuns) };
}

export function readGateLog(runId) {
    const jobs = ghJson(['run', 'view', String(runId), '--repo', REPO, '--json', 'jobs,attempt,conclusion,status']);
    const job = jobs.jobs.find((j) => j.name.startsWith('Gate 3'));
    const log = job ? run('gh', ['api', `repos/${REPO}/actions/jobs/${job.databaseId}/logs`]) : '';
    return { log, attempt: jobs.attempt, terminal: jobs.status === 'completed' };
}

// ── CLI ────────────────────────────────────────────────────────────────────────────────────────────────────────────
export async function main(argv = process.argv.slice(2)) {
    const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
    const n = Number(arg('--case'));
    const authority = JSON.parse(readFileSync(arg('--authority'), 'utf8'));
    const ledgerFile = JSON.parse(readFileSync(arg('--ledger'), 'utf8'));
    const now = Date.now();
    const o = observeAt(authority.releaseSha);
    const served = await servedSha();
    const observation = { verified: o.bindings.ok, observedAt: now, validUntil: now + 5 * 60_000, mainSha: o.mainSha,
        servedSha: served, workflowSha: o.mainSha /* --ref main runs main's workflow at dispatch */,
        configDigest: o.config.digest, main: o.main, rcGates: o.rcGates, production: o.production };
    const entries = (ledgerFile.entries ?? []).map((e) => {
        const g = readGateLog(e.runId);
        const parsed = parseReceiptLog(g.log, { readOnly: caseFor(e.caseNumber)?.readOnly });
        return ledgerEntry({ caseNumber: e.caseNumber, runId: e.runId, runAttempt: g.attempt, conclusionTerminal: g.terminal,
            parsed, authority, reviewed: e.reviewed, continuationApproved: e.continuationApproved });
    });
    const ledger = { verified: true, campaignId: authority.campaignId, entries, inFlight: ledgerFile.inFlight ?? [],
        unresolvedCleanup: ledgerFile.unresolvedCleanup ?? [] };
    const bootstrap = n === 1 ? campaignStartPreflight({ authority, ...ledgerFile.bootstrap }) : null;
    const decision = assess({ caseNumber: n, now, authority, observation, ledger, bootstrap,
        previousReceipt: n === 1 ? null : entries.at(-1) ?? undefined, invocation: invocationFor(n) });
    const out = { case: n, decision, observation: { ...observation, bindings: o.bindings, configRecord: o.config.record },
        missingRequestCounts: entries.filter((e) => e.requests === null).map((e) => e.caseNumber),
        dispatch: decision.eligible ? dispatchArgv(n) : null };
    process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
    return decision.eligible ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exitCode = await main();
