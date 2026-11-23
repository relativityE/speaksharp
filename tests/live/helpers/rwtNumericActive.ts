/**
 * G03 ACTIVE numeric check for the Open Mic (J1.b) and Focus (J3.b) journeys (PO, 2026-11-22: Option A).
 *
 * The sealed cloud-test harness check (tools/cloud-test/harness/draft-adapters/progress-numeric.cjs) qualifies a release only by
 * the historical 5a7bf6a1 consumer bytes, so every current release is NOT RUN there. This journey-only route lives OUTSIDE the
 * sealed packet (no packet, pin or nightly aggregate change) and qualifies a release by its own git bytes:
 *  1. Source: source and served must be the same exact full SHA, and the four consumer files at that SHA (git blob bytes) must equal
 *     ONE complete sealed set below. No SHA is trusted, the historical origin included; missing, unreadable or mixed bytes are
 *     NOT_RUN (HOLD).
 *  2. Identity: both saved sessions are the owner's and carry the journey's product (`sessions.product`), and the journey bound
 *     exactly one repeat attempt.
 *  3. The persisted comparison and the rendered numbers: the same reads and the same verdicts as the harness check. The read
 *     (`readPersistedNumeric`) and the page observation mirror the harness line for line, and the verdict is the harness's own
 *     `verify`. tests/unit/rwtNumericActive.test.ts pins that parity on the harness's case matrix, so the copies cannot drift.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

type Answer = { result: 'PASS' | 'FAIL' | 'NOT RUN'; facts: Record<string, unknown> };
type Expected = Answer | { value: Record<string, unknown>; result?: undefined };
type Res = { data: unknown; error: unknown } | null;
type Query = PromiseLike<Res> & {
    select(columns: string): Query; eq(key: string, value: unknown): Query; order(key: string, o: { ascending: boolean }): Query;
    limit(n: number): Query; maybeSingle(): PromiseLike<Res>;
};
type Db = { from(table: string): Query };
type Row = Record<string, unknown>;
type Page = {
    waitForFunction(fn: (route: string) => boolean, arg: string, options: { timeout: number }): Promise<unknown>;
    evaluate(fn: (route: string) => unknown, arg: string): Promise<unknown>;
};
export type NumericCaseConfig = { sourceSha: unknown; servedSha: unknown; account: { id: string } };
export type NumericActiveArgs = {
    db: unknown; caseConfig: NumericCaseConfig; sourceSessionId: unknown; repeatSessionId: unknown;
    expectedAttemptId?: unknown; product?: unknown; page?: unknown;
};

const load = createRequire(import.meta.url);
const ADAPTERS = '../../../tools/cloud-test/harness/draft-adapters/';
const harness = load(fileURLToPath(new URL(ADAPTERS + 'progress-numeric.cjs', import.meta.url))) as {
    SOURCE_SHA: string; CONSUMERS: ReadonlyArray<{ path: string; snapshotSha256: string }>;
    SELECT: { recommendation: string; attempt: string; evaluation: string };
    verify(expected: Expected, observation: unknown): Answer;
};
const pure = load(fileURLToPath(new URL(ADAPTERS + 'oracles/pure/progressNumericSelected.cjs', import.meta.url))) as {
    PROGRESS_FORMULA_VERSION: string; TARGET_METRIC_LABELS: Record<string, string>;
    hasCompleteEligibleProgressEvidence(evaluation: unknown): boolean; toEvaluation(row: unknown): unknown;
    loadRepeatResult(db: unknown, sourceSessionId: string, source: Row, rec: Row, attempt: Row): Promise<Record<string, unknown>>;
};

/** The four consumer files, in the harness's order (frontend progress evaluation, loader, panel and writer). */
export const NUMERIC_CONSUMER_PATHS: readonly string[] = Object.freeze(harness.CONSUMERS.map((c) => c.path));

