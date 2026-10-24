// @vitest-environment node
/**
 * #1539 F1 (PM ACCEPT 5873315750) — THE READBACK QUALIFIER'S MAIN FLOW, EXECUTED.
 *
 * Until now no test ran `scripts/telemetry-readback-qualification.mts`: it was type-checked, or matched as source text,
 * and the workflow-step test stubbed `pnpm`. Its HogQL selection, identity and boot resolution and — above all — its row
 * decoding were first exercised by a paid Production rehearsal. Here the REAL script runs as a child process against a
 * local HTTP stand-in for PostHog's query endpoint that serves recorded rows. Nothing in the script is mocked: the fake
 * answers only the transport, keyed on which question the script asked.
 */
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ACQUISITION_COLUMNS, READBACK_COLUMNS, decodeByColumns, selectAliases } from '../../frontend/src/services/telemetry/readbackColumns';
import { buildReadbackQuery } from '../../frontend/src/services/telemetry/bootScopedReceipts';
import { OPEN_MIC_POST_STOP_CHAIN, QUALIFICATION_STAGES, REQUIRED_EVENT_FAMILIES } from '../../frontend/src/services/telemetry/completenessGate';

const ROOT = resolve(__dirname, '../..');
const RELEASE = 'a'.repeat(40);
const IDENTITY = 'usr_v1_fixture';
const JOURNEY = 'journey-1';
const BOOT = 'boot-1';
const MODEL = 'v2:base.en';

type Row = { event: string; journey_id?: string | null; boot_id?: string | null; timestamp?: string } & Record<string, unknown>;

/** One recorded event's value for a named column (row identity defaults, then the event's own properties). */
const cell = (r: Row, i: number, c: string): unknown => (c === 'timestamp' ? (r.timestamp ?? `2026-09-28T12:00:${String(i).padStart(2, '0')}Z`)
    : c === 'journey_id' ? (r.journey_id ?? JOURNEY) : c === 'boot_id' ? (r.boot_id ?? BOOT) : (r[c] ?? null));

/**
 * PostHog's HogQL response shape, built the way PostHog builds it: `columns` are the aliases of the query it RECEIVED, and
 * each result row is positional in that order. So a query-side mutant sees exactly what production would.
 */
const respond = (hogql: string, rows: Row[], opts: { omitColumns?: boolean } = {}) => {
    // An unaliased `properties.x` item comes back named `x`, as HogQL names a property access.
    const columns = selectAliases(hogql).map((c) => c.replace(/^properties\./, ''));
    const results = rows.map((r, i) => columns.map((c) => cell(r, i, c)));
    return opts.omitColumns ? { results } : { columns, results };
};

/** The pre-journey receipts every journey needs, from the same boot, under the pre-product journey. */
const preJourney = (): Row[] => [
    { event: 'telemetry_positive_control', journey_id: 'pre', transport_initialized: true },
    { event: 'account_identified', journey_id: 'pre' },
];

/** A complete, honest feedback-only journey (the post-reload journey of the v12 order). */
const feedbackJourney = (): Row[] => [
    ...preJourney(),
    { event: 'feedback_dialog_opened' }, { event: 'feedback_field' },
    { event: 'feedback_submit', outcome: 'attempted', submit_seq: 1, producer_ts: 100 },
    { event: 'feedback_submit', outcome: 'storage_ok', submit_seq: 1, producer_ts: 200 },
];

