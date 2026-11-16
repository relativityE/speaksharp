// @vitest-environment node
/**
 * Sam, 16 Nov (B): a diagnostic rc-gates run (`diagnostic_dast_spec`, optionally `diagnostic_release_sha`) was labelled only by
 * its step name and a workflow warning, so its all-green RWT receipt finalized as an acceptance PASS exactly as a full Gate 3
 * run's. Now the workflow sets the run scope explicitly (only the full Gate 3 step stamps `full-gate`), the receipt writer
 * records it, and only a clean `full-gate` scope may carry an acceptance PASS. Diagnostic, missing, malformed or contradictory
 * scope keeps every row and a genuine observed FAIL, but holds a PASS as INCOMPLETE. The writer is exercised for real here, so
 * the stamp is proven to reach the finalizer.
 */
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    RUN_SCOPE_ENV, finalizeReceipt, humanWorksheet, parseHumanWorksheet, requiredAutomatedRows, runScopeMeta, runScopeVerdict, type ReceiptRow,
} from '../live/helpers/rwtAcceptance';
import { RwtReceipt } from '../live/helpers/rwtJourney';

const sha = (v: string) => createHash('sha256').update(v, 'utf8').digest('hex');
const RELEASE = 'b'.repeat(40);
const REQ = '33333333-3333-4333-8333-333333333333';
const ATT = '44444444-4444-4444-8444-444444444444';
const MODEL = 'gemini-3.6-flash';
const SUITE = 'open-mic-first-session';
const J = 'journey-rec';
const STAGES = ['session_during', 'session_after_open_mic', 'share_feedback', 'analytics_inventory', 'session_pdf_export'];
const pass = (step: string): ReceiptRow => ({ step, verdict: 'PASS', detail: 'ok' });
const hold = (step: string): ReceiptRow => ({ step, verdict: 'HOLD', detail: 'pending' });
const humans = ['open_mic_coaching_relevant', 'open_mic_uh_detected'].map((id): ReceiptRow => ({
    step: `human: ${id}`, verdict: 'HUMAN', detail: 'named human RWT observation', evidence: { observationId: id, runbookRow: 'row', passCriterion: 'c', recorded: 'pending' },
}));
const binding = { expectedRequestSha256: sha(REQ), expectedAttemptSha256: sha(ATT), expectedProduct: 'open_mic', expectedConfiguredModel: MODEL, expectedOutcome: 'success' };
const chainRow: ReceiptRow = { step: 'feedback diagnostic chain', verdict: 'HOLD', detail: 'the chain is incomplete',
    evidence: { reasons: 'telemetry_not_received', echoMismatches: 0, ...binding } };
/** Every automated row of an all-green run (base_q4 HOLD by design), the chain row settled by a bound received PASS. */
const greenRows = (): ReceiptRow[] => [
    pass('telemetry decodable'), pass('signup-stage telemetry (user class)'), pass('receipt content-free'), hold('signup-stage telemetry received'),
    pass('journey telemetry (canary class)'), hold('journey telemetry received'),
    ...requiredAutomatedRows(SUITE)!.product.filter((s) => s !== 'feedback diagnostic chain').map((s) => (s === 'base_q4 primary' ? hold(s) : pass(s))),
    chainRow, ...humans,
];
const receipt = (meta: Record<string, unknown>, rows = greenRows()) => ({
    suite: SUITE, release: RELEASE, meta: { fixtureKind: 'synthetic', ...meta }, rows,
    readback: { journeys: [{ journeyId: J, stages: STAGES }], reportedJourneyIds: ['other'], missingBindings: [] },
});
const fillHumans = (text: string) => text.split('\n').map((l) => (l.startsWith('| `open_mic_') ? l.replace(/\| {2}\| {2}\|$/, '| PASS | PO · 2026-09-28 |') : l)).join('\n');
const worksheet = (r: { rows: ReceiptRow[] }) => parseHumanWorksheet(fillHumans(humanWorksheet(SUITE, RELEASE, [J, 'other'], r.rows)));
const readback = { suite: SUITE, release: RELEASE, journeys: [{ journeyId: J, stages: STAGES, verdict: 'QUALIFIED' }], missingBindings: [],
    coachingDiagnostic: { verdict: 'PASS', reasons: [], release: RELEASE,
        expected: { requestSha256: sha(REQ), attemptSha256: sha(ATT), product: 'open_mic', configuredModel: MODEL, outcome: 'success' } } };