/**
 * The complete sealed sets, as each file's sha256 in NUMERIC_CONSUMER_PATHS order. The historical set is the sealed packet's own
 * d100 snapshots (read from the packet, never copied). The registered-repeat set is the #1827 source: recordProgress.ts is git
 * blob 52eec0141fa42e046a88f05d46af1bc3e5d21afd at c921a3506da0008feb523f7059e775bf774944f8 (also served at bc634c5e); the other
 * three are byte-identical to the historical set there.
 */
export const NUMERIC_SOURCE_SETS: ReadonlyArray<{ id: string; sealedAt: string; sha256: readonly string[] }> = Object.freeze([
    Object.freeze({ id: 'historical-5a7bf6a1', sealedAt: harness.SOURCE_SHA, sha256: Object.freeze(harness.CONSUMERS.map((c) => c.snapshotSha256)) }),
    Object.freeze({
        id: 'registered-repeat-c921a350', sealedAt: 'c921a3506da0008feb523f7059e775bf774944f8', sha256: Object.freeze([
            'f562c249f25daaf52fc1cc5aec2b740b985a8b4200298cbc906b5053db8ceaad',
            'f430efe3af8e23e069057b568cf7f4affdd979d81393a48710e0f785aaa7cbd4',
            '1d89559000a161393666ed667b3b9dcce80e317291118202b0110c32cbecdb73',
            'cc91f064a348e9e8205c1afb81fee3f04caa29628b7886d6482cec3b9233e1b5',
        ]),
    }),
]);

export type ReadBlob = (sha: string, file: string) => Buffer;
const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
/** Git blob bytes of `file` at full commit `sha` in this checkout; throws when the object is absent. */
export const gitBlob: ReadBlob = (sha, file) =>
    execFileSync('git', ['show', `${sha}:${file}`], { cwd: REPO_ROOT, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 32 * 1024 * 1024 });
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

/** The id of the ONE complete set all four consumer files at `sha` equal, or null. Each set is judged whole; unreadable is null. */
export function matchingNumericSet(sha: string, readBlob: ReadBlob = gitBlob, sets = NUMERIC_SOURCE_SETS): string | null {
    let actual: string[];
    try { actual = NUMERIC_CONSUMER_PATHS.map((file) => sha256(readBlob(sha, file))); } catch { return null; }
    const set = sets.find((s) => s.sha256.length === actual.length && s.sha256.every((h, i) => h === actual[i]));
    return set ? set.id : null;
}

function notRun(reason: string): never {
    const e = new Error(reason) as Error & { code: string; trustedBlocker: string };
    e.code = 'NOT_RUN'; e.trustedBlocker = reason;
    throw e;
}
function answer(result: Answer['result'], reason: string, more: Record<string, unknown> = {}): Answer {
    return { result, facts: { sourceNumericContract: true, reason, ...more } };
}

/** The active source preflight: exact full source=served, then one complete sealed set by git bytes. Throws NOT_RUN otherwise. */
export function preflightActive(c: NumericCaseConfig | undefined, options: { readBlob?: ReadBlob } = {}): { ready: true; sourceSha: string; set: string } {
    if (typeof c?.sourceSha !== 'string' || !/^[0-9a-f]{40}$/.test(c.sourceSha) || c.sourceSha !== c.servedSha) {
        notRun('G03 numeric source requires an exact full source/served binding to the same release');
    }
    const set = matchingNumericSet(c.sourceSha, options.readBlob ?? gitBlob);
    if (!set) notRun('G03 active numeric source: the four consumer files at the served release are unreadable or equal no complete sealed set');
    return { ready: true, sourceSha: c.sourceSha, set };
}

const PRODUCTS: readonly string[] = Object.freeze(['open_mic', 'focus_points']);

/**
 * The persisted comparison: recommendation, the attempt bound to this repeat and both durable evaluations. A line-for-line mirror
 * of the harness check's read after its source preflight (pinned by the parity test); run only after `preflightActive`.
 */