/** A complete, honest recording journey for `session_during`, mirroring qualificationStages.test's reviewed shapes. */
const recordingJourney = (): Row[] => {
    const families = new Set<string>([...REQUIRED_EVENT_FAMILIES, ...QUALIFICATION_STAGES.find((s) => s.stage === 'session_during')!.requiredFamilies]);
    const rows: Row[] = preJourney();
    for (const family of families) {
        if (family === 'telemetry_positive_control' || family === 'account_identified') continue;
        if (family === 'session_started') rows.push({ event: family, attempt_id: 'attempt-1', attempt_seq: 1, candidate_id: MODEL, engine: 'private', runtime_version: 'r1' });
        else if (family === 'session_saved') rows.push({ event: family, attempt_id: 'attempt-1', attempt_seq: 1, candidate_id: MODEL, engine: 'private', runtime_version: 'r1' });
        else if (family === 'private_model_acquisition_success') rows.push({ event: family, acquired_candidate_id: MODEL, candidate_id: MODEL, engine: 'private', runtime_version: 'r1' });
        else if (family === 'private_model_acquisition_start') rows.push({ event: family, expected_candidate_id: MODEL, candidate_id: MODEL, engine: 'private', runtime_version: 'r1' });
        else if (family === 'recording_state') rows.push({ event: family, to_state: 'RECORDING', candidate_id: MODEL, engine: 'private', runtime_version: 'r1' });
        else if (family === 'practice_loop') rows.push({ event: family, phase: 'rendered', review_surface: 'coaching_verdict', suggestions_present: true, attempt_id: 'attempt-1' });
        else if (family === 'transcript_authority') rows.push({ event: family, stage: 'review_rendered', transcript_visibly_present: true, digests_match: true });
        else if (family === 'model_attribution_receipt') rows.push({ event: family, subject_boot_id: BOOT, subject_journey_id: JOURNEY, subject_attempt_id: 'attempt-1', subject_attempt_seq: 1, attribution_status: 'verified' });
        else if (family === 'stage_latency') OPEN_MIC_POST_STOP_CHAIN.forEach((stage) => rows.push({ event: family, stage, attempt_id: 'attempt-1' }));
        else rows.push({ event: family, candidate_id: MODEL, engine: 'private', runtime_version: 'r1' });
    }
    // `session_during` requires the acquired candidate identity; a fresh account acquires its model in this journey.
    if (!rows.some((r) => r.event === 'private_model_acquisition_success')) {
        rows.push({ event: 'private_model_acquisition_success', acquired_candidate_id: MODEL, candidate_id: MODEL, engine: 'private', runtime_version: 'r1' });
    }
    return rows;
};

/** A measured cold first download (cache miss over the network), by name. */
const coldDownload = (): Row => ({
    event: 'private_model_acquisition_success', model_identity: MODEL, acquired_candidate_id: MODEL, cache_result: 'miss',
    measurement_completeness: 'complete', measurement_reason_code: null, network_used: true, download_ms: 4200, init_ms: 900,
    total_ms: 5100, network_bytes: 145_000_000, partial_download_ms: null,
});

/** What the stand-in holds, per question the script asks. Set by each case. */
let answer: { readback: Row[]; acquisition: Row[]; omitColumns?: boolean } = { readback: [], acquisition: [] };
let server: Server;
let host = '';