const finalize = (meta: Record<string, unknown>, rows?: ReceiptRow[]) => {
    const r = receipt(meta, rows);
    return finalizeReceipt(r, worksheet(r), readback);
};
const FULL = { runScope: 'full-gate', diagnosticSpec: null, diagnosticGrepSha256: null, diagnosticReleaseSource: null };
const GREP = 'Free user with an UNUSED Private sample';
const DIAGNOSTIC = { runScope: 'diagnostic', diagnosticSpec: 'tests/live/rwt-open-mic-first-session.live.spec.ts', diagnosticGrepSha256: sha(GREP), diagnosticReleaseSource: 'diagnostic_release_sha' };

describe('the finalizer: only a full Gate 3 scope may carry an acceptance PASS', () => {
    it('a properly scoped full-gate receipt still finalizes PASS (the normal acceptance path)', () => {
        expect(finalize(FULL)).toMatchObject({ status: 'final', finalAcceptance: 'PASS', runScope: { qualifies: true } });
    });
    it('CONTROL: an all-green DIAGNOSTIC receipt keeps its observations but is never an acceptance PASS', () => {
        const out = finalize(DIAGNOSTIC);
        expect(out).toMatchObject({ status: 'final', finalAcceptance: 'INCOMPLETE', automatedRowsAllPass: true, runScope: { qualifies: false } });
        expect(out.runScope!.reason).toContain('diagnostic single-spec run');
        expect(out.rows.filter((r) => r.verdict === 'PASS').length).toBe(finalize(FULL).rows.filter((r) => r.verdict === 'PASS').length);
    });
    it('CONTROL: an old receipt with no recorded scope cannot qualify', () => {
        const out = finalize({});
        expect(out.finalAcceptance).toBe('INCOMPLETE');
        expect(out.runScope!.reason).toContain('no recorded run scope');
    });
    it.each([
        ['malformed (case)', { runScope: 'Full-Gate' }],
        ['malformed (other word)', { runScope: 'yes' }],
        ['malformed (not a string)', { runScope: true }],
        ['contradictory: full-gate with a diagnostic spec', { ...FULL, diagnosticSpec: 'tests/live/x.live.spec.ts' }],
        ['contradictory: full-gate with a diagnostic grep', { ...FULL, diagnosticGrepSha256: sha(GREP) }],
        ['contradictory: full-gate with a caller-chosen release', { ...FULL, diagnosticReleaseSource: 'diagnostic_release_sha' }],
    ])('CONTROL: a %s scope cannot produce an acceptance PASS', (_name, meta) => {
        expect(finalize(meta).finalAcceptance).toBe('INCOMPLETE');
    });
    it('a genuine observed FAIL stays FAIL under any scope', () => {
        const failing = greenRows().map((r) => (r.step === 'telemetry decodable' ? { ...r, verdict: 'FAIL' as const, detail: 'observed' } : r));
        for (const meta of [FULL, DIAGNOSTIC, {}, { runScope: 'yes' }]) expect(finalize(meta, failing).finalAcceptance).toBe('FAIL');
    });
});