export async function readPersistedNumeric(args: NumericActiveArgs): Promise<Expected> {
    const db = args.db as Db, c = args.caseConfig, sourceSessionId = args.sourceSessionId as string, repeatSessionId = args.repeatSessionId as string;
    const expectedAttemptId = args.expectedAttemptId;
    const SELECT = harness.SELECT;
    if (typeof sourceSessionId !== 'string' || typeof repeatSessionId !== 'string' || sourceSessionId === repeatSessionId) notRun('G03 actual distinct saved session identities missing');
    const read = async (q: PromiseLike<Res>) => { const r = await q; if (r?.error || !r) notRun('G03 owner GET unavailable; no admin fallback'); return r.data; };
    const rec = await read(db.from('progress_recommendations').select(SELECT.recommendation).eq('source_session_id', sourceSessionId).eq('formula_version', pure.PROGRESS_FORMULA_VERSION).maybeSingle()) as Row | null;
    if (!rec) return answer('NOT RUN', 'source-recommendation-unavailable');
    if (rec.user_id !== c.account.id || rec.source_session_id !== sourceSessionId || rec.formula_version !== pure.PROGRESS_FORMULA_VERSION) return answer('FAIL', 'persisted-recommendation-identity-mismatch');
    if (!Object.prototype.hasOwnProperty.call(pure.TARGET_METRIC_LABELS, rec.target_metric as string) || !['decrease', 'increase', 'maintain'].includes(rec.target_direction as string) || !Number.isFinite(rec.target_value) || typeof rec.target_units !== 'string' || !rec.target_units.trim() || typeof rec.shown_text !== 'string' || !rec.shown_text.trim()) return answer('NOT RUN', 'source-recommendation-evidence-unavailable');
    const attempts = await read(db.from('progress_recommendation_attempts').select(SELECT.attempt).eq('recommendation_id', rec.id).order('accepted_at', { ascending: false }).limit(2)) as Row[] | null;
    if (!Array.isArray(attempts) || !attempts.length) return answer('NOT RUN', 'linked-attempt-unavailable');
    const attempt = attempts[0]; if (attempts.some((x) => x.user_id !== c.account.id || x.recommendation_id !== rec.id)) return answer('FAIL', 'persisted-attempt-owner-or-recommendation-mismatch');
    if (!Number.isFinite(Date.parse(attempt.accepted_at as string)) || (attempts[1] && (!Number.isFinite(Date.parse(attempts[1].accepted_at as string)) || Date.parse(attempts[1].accepted_at as string) >= Date.parse(attempt.accepted_at as string)))) return answer('NOT RUN', 'latest-attempt-order-ambiguous');
    if (attempt.practice_session_id !== repeatSessionId || (expectedAttemptId && attempt.id !== expectedAttemptId)) return answer('FAIL', 'stale-or-wrong-repeat-attempt');
    if (attempt.lifecycle !== 'completed' || !['moved', 'did_not_move'].includes(attempt.outcome as string)) return answer('NOT RUN', 'completed-comparable-repeat-unavailable');
    if (attempt.next_comparable_session_id !== repeatSessionId) return answer('FAIL', 'persisted-linked-comparison-is-not-this-repeat');
    const source = await read(db.from('session_progress_evaluations').select(SELECT.evaluation).eq('session_id', sourceSessionId).eq('formula_version', pure.PROGRESS_FORMULA_VERSION).maybeSingle()) as Row | null;
    if (!source) return answer('NOT RUN', 'source-evaluation-unavailable');
    if (source.user_id !== c.account.id || source.session_id !== sourceSessionId || source.formula_version !== pure.PROGRESS_FORMULA_VERSION) return answer('FAIL', 'persisted-source-evaluation-identity-mismatch');
    if (!pure.hasCompleteEligibleProgressEvidence(pure.toEvaluation(source))) return answer('NOT RUN', 'source-evaluation-ineligible-or-incomplete');
    // Exact source derivation requests the persisted next-comparable evaluation, with owner/formula identity checks around that GET;
    // no fallback to session history, rounded metrics, target_value or zero.
    let nextIntegrity: string | null = null;
    const boundDb = {
        from(table: string) {
            if (table !== 'session_progress_evaluations') notRun('G03 unexpected source read');
            let q = db.from(table);
            return {
                select() { q = q.select(SELECT.evaluation); return this; },
                eq(k: string, v: unknown) { q = q.eq(k, v); return this; },
                async maybeSingle() {
                    const r = await q.maybeSingle() as { data: Row | null; error: unknown };
                    if (r.error) notRun('G03 linked evaluation owner GET unavailable');
                    if (r.data && (r.data.user_id !== c.account.id || r.data.formula_version !== pure.PROGRESS_FORMULA_VERSION || r.data.session_id !== repeatSessionId)) {
                        nextIntegrity = 'persisted-linked-evaluation-identity-mismatch';
                        return { data: null, error: null };
                    }
                    return r;
                },
            };
        },
    };
    const value = await pure.loadRepeatResult(boundDb, sourceSessionId, source, rec, attempt);
    if (nextIntegrity) return answer('FAIL', nextIntegrity);
    return { value };
}