/** Independent fixture schema: not imported from the implementation under test. */
const ORACLE_COLUMNS = {
    user: ['event', 'received'],
    identity: ['distinct_id'],
    coaching: ['event', 'diagnostic_request_id', 'diagnostic_attempt_id', 'outcome', 'product', 'configured_model',
        'observed_model', 'status', 'provider_status', 'client_release_id', 'coaching_diagnostic_id', 'source',
        'provider_attempts', 'uuid', 'client_attempt'],
    readback: ['event', 'timestamp', 'journey_id', 'boot_id', 'outcome', 'to_state', 'acquired_candidate_id',
        'expected_candidate_id', 'candidate_id', 'engine', 'runtime_version', 'attempt_id', 'attempt_seq',
        'subject_boot_id', 'subject_journey_id', 'subject_attempt_id', 'subject_attempt_seq', 'attribution_status',
        'stage', 'transcript_visibly_present', 'digests_match', 'transport_initialized', 'flush_outcome', 'dropped_count',
        'comparison_evidence_document_id', 'review_surface', 'phase', 'suggestions_present', 'action', 'action_seq',
        'intended_route', 'route_class', 'link_state', 'submit_seq', 'error_category', 'producer_ts', 'persisted',
        'diagnostic_request_id', 'origin_attempt_id', 'end_reason', 'origin_boot_id', 'intent_kind', 'intent_outcome',
        'step', 'option_selected'],
    acquisition: ['model_identity', 'acquired_candidate_id', 'cache_result', 'measurement_completeness',
        'measurement_reason_code', 'network_used', 'download_ms', 'init_ms', 'total_ms', 'network_bytes', 'partial_download_ms'],
} as const;
type Shape = keyof typeof ORACLE_COLUMNS;
type ResponseFixture = { columns?: string[]; results: unknown[]; hasMore?: boolean };
let responseMutation: { kind: Shape; edit: (reply: ResponseFixture) => ResponseFixture } | null = null;
let queryDerivedResponse = false;
let responseStatus = 200;
let malformedJson = false;
let stalledResponse: { kind: Shape; mode: 'headers' | 'body' | 'progressing-body' } | null = null;
const seenQueries: Array<{ kind: Shape; sql: string }> = [];
const queryKind = (sql: string): Shape => /SELECT DISTINCT/.test(sql) ? 'identity'
    : /count\(\)/.test(sql) ? 'user'
        : /event IN \('ai_coaching_diagnostic'/.test(sql) ? 'coaching'
            : /WHERE event = 'private_model_acquisition_success'/.test(sql) ? 'acquisition' : 'readback';
const requestId = '11111111-1111-4111-8111-111111111111';
const diagnosticAttempt = '22222222-2222-4222-8222-222222222222';
const digest = (s: string) => createHash('sha256').update(s).digest('hex');
const coachingExpectation = { requestSha256: digest(requestId), attemptSha256: digest(diagnosticAttempt),
    product: 'open_mic', configuredModel: 'fixture-model', outcome: 'success' };
const coachingRows = (): Record<string, unknown>[] => [
    { event: 'ai_coaching_diagnostic', diagnostic_request_id: requestId, diagnostic_attempt_id: diagnosticAttempt,
        outcome: 'success', product: 'open_mic', configured_model: 'fixture-model', observed_model: 'fixture-model',
        status: 200, provider_status: 200, client_release_id: RELEASE, source: 'fresh', provider_attempts: 1,
        uuid: '33333333-3333-4333-8333-333333333333', client_attempt: 1 },
    { event: 'feedback_submit', outcome: 'storage_ok', coaching_diagnostic_id: requestId },
];
beforeEach(() => {
    responseMutation = null; queryDerivedResponse = false; responseStatus = 200; malformedJson = false;
    stalledResponse = null;
    seenQueries.length = 0;
});

beforeAll(async () => {
    server = createServer((req, res) => {
        let body = '';
        req.on('data', (c) => { body += c; });
        req.on('end', () => {
            const hogql = String((JSON.parse(body || '{}') as { query?: { query?: string } }).query?.query ?? '');
            const kind = queryKind(hogql);
            seenQueries.push({ kind, sql: hogql });
            if (stalledResponse?.kind === kind) {
                if (stalledResponse.mode === 'headers') return;
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.flushHeaders();
                if (stalledResponse.mode === 'progressing-body') {
                    const interval = setInterval(() => { res.write(' '); }, 20);
                    res.on('close', () => clearInterval(interval));
                }
                return;
            }
            const columns = [...ORACLE_COLUMNS[kind]];
            const rows = kind === 'identity' ? [{ distinct_id: IDENTITY }]
                : kind === 'user' ? [{ event: 'recording_state', received: 1 }]
                    : kind === 'coaching' ? coachingRows()
                        : kind === 'acquisition' ? answer.acquisition : answer.readback;
            let reply: { columns?: string[]; results: unknown[]; hasMore?: boolean } = {
                columns, results: rows.map((r, i) => columns.map((c) => cell(r as Row, i, c))),
            };
            // The normal oracle is frozen independently of the production column lists/query.
            // Query-mutant historical cases alone model a response in the query's changed order.
            if (queryDerivedResponse) reply = respond(hogql, rows as Row[], answer);
            if (answer.omitColumns && kind !== 'identity') delete reply.columns;
            if (responseMutation?.kind === kind) reply = responseMutation.edit(reply);
            res.writeHead(responseStatus, { 'Content-Type': 'application/json' });
            res.end(malformedJson ? '{' : JSON.stringify(reply));
        });
    });
    await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
    host = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((ok) => server.close(() => ok())));

/**
 * Run the REAL qualifier with the installed tsx loader. Using Node directly avoids a launcher child surviving timeout.
 * ASYNC on purpose: the stand-in server
 * lives in this process, so a synchronous spawn would block the event loop that has to answer the child's requests.
 */
const qualify = (stages: string, opts: { acquisition?: boolean; script?: string; attempts?: string; shape?: Shape; queryTimeoutMs?: string; killAfterMs?: number } = {}) => new Promise<{
    status: number | null; out: string; evidence: Record<string, unknown> | null; acquisition: Record<string, unknown> | null;
}>((done) => {
    const child = spawn(process.execPath, ['--import', 'tsx', opts.script ?? 'scripts/telemetry-readback-qualification.mts',
        '--release-sha', RELEASE, '--journey-id', JOURNEY, '--traffic-type', opts.shape === 'user' ? 'user' : 'canary',
        ...(opts.queryTimeoutMs === undefined ? [] : ['--query-timeout-ms', opts.queryTimeoutMs])], {
        cwd: ROOT,
        detached: process.platform !== 'win32',
        env: {
            PATH: process.env.PATH, HOME: process.env.HOME,
            POSTHOG_API_HOST: host, POSTHOG_PROJECT_ID: '1', POSTHOG_PERSONAL_API_KEY: 'fixture-not-a-secret',
            QUALIFICATION_STAGES: stages,
            ...(opts.acquisition ? { TELEMETRY_READBACK_ACQUISITION_RECEIPT: '1' } : {}),
            ...(opts.attempts ? { QUALIFICATION_ATTEMPT_IDS: opts.attempts } : {}),
            ...(opts.shape === 'user' ? { TELEMETRY_READBACK_USER_STAGE_REPORT: '1' } : {}),
            ...(opts.shape === 'coaching' ? { TELEMETRY_READBACK_COACHING_DIAGNOSTIC: '1', COACHING_DIAGNOSTIC_EXPECTATION: JSON.stringify(coachingExpectation) } : {}),
        },
    });
    let out = '';
    child.stdout.on('data', (c) => { out += c; });
    child.stderr.on('data', (c) => { out += c; });
    const kill = setTimeout(() => {
        if (process.platform !== 'win32' && child.pid) {
            try { process.kill(-child.pid, 'SIGKILL'); return; } catch { /* Child may already have exited. */ }
        }
        child.kill('SIGKILL');
    }, opts.killAfterMs ?? 60_000);
    child.on('close', (status) => {
        clearTimeout(kill);
        done(parse(status, out));
    });
});

const parse = (status: number | null, out: string) => {
    // Acquisition is checked after the family receipt; a later HOLD is the terminal evidence.
    const evidenceLine = out.split('\n').findLast((l) => l.startsWith('TELEMETRY_READBACK_QUALIFICATION_EVIDENCE '));
    const acquisitionLine = out.split('\n').find((l) => l.startsWith('ACQUISITION_RECEIPT '));
    return {
        status, out,
        evidence: evidenceLine ? JSON.parse(evidenceLine.slice('TELEMETRY_READBACK_QUALIFICATION_EVIDENCE '.length)) as Record<string, unknown> : null,
        acquisition: acquisitionLine ? JSON.parse(acquisitionLine.slice('ACQUISITION_RECEIPT '.length)) as Record<string, unknown> : null,
    };
};

describe('the real qualifier, end to end against recorded HogQL rows', () => {
    it('QUALIFIED: a complete recording journey with a measured cold first download', async () => {
        answer = { readback: recordingJourney(), acquisition: [coldDownload()] };
        const r = await qualify('session_during', { acquisition: true });
        expect(r.evidence?.verdict).toBe('QUALIFIED');
        expect(r.status).toBe(0);
        expect(r.acquisition).toMatchObject({ state: 'RECEIVED_COLD_DOWNLOAD', first: { download_ms: 4200, init_ms: 900 } });
    });

    it('QUALIFIED: a complete feedback-only journey (post-reload, v12 order), with acquisition not applicable', async () => {
        answer = { readback: feedbackJourney(), acquisition: [coldDownload()] };
        const r = await qualify('share_feedback', { acquisition: true });
        expect(r.evidence?.verdict).toBe('QUALIFIED');
        expect(r.status).toBe(0);
        expect(r.acquisition?.state).toBe('NOT_APPLICABLE_NO_RECORDING_STAGE');
    });

    // #1532 loop 6: the run names the attempt it saved; only THAT attempt's start/save count (the real J2 has later,
    // unsaved Starts in the same journey). Exercised here through the real script, not only the gate function.
    it('QUALIFIED (attempt-scoped): the named saved attempt has one start and one save; a later unsaved Start does not count against it', async () => {
        const rows = recordingJourney();
        rows.push({ event: 'session_started', attempt_id: 'attempt-2', attempt_seq: 2, candidate_id: MODEL, engine: 'private', runtime_version: 'r1' });
        answer = { readback: rows, acquisition: [coldDownload()] };
        const r = await qualify('session_during', { acquisition: true, attempts: 'attempt-1' });
        expect(r.evidence?.verdict).toBe('QUALIFIED');
        expect(r.evidence?.attempts_declared).toEqual(['attempt-1']);
        expect(r.status).toBe(0);
    });

    it('HOLD (attempt-scoped): the named attempt\'s save never arrived, even though another attempt saved', async () => {
        const rows = recordingJourney().map((row) => (row.event === 'session_saved' ? { ...row, attempt_id: 'attempt-2', attempt_seq: 2 } : row));
        rows.push({ event: 'session_started', attempt_id: 'attempt-2', attempt_seq: 2, candidate_id: MODEL, engine: 'private', runtime_version: 'r1' });
        answer = { readback: rows, acquisition: [coldDownload()] };
        const r = await qualify('session_during', { acquisition: true, attempts: 'attempt-1' });
        expect(r.status).not.toBe(0);
        expect(r.evidence?.verdict).toBe('HOLD');
        expect(JSON.stringify(r.evidence)).toContain('session_saved@attempt-1');
    });

    it('HOLD: a required family is missing', async () => {
        answer = { readback: feedbackJourney().filter((r) => r.event !== 'feedback_submit'), acquisition: [] };
        const r = await qualify('share_feedback');
        expect(r.status).not.toBe(0);
        expect(r.evidence?.verdict).toBe('HOLD');
        expect(r.evidence?.missing).toContain('feedback_submit');
    });

    it('HOLD: a singleton receipt arrived twice', async () => {
        answer = { readback: [...feedbackJourney(), { event: 'telemetry_positive_control', journey_id: 'pre', transport_initialized: true }], acquisition: [] };
        const r = await qualify('share_feedback');
        expect(r.status).not.toBe(0);
        expect(r.evidence?.verdict).toBe('HOLD');
        expect(r.evidence?.duplicate_families).toContain('telemetry_positive_control');
    });
});

/**
 * Query-side mutants: a real copy of the qualifier whose SELECT was edited the way a future change could edit it, run
 * against the faithful stand-in (which answers with the columns of the query it received). The copy lives beside the
 * original so every relative import resolves identically; it is removed after each case.
 */
const mutant = (name: string, edit: (source: string) => string) => {
    const original = readFileSync(resolve(ROOT, 'scripts/telemetry-readback-qualification.mts'), 'utf8');
    const edited = edit(original);
    queryDerivedResponse = true;
    if (edited === original) throw new Error(`mutant ${name} changed nothing`);
    const path = `scripts/.f1-mutant-${name}-${process.pid}.mts`;
    writeFileSync(resolve(ROOT, path), edited);
    return { path, cleanup: () => rmSync(resolve(ROOT, path), { force: true }) };
};
const ACQ_ORDER = 'properties.download_ms AS download_ms, properties.init_ms AS init_ms';

describe('column drift cannot mis-map a value silently (F1 mutants)', () => {
    it('MUTANT: a select item INSERTED into the readback query fails closed before any row is read', async () => {
        const m = mutant('insert', (src) => src
            .replace('const query = buildReadbackQuery({', 'let query = buildReadbackQuery({')
            .replace('    // #1539 F1: the SELECT actually sent must name',
                '    query = query.replace("properties.outcome AS outcome,", "properties.flush_outcome AS inserted_column, properties.outcome AS outcome,");\n    // #1539 F1: the SELECT actually sent must name'));
        try {
            answer = { readback: feedbackJourney(), acquisition: [] };
            const r = await qualify('share_feedback', { script: m.path });
            expect(r.status).not.toBe(0);
            expect(r.out).toMatch(/the readback query selects \[[^\]]*inserted_column[^\]]*\], not the decoder's declared columns/);
            // Refused before the readback query is even sent: the HOLD's first reason is the column guard.
            expect(r.evidence?.verdict).toBe('HOLD');
            expect(String((r.evidence?.reasons as string[] | undefined)?.[0])).toMatch(/^the readback query selects/);
        } finally { m.cleanup(); }
    });

    it('MUTANT: swapping download_ms and init_ms in the acquisition SELECT cannot report the wrong first-download time', async () => {
        const m = mutant('swap', (src) => (src.includes(ACQ_ORDER)
            ? src.replace(ACQ_ORDER, 'properties.init_ms AS init_ms, properties.download_ms AS download_ms')
            : src.replace('properties.download_ms, properties.init_ms', 'properties.init_ms, properties.download_ms')));
        try {
            answer = { readback: recordingJourney(), acquisition: [coldDownload()] };
            const r = await qualify('session_during', { acquisition: true, script: m.path });
            expect(r.acquisition).toMatchObject({ state: 'RECEIVED_COLD_DOWNLOAD', first: { download_ms: 4200, init_ms: 900 } });
        } finally { m.cleanup(); }
    });

    it('MUTANT: a RENAMED acquisition alias is a named HOLD, never a positional guess', async () => {
        const m = mutant('renamed', (src) => src.replace('properties.download_ms AS download_ms', 'properties.download_ms AS download_time_ms'));
        try {
            answer = { readback: recordingJourney(), acquisition: [coldDownload()] };
            const r = await qualify('session_during', { acquisition: true, script: m.path });
            expect(r.status).not.toBe(0);
            expect(r.out).toMatch(/the acquisition receipt query selects \[[^\]]*download_time_ms[^\]]*\], not the decoder's declared columns/);
        } finally { m.cleanup(); }
    });

    it('A response that carries no column names is a HOLD, never a positional guess', async () => {
        answer = { readback: feedbackJourney(), acquisition: [], omitColumns: true };
        const r = await qualify('share_feedback');
        expect(r.status).not.toBe(0);
        expect(r.out).toMatch(/the readback: the response carried no column names/);
    });
});