describe('the scope is read exactly as the workflow set it, never inferred', () => {
    it('full-gate only when RWT_RUN_SCOPE says so', () => {
        expect(runScopeMeta({ [RUN_SCOPE_ENV]: 'full-gate' })).toEqual(FULL);
        expect(runScopeVerdict(runScopeMeta({ [RUN_SCOPE_ENV]: 'full-gate' })).qualifies).toBe(true);
    });
    it('CONTROL: no scope set, even with no diagnostic inputs and a matching release, is not full-gate', () => {
        const meta = runScopeMeta({ EXPECTED_RELEASE_SHA: RELEASE, DIAGNOSTIC_SPEC: '', DIAGNOSTIC_GREP: '' });
        expect(meta.runScope).toBeNull();
        expect(runScopeVerdict(meta).qualifies).toBe(false);
    });
    it('a diagnostic run records its spec, grep and release source', () => {
        expect(runScopeMeta({ [RUN_SCOPE_ENV]: 'diagnostic', DIAGNOSTIC_SPEC: DIAGNOSTIC.diagnosticSpec, DIAGNOSTIC_GREP: GREP, DIAGNOSTIC_RELEASE: RELEASE }))
            .toEqual(DIAGNOSTIC);
    });
    it('CONTROL (content-free): the grep is recorded only as its SHA-256, and a spec that is not a plain test path as `unrecognized`', () => {
        const meta = runScopeMeta({ [RUN_SCOPE_ENV]: 'diagnostic', DIAGNOSTIC_SPEC: 'tests/live/../../etc/x.spec.ts', DIAGNOSTIC_GREP: GREP });
        expect(JSON.stringify(meta)).not.toContain(GREP);
        expect(meta.diagnosticGrepSha256).toMatch(/^[0-9a-f]{64}$/);
        for (const spec of ['tests/live/../../etc/x.spec.ts', '/tmp/x.spec.ts', 'tests/live/x.spec.ts; rm -rf', 'not a path'])
            expect(runScopeMeta({ DIAGNOSTIC_SPEC: spec }).diagnosticSpec).toBe('unrecognized');
    });
});

/** The real writer (RwtReceipt.write) in a scratch directory: its file is what rc-gates uploads and `rwt:finalize` reads. */
describe('the receipt writer stamps the scope, and the stamp reaches the finalizer', () => {
    const saved = { cwd: process.cwd(), env: { ...process.env } };
    let dir = '';
    beforeEach(() => {
        dir = mkdtempSync(path.join(tmpdir(), 'rwt-scope-'));
        process.chdir(dir);
        process.env.EXPECTED_RELEASE_SHA = RELEASE;
        for (const k of [RUN_SCOPE_ENV, 'DIAGNOSTIC_SPEC', 'DIAGNOSTIC_GREP', 'DIAGNOSTIC_RELEASE']) delete process.env[k];
    });
    afterEach(() => {
        process.chdir(saved.cwd);
        process.env = { ...saved.env };
    });
    const writeAndFinalize = () => {
        const r = new RwtReceipt(SUITE);
        r.meta.fixtureKind = 'synthetic';
        for (const row of greenRows()) r.row(row.step, row.verdict, row.detail, row.evidence);
        r.write({ status: 'passed' } as never, { journeys: [{ journeyId: J, stages: STAGES }], reportedJourneyIds: ['other'], missingBindings: [] } as never, ['canary']);
        const written = JSON.parse(readFileSync(path.join(dir, 'test-results', 'rwt', `${SUITE}.receipt.json`), 'utf8'));
        const sheet = parseHumanWorksheet(fillHumans(readFileSync(path.join(dir, 'test-results', 'rwt', `${SUITE}.human-worksheet.md`), 'utf8')));
        return { written, final: finalizeReceipt(written, sheet, readback) };
    };
    it('full Gate 3 step: the written receipt carries full-gate and finalizes PASS', () => {
        process.env[RUN_SCOPE_ENV] = 'full-gate';
        const { written, final } = writeAndFinalize();
        expect(written.meta.runScope).toBe('full-gate');
        expect(final).toMatchObject({ status: 'final', finalAcceptance: 'PASS' });
    });
    it('CONTROL: diagnostic step: the written receipt says diagnostic, its own acceptance is not PASS, and it finalizes INCOMPLETE', () => {
        Object.assign(process.env, { [RUN_SCOPE_ENV]: 'diagnostic', DIAGNOSTIC_SPEC: DIAGNOSTIC.diagnosticSpec, DIAGNOSTIC_GREP: GREP, DIAGNOSTIC_RELEASE: RELEASE });
        const { written, final } = writeAndFinalize();
        expect(written.meta).toMatchObject(DIAGNOSTIC);
        expect(readFileSync(path.join(dir, 'test-results', 'rwt', `${SUITE}.receipt.json`), 'utf8')).not.toContain(GREP);
        expect(written.acceptance).not.toBe('PASS');
        expect(final).toMatchObject({ finalAcceptance: 'INCOMPLETE', automatedRowsAllPass: true });
    });
    it('CONTROL: no scope in the environment: the written receipt records none and never finalizes PASS', () => {
        const { written, final } = writeAndFinalize();
        expect(written.meta.runScope).toBeNull();
        expect(final.finalAcceptance).toBe('INCOMPLETE');
    });
});