/**
 * The active expected values: source preflight, the journey's product, the bound attempt, both saved sessions' owner and product,
 * then the persisted read. Throws NOT_RUN (HOLD) for a missing precondition; returns a FAIL / NOT RUN answer for a wrong identity.
 */
export async function readExpectedActive(args: NumericActiveArgs, options: { readBlob?: ReadBlob } = {}): Promise<Expected> {
    const c = args?.caseConfig;
    preflightActive(c, options);
    if (!PRODUCTS.includes(args.product as string)) notRun('G03 active numeric check needs the journey product');
    if (typeof args.expectedAttemptId !== 'string' || !args.expectedAttemptId) notRun('G03 active numeric check needs the attempt bound to this repeat');
    const { sourceSessionId, repeatSessionId } = args;
    if (typeof sourceSessionId !== 'string' || typeof repeatSessionId !== 'string' || sourceSessionId === repeatSessionId) notRun('G03 actual distinct saved session identities missing');
    const db = args.db as Db;
    for (const id of [sourceSessionId, repeatSessionId]) {
        const r = await db.from('sessions').select('id,user_id,product').eq('id', id).maybeSingle();
        if (r?.error || !r) notRun('G03 owner GET unavailable; no admin fallback');
        const row = r.data as Row | null;
        if (!row) return answer('NOT RUN', 'saved-session-unavailable');
        if (row.id !== id || row.user_id !== c.account.id) return answer('FAIL', 'saved-session-owner-mismatch');
        if (row.product !== args.product) return answer('FAIL', 'saved-session-product-mismatch');
    }
    return readPersistedNumeric(args);
}

/** The active check end to end: the expected values, then the panel the journey opened (a mirror of the harness observation). */
export async function observeActive(args: NumericActiveArgs, options: { readBlob?: ReadBlob } = {}): Promise<Answer> {
    const expected = await readExpectedActive(args, options);
    if (expected.result) return expected as Answer;
    const page = args.page as Page, sourceSessionId = args.sourceSessionId as string;
    try { await page.waitForFunction((route) => location.pathname === route && !!document.querySelector('[data-testid="progress-panel"] [data-testid="progress-direction"]') && !document.querySelector('[data-testid="progress-panel"] [data-testid="progress-loading"]'), '/progress/' + sourceSessionId, { timeout: 45000 }); } catch { return answer('NOT RUN', 'numeric-panel-not-settled'); }
    let observation: unknown;
    try { observation = await page.evaluate((route) => { const panel = document.querySelector('[data-testid="progress-panel"]'), nodes = panel ? Array.from(panel.querySelectorAll('[data-testid="progress-attempt-values"]')) : [], node = nodes[0], style = node ? getComputedStyle(node) : null; return { readable: true, pathMatches: location.pathname === route, settled: !!panel?.querySelector('[data-testid="progress-direction"]') && !panel?.querySelector('[data-testid="progress-loading"]'), count: nodes.length, visible: !!node && style?.visibility !== 'hidden' && style?.display !== 'none' && node.getClientRects().length > 0, text: node?.textContent ?? null }; }, '/progress/' + sourceSessionId); } catch { return answer('NOT RUN', 'numeric-ui-observation-unavailable'); }
    return harness.verify(expected, observation);
}