describe('the declared column lists are the queries the script actually sends', () => {
    it('buildReadbackQuery selects exactly READBACK_COLUMNS, in order', () => {
        const q = buildReadbackQuery({ windowHours: 24, releaseSha: RELEASE, trafficType: 'canary', qualifyingIdentity: IDENTITY, governedEvents: ['x'], quote: (v) => `'${v}'` });
        expect(selectAliases(q)).toEqual([...READBACK_COLUMNS]);
    });

    it('the acquisition query the script sends selects exactly ACQUISITION_COLUMNS, in order', () => {
        const src = readFileSync(resolve(ROOT, 'scripts/telemetry-readback-qualification.mts'), 'utf8');
        const start = src.indexOf('const acquisitionRows = await runQuery(`');
        expect(start).toBeGreaterThan(-1);
        expect(selectAliases(src.slice(start, src.indexOf('FROM events', start) + 'FROM events '.length))).toEqual([...ACQUISITION_COLUMNS]);
    });

    it('decodeByColumns refuses a short row and a duplicated name', () => {
        expect(decodeByColumns(['a', 'b'], ['a', 'b'], [['only-one']])).toMatchObject({ ok: false });
        expect(decodeByColumns(['a', 'b'], ['a', 'a'], [])).toMatchObject({ ok: false });
        expect(decodeByColumns(['a', 'b'], ['b', 'a'], [[2, 1]])).toEqual({ ok: true, rows: [{ a: 1, b: 2 }] });
    });
});

const shapes = ['user', 'identity', 'coaching', 'readback', 'acquisition'] as const;
const mutations: Array<{ name: string; edit: (r: ResponseFixture) => ResponseFixture }> = [
    { name: 'missing', edit: r => ({ ...r, columns: r.columns!.slice(1), results: r.results.map(v => (v as unknown[]).slice(1)) }) },
    { name: 'extra', edit: r => ({ ...r, columns: [...r.columns!, 'unexpected_column'], results: r.results.map(v => [...v as unknown[], 'unexpected']) }) },
    { name: 'duplicate', edit: r => ({ ...r, columns: [...r.columns!, r.columns![0]], results: r.results.map(v => [...v as unknown[], (v as unknown[])[0]]) }) },
    { name: 'renamed', edit: r => ({ ...r, columns: r.columns!.map((c, i) => i === 0 ? 'renamed_column' : c) }) },
    { name: 'absent', edit: r => ({ results: r.results }) },
    { name: 'short-row', edit: r => ({ ...r, results: r.results.map(v => (v as unknown[]).slice(0, -1)) }) },
    { name: 'long-row', edit: r => ({ ...r, results: r.results.map(v => [...v as unknown[], 'extra-cell']) }) },
    { name: 'non-array-row', edit: r => ({ ...r, results: r.results.map(() => 'not-an-array') }) },
];
const runShape = (shape: Shape) => {
    answer = { readback: shape === 'acquisition' ? recordingJourney() : feedbackJourney(), acquisition: [coldDownload()] };
    return qualify(shape === 'acquisition' ? 'session_during' : 'share_feedback', { shape, acquisition: shape === 'acquisition' });
};
const expectSuccess = (shape: Shape, r: Awaited<ReturnType<typeof qualify>>) => {
    expect(seenQueries.some(q => q.kind === shape)).toBe(true);
    if (shape === 'user') {
        expect(r.status).toBe(1); // A user-stage report can NEVER qualify a release.
        expect(r.out).toContain('USER_STAGE_RECEIPT');
        expect(r.out).toContain('"state":"RECEIVED"');
        expect(r.out).toContain('"qualifies":false');
    } else if (shape === 'coaching') {
        expect(r.status).toBe(0);
        expect(r.out).toMatch(/COACHING_DIAGNOSTIC_RECEIPT .*"verdict":"PASS"/);
    } else {
        expect(r.evidence?.verdict).toBe('QUALIFIED');
        expect(r.status).toBe(0);
    }
};

describe.each(shapes)('independent actual-entry response schema: %s', shape => {
    it('positive control reaches this query with its complete independent fixture', async () => {
        expect.hasAssertions();
        expectSuccess(shape, await runShape(shape));
    });
    it.each(mutations)('$name schema or row cannot qualify', async ({ edit }) => {
        responseMutation = { kind: shape, edit };
        const r = await runShape(shape);
        expect(seenQueries.some(q => q.kind === shape)).toBe(true);
        expect(r.status).toBe(1);
        expect(r.evidence?.verdict).toBe('HOLD');
        expect(r.out).toMatch(/column|row \d+ does not have exactly/);
        expect(r.out).not.toContain('QUALIFIED —');
        expect(r.out).not.toContain('USER_STAGE_RECEIPT');
    });
    it('a response reorder preserves the same values by name', async () => {
        expect.hasAssertions();
        responseMutation = { kind: shape, edit: r => ({ ...r, columns: [...r.columns!].reverse(), results: r.results.map(v => [...v as unknown[]].reverse()) }) };
        const r = await runShape(shape);
        expectSuccess(shape, r);
    });
    it('hasMore still refuses an incomplete response', async () => {
        responseMutation = { kind: shape, edit: r => ({ ...r, hasMore: true }) };
        const r = await runShape(shape);
        expect(seenQueries.some(q => q.kind === shape)).toBe(true);
        expect(r.status).toBe(1);
        expect(r.out).toContain('was truncated by the query API');
    });
});

describe('query deadline spans headers and the entire response body', () => {
    it.each([
        ['identity', 'headers'],
        ['readback', 'body'],
        ['readback', 'progressing-body'],
    ] as const)('query deadline: %s with pending %s emits HOLD without a downstream query', async (kind, mode) => {
        answer = { readback: recordingJourney(), acquisition: [coldDownload()] };
        stalledResponse = { kind, mode };
        const r = await qualify('session_during', { acquisition: true, queryTimeoutMs: '100', killAfterMs: 2500 });
        expect(r.status).toBe(1); // SIGKILL/null is a harness failure, never a bounded HOLD.
        expect(r.evidence?.verdict).toBe('HOLD');
        expect(r.out).toContain('exceeded its 100 ms query deadline');
        expect(seenQueries.map(q => q.kind)).toEqual(kind === 'identity' ? ['identity'] : ['identity', 'readback']);
        expect(r.acquisition).toBeNull();
        expect(r.out).not.toContain('fixture-not-a-secret');
    });

    it.each(['0', '-1', '1.5', 'NaN', 'Infinity', '120001', ''])('query deadline: invalid bound %j refuses before any query', async queryTimeoutMs => {
        const r = await qualify('session_during', { queryTimeoutMs });
        expect(r.status).toBe(1);
        expect(r.evidence?.verdict).toBe('HOLD');
        expect(r.out).toContain('--query-timeout-ms must be an integer between 1 and 120000');
        expect(seenQueries).toEqual([]);
    });

    it('query deadline: a complete response still qualifies within the explicit bound', async () => {
        answer = { readback: recordingJourney(), acquisition: [coldDownload()] };
        const r = await qualify('session_during', { acquisition: true, queryTimeoutMs: '1000' });
        expect(r.status).toBe(0);
        expect(r.evidence?.verdict).toBe('QUALIFIED');
        expect(r.acquisition?.state).toBe('RECEIVED_COLD_DOWNLOAD');
    });
});

describe('existing transport, identity and observed failure boundaries', () => {
    it('acquisition response reorder preserves the independently known download and init times', async () => {
        responseMutation = { kind: 'acquisition', edit: r => ({ ...r, columns: [...r.columns!].reverse(), results: r.results.map(v => [...v as unknown[]].reverse()) }) };
        const r = await runShape('acquisition');
        expect(r.status).toBe(0);
        expect(r.acquisition).toMatchObject({ first: { download_ms: 4200, init_ms: 900 } });
    });
    it('HTTP failure is HOLD', async () => {
        responseStatus = 503;
        const r = await runShape('identity');
        expect(r.status).toBe(1);
        expect(r.out).toContain('returned HTTP 503');
    });
    it('malformed JSON is HOLD', async () => {
        malformedJson = true;
        const r = await runShape('identity');
        expect(r.status).toBe(1);
        expect(r.out).toContain('response was not JSON');
    });
    it('two identities stay HOLD even with valid column metadata', async () => {
        responseMutation = { kind: 'identity', edit: r => ({ ...r, results: [[IDENTITY], ['second-fixture-person']] }) };
        const r = await runShape('identity');
        expect(r.status).toBe(1);
        expect(r.out).toContain('spans 2 distinct identities');
    });
    it('an observed storage failure remains FAIL exit3, distinct from missing-evidence HOLD', async () => {
        answer = { readback: feedbackJourney().map(r => r.outcome === 'storage_ok' ? { ...r, outcome: 'storage_failed', error_category: 'fixture-error' } : r), acquisition: [] };
        const r = await qualify('share_feedback');
        expect(r.status).toBe(3);
        expect(r.evidence?.verdict).toBe('FAIL');
    });
    it('private identity and fake credential values never appear in output', async () => {
        const r = await runShape('coaching');
        expectSuccess('coaching', r);
        for (const privateValue of [IDENTITY, requestId, diagnosticAttempt, 'fixture-not-a-secret']) expect(r.out).not.toContain(privateValue);
    });
    it('a malformed metadata name is refused without echoing untrusted text', async () => {
        responseMutation = { kind: 'identity', edit: r => ({ ...r, columns: ['PRIVATE_CONTENT_SENTINEL'] }) };
        const r = await runShape('identity');
        expect(r.status).toBe(1);
        expect(r.out).toContain('columns do not match');
        expect(r.out).not.toContain('PRIVATE_CONTENT_SENTINEL');
    });
});
