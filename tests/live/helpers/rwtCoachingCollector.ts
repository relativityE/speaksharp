/**
 * #1258 (PM 6114451615 / 6114590729) — live collection for the restricted synthetic coaching evidence artifact.
 *
 * Assembles each take's `RwtCoachingTakeEvidence` from what the run itself observed:
 *  - the outgoing `get-ai-suggestions` request and its actual Edge answer (`CoachingGenerationTap`, request boundary);
 *  - the owner-scoped saved prompt inputs (session row; Focus rows for a Focus take), read with the service role;
 *  - the server authority readback (`read_ai_suggestion_authority_v1`: Postgres computes both suggestion digests);
 *  - the pair the page RENDERED.
 * Then writes the artifact through `writeRwtCoachingEvidenceArtifact` into an explicitly configured private directory
 * (PM 6114547673): outside the checkout, the workspace and every test-output/report/upload tree.
 *
 * Public output is one receipt row of closed codes, the per-take prompt-binding verdicts and the artifact SHA-256.
 * Transcript, prompt, coaching text, identifiers and the response-only session-binding hash never leave the artifact.
 */
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type Page } from '@playwright/test';
import type { CoachingExchange, CoachingSuggestionPair } from './coachingGenerationTap';
import { coachingContract, writeRwtCoachingEvidenceArtifact, type RwtCoachingTakeEvidence } from './rwtCoachingEvidence';

type Verdict = 'PASS' | 'FAIL' | 'HOLD';
type Product = 'open_mic' | 'focus_points';
type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

/** Canonical path of a destination that may not exist yet: realpath of the deepest existing ancestor + the rest. */
export function canonicalPath(raw: string): string {
    let head = resolve(raw);
    const rest: string[] = [];
    while (!existsSync(head)) {
        const parent = dirname(head);
        if (parent === head) break;
        rest.unshift(basename(head));
        head = parent;
    }
    return join(existsSync(head) ? realpathSync(head) : head, ...rest);
}

/** The checkout this helper runs from (tests/live/helpers → repository root). */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** Every tree the private artifact must stay out of (PM 6114547673), given the run's Playwright output directories. */
export function forbiddenEvidenceRoots(outputDirs: readonly string[]): string[] {
    return [REPO_ROOT, process.env.GITHUB_WORKSPACE ?? '', resolve(REPO_ROOT, 'test-results'), resolve(REPO_ROOT, 'playwright-report'), ...outputDirs]
        .filter((r) => r !== '');
}

const inside = (child: string, root: string): boolean => child === root || child.startsWith(root.endsWith(sep) ? root : root + sep);

/**
 * The private destination, or the closed reason it cannot be used. Never a default: an unset destination is HOLD, and a
 * destination inside the checkout, the CI workspace or any test-output/report/upload tree is refused.
 */
export function resolvePrivateEvidenceDir(raw: string | undefined, forbiddenRoots: readonly (string | undefined)[]):
    { dir: string } | { hold: 'private_evidence_destination_not_configured' | 'private_evidence_destination_not_absolute' | 'private_evidence_destination_inside_forbidden_tree' } {
    if (!raw || !raw.trim()) return { hold: 'private_evidence_destination_not_configured' };
    if (!isAbsolute(raw)) return { hold: 'private_evidence_destination_not_absolute' };
    const dir = canonicalPath(raw);
    const roots = forbiddenRoots.filter((r): r is string => typeof r === 'string' && r.trim() !== '').map(canonicalPath);
    if (roots.some((root) => inside(dir, root) || inside(root, dir))) return { hold: 'private_evidence_destination_inside_forbidden_tree' };
    return { dir };
}

export interface SavedPromptInputs {
    transcript: string;
    metrics: Record<string, Json>;
    promptContext: {
        transcriptState: string;
        focusContext: { kind: 'none' } | { kind: 'pending' | 'error' }
            | { kind: 'focus'; topic: string | null; points: Array<{ label: string; verdict: 'detected' | 'not_detected' | 'unavailable'; detectedAtSeconds: number | null }> };
    };
}

/** One row of `read_ai_suggestion_authority_v1`. */
export interface AuthorityReadback {
    session_id: string;
    user_id: string;
    ai_suggestions: CoachingSuggestionPair | null;
    provider: string | null;
    model: string | null;
    provider_request_made: boolean | null;
    cache_read_count: number | null;
    receipt_suggestion_sha256: string | null;
    current_suggestion_sha256: string | null;
}

export interface TakeIdentity {
    runId: string;
    suiteId: string;
    product: Product;
    fixtureName: string;
    fixtureSha256: string;
    sessionId: string;
    userId: string;
}

const PROOF_RESPONSE_KEYS = ['request_id', 'attempt_id', 'client_attempt', 'status', 'outcome', 'reason', 'provider', 'configured_model',
    'observed_model', 'source', 'provider_attempts', 'retry_count', 'prompt_sha256', 'product', 'has_session', 'client_release_id',
    'session_binding_sha256'] as const;

const successes = (exchanges: readonly CoachingExchange[], sessionId: string): CoachingExchange[] =>
    exchanges.filter((e) => e.sent.sessionId === sessionId && e.status === 200 && e.diagnostics?.outcome === 'success');

/**
 * One take's evidence, or the closed reason it is unavailable (HOLD). The terminal success is the take's last successful
 * exchange; the generation proof is the take's FRESH generation (for a cache replay, the original one — absent → the
 * helper HOLDs prompt binding rather than inventing it).
 */
export function assembleTake(input: {
    identity: TakeIdentity;
    exchanges: readonly CoachingExchange[];
    saved: SavedPromptInputs | null;
    authority: AuthorityReadback | null;
    rendered: CoachingSuggestionPair | null;
}): { take: RwtCoachingTakeEvidence } | { hold: string } {
    const { identity, saved, authority, rendered } = input;
    const ok = successes(input.exchanges, identity.sessionId);
    const terminal = ok[ok.length - 1];
    if (!terminal?.diagnostics) return { hold: 'no_successful_generation_observed' };
    if (!saved) return { hold: 'saved_prompt_inputs_unavailable' };
    if (!authority || !authority.ai_suggestions || authority.provider === null || authority.model === null
        || authority.provider_request_made === null || authority.receipt_suggestion_sha256 === null || authority.current_suggestion_sha256 === null) {
        return { hold: 'server_authority_readback_unavailable' };
    }
    if (!rendered) return { hold: 'rendered_pair_unavailable' };
    const d = terminal.diagnostics;
    const fresh = [...ok].reverse().find((e) => e.diagnostics?.source === 'fresh');
    const proof = fresh?.diagnostics && PROOF_RESPONSE_KEYS.every((k) => Object.prototype.hasOwnProperty.call(fresh.diagnostics, k))
        ? {
            request: {
                sessionId: fresh.sent.sessionId ?? '', product: (fresh.sent.product ?? '') as Product,
                requestId: fresh.sent.requestId ?? '', attemptId: fresh.sent.attemptId ?? '',
                clientAttempt: fresh.sent.clientAttempt ?? 0, clientReleaseId: fresh.sent.clientReleaseId ?? '',
            },
            response: Object.fromEntries(PROOF_RESPONSE_KEYS.map((k) => [k, fresh.diagnostics![k]])) as NonNullable<RwtCoachingTakeEvidence['promptGenerationReceipt']>['response'],
        }
        : undefined;
    const source = d.source === 'cache' ? 'cache' : 'fresh';
    const take: RwtCoachingTakeEvidence = {
        ...identity,
        runOwnedBinding: { verified: true, runId: identity.runId, sessionId: identity.sessionId, userId: identity.userId, fixtureSha256: identity.fixtureSha256 },
        transcript: saved.transcript,
        metrics: saved.metrics,
        savedInputReadback: {
            sessionId: identity.sessionId, userId: identity.userId, product: identity.product,
            transcript: saved.transcript, metrics: saved.metrics, promptContext: saved.promptContext as never,
        },
        configuredModel: String(d.configured_model ?? ''),
        diagnosticRequestId: String(d.request_id ?? ''),
        diagnosticAttemptId: String(d.attempt_id ?? ''),
        diagnosticClientAttempt: Number(d.client_attempt ?? 0),
        diagnosticStatus: terminal.status ?? 0,
        diagnosticOutcome: 'success',
        diagnosticReason: 'none',
        providerAttempts: Number(d.provider_attempts ?? -1),
        retryCount: Number(d.retry_count ?? -1),
        source,
        providerDurationMs: Number(d.provider_duration_ms ?? -1),
        totalDurationMs: Number(d.total_duration_ms ?? -1),
        promptSha256: typeof d.prompt_sha256 === 'string' ? d.prompt_sha256 : null,
        authorityReceipt: {
            session_id: authority.session_id, user_id: authority.user_id, provider: authority.provider, model: authority.model,
            provider_request_made: authority.provider_request_made,
            receipt_suggestion_sha256: authority.receipt_suggestion_sha256, current_suggestion_sha256: authority.current_suggestion_sha256,
            ai_suggestions: authority.ai_suggestions,
            ...(authority.cache_read_count === null ? {} : { cache_read_count: authority.cache_read_count }),
        },
        renderedSuggestions: rendered,
    };
    if (proof) take.promptGenerationReceipt = proof;
    return { take };
}

type Row = Record<string, unknown>;
type Result<T> = PromiseLike<{ data: T | null; error: { code?: string } | null }>;
/** The narrow service-role query surface this collector uses (structurally satisfied by the Supabase client). */
interface Query {
    select(columns: string): Query;
    eq(column: string, value: unknown): Query;
    order(column: string, options: { ascending: boolean }): Query;
    limit(count: number): Query;
    maybeSingle(): Result<Row>;
    then: Result<Row[]>['then'];
}
export interface AdminClient {
    from(table: string): Query;
    rpc(fn: string, args: Record<string, unknown>): Result<unknown>;
}

const PROMPT_METRIC_KEYS = ['wpm', 'filler_counts', 'filler_words', 'next_action_signal'] as const;

/** The saved inputs the Edge function builds its prompt from, scoped to the run-owned account and session. */
export async function readSavedPromptInputs(admin: AdminClient, userId: string, sessionId: string, product: Product): Promise<SavedPromptInputs | null> {
    const { data: row, error } = await admin.from('sessions').select(`transcript, transcript_state, ${PROMPT_METRIC_KEYS.join(', ')}`)
        .eq('id', sessionId).eq('user_id', userId).maybeSingle();
    if (error || !row || typeof row.transcript !== 'string') return null;
    const transcript = row.transcript;
    const metrics = Object.fromEntries(PROMPT_METRIC_KEYS.map((k) => [k, (row[k] ?? null) as Json])) as Record<string, Json>;
    const transcriptState = typeof row.transcript_state === 'string' ? row.transcript_state : 'unknown';
    if (product === 'open_mic') return { transcript, metrics, promptContext: { transcriptState, focusContext: { kind: 'none' } } };
    // Mirrors the Edge function's loadFocusContext over the same tables, keyed by the run-owned session.
    const { data: objective, error: oErr } = await admin.from('objective_session').select('id, brief_id')
        .eq('source_session_id', sessionId).order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (oErr || !objective) return null;
    const [brief, points, evidence] = await Promise.all([
        admin.from('objective_brief').select('event_goal').eq('id', objective.brief_id).maybeSingle(),
        admin.from('objective_brief_point').select('id, label, sort_order').eq('brief_id', objective.brief_id).order('sort_order', { ascending: true }),
        admin.from('objective_evidence').select('brief_point_id, verdict, detected_at_seconds').eq('session_id', objective.id),
    ] as const);
    if (brief.error || points.error || evidence.error) return null;
    const pointRows = (points.data ?? []) as Array<{ id: string; label: string }>;
    const evidenceRows = (evidence.data ?? []) as Array<{ brief_point_id: string; verdict: string; detected_at_seconds: number | null }>;
    if (pointRows.length === 0 || evidenceRows.length === 0) return null;
    const byPoint = new Map(evidenceRows.map((r) => [r.brief_point_id, r]));
    const verdicts = new Set(['detected', 'not_detected', 'unavailable']);
    const goal = brief.data?.event_goal;
    const topic = typeof goal === 'string' ? goal : null;
    return {
        transcript, metrics,
        promptContext: {
            transcriptState,
            focusContext: {
                kind: 'focus', topic,
                points: pointRows.map((p) => {
                    const r = byPoint.get(p.id);
                    const verdict = (r && verdicts.has(r.verdict) ? r.verdict : 'unavailable') as 'detected' | 'not_detected' | 'unavailable';
                    return { label: p.label, verdict, detectedAtSeconds: verdict === 'detected' && typeof r?.detected_at_seconds === 'number' ? r.detected_at_seconds : null };
                }),
            },
        },
    };
}

/** The trusted authority readback (service role), restricted to the run-owned account's row. */
export async function readAuthority(admin: AdminClient, userId: string, sessionId: string): Promise<AuthorityReadback | null> {
    const { data, error } = await admin.rpc('read_ai_suggestion_authority_v1', { p_session_ids: [sessionId] });
    if (error || !Array.isArray(data)) return null;
    const row = (data as AuthorityReadback[]).find((r) => r.session_id === sessionId && r.user_id === userId);
    return row ?? null;
}

export interface CoachingEvidenceOutcome {
    verdict: Verdict;
    detail: string;
    /** Closed codes and digests only. */
    evidence: Record<string, string | number | boolean | null>;
}

/**
 * Build and write the artifact for the first and repeat takes; return the PUBLIC row (closed codes only).
 * PASS only when the artifact was written and BOTH takes' prompt bindings PASS; a binding FAIL is FAIL; anything
 * unavailable (destination, a take's inputs/proof, a binding HOLD) is HOLD. A validation refusal by the helper is FAIL.
 */
export function coachingEvidenceOutcome(input: {
    releaseSha: string;
    destination: ReturnType<typeof resolvePrivateEvidenceDir>;
    firstTake: ReturnType<typeof assembleTake>;
    repeatTake: ReturnType<typeof assembleTake>;
    write?: typeof writeRwtCoachingEvidenceArtifact;
}): CoachingEvidenceOutcome {
    const base = { configuredModel: coachingContract.model };
    if ('hold' in input.destination) return { verdict: 'HOLD', detail: 'no private evidence destination; the restricted artifact was not written', evidence: { ...base, reason: input.destination.hold } };
    if ('hold' in input.firstTake) return { verdict: 'HOLD', detail: 'the first take\'s evidence is unavailable', evidence: { ...base, reason: input.firstTake.hold, take: 'first' } };
    if ('hold' in input.repeatTake) return { verdict: 'HOLD', detail: 'the repeat take\'s evidence is unavailable', evidence: { ...base, reason: input.repeatTake.hold, take: 'repeat' } };
    let written: { file: string; sha256: string; mode: number };
    let artifact: { firstTake: { promptBinding: { verdict: Verdict; reason: string } }; repeatTake: { promptBinding: { verdict: Verdict; reason: string } } };
    try {
        written = (input.write ?? writeRwtCoachingEvidenceArtifact)({ releaseSha: input.releaseSha, firstTake: input.firstTake.take, repeatTake: input.repeatTake.take }, input.destination.dir);
        artifact = JSON.parse(readFileSync(written.file, 'utf8'));
    } catch (error) {
        // The helper's refusals are fixed sentences naming the take and the failed check — never a field VALUE.
        const message = error instanceof Error ? error.message : 'unknown';
        const refusal = /^(firstTake|repeatTake)[.:\w]*: [a-z][a-z ,/-]+$/i.test(message) ? message.slice(0, 160) : 'artifact_write_refused';
        return { verdict: 'FAIL', detail: 'the run\'s coaching evidence did not satisfy the restricted artifact contract', evidence: { ...base, refusal } };
    }
    const first = artifact.firstTake.promptBinding;
    const repeat = artifact.repeatTake.promptBinding;
    const verdict: Verdict = first.verdict === 'FAIL' || repeat.verdict === 'FAIL' ? 'FAIL'
        : first.verdict === 'PASS' && repeat.verdict === 'PASS' ? 'PASS' : 'HOLD';
    return {
        verdict,
        detail: verdict === 'PASS' ? 'both takes\' coaching is bound to their saved prompt inputs and the server generation receipt'
            : verdict === 'FAIL' ? 'a take\'s generation does not match its saved prompt inputs or binding' : 'a take\'s prompt binding could not be proven',
        evidence: { ...base, artifactSha256: written.sha256, firstBinding: first.verdict, firstReason: first.reason, repeatBinding: repeat.verdict, repeatReason: repeat.reason },
    };
}

/**
 * The pair a saved take's Analytics detail RENDERS (its own `saved-review` block), read in memory only. Null when the
 * block or either phrase is not shown — the caller HOLDs; it never substitutes the server's copy for what was rendered.
 */
export async function readSavedReviewPair(page: Page, sessionId: string, version: CoachingSuggestionPair['version']): Promise<CoachingSuggestionPair | null> {
    await page.goto(`/analytics/${sessionId}`);
    const block = page.getByTestId('saved-review');
    if (!(await block.waitFor({ state: 'visible', timeout: 45_000 }).then(() => true).catch(() => false))) return null;
    await expect.poll(async () => block.getAttribute('data-review-state'), { timeout: 30_000 }).not.toBe('loading').catch(() => undefined);
    const text = async (id: string) => (await block.getByTestId(id).innerText({ timeout: 10_000 }).catch(() => '')).trim();
    const well = await text('review-what-went-well');
    const next = await text('review-try-next');
    return well && next ? { version, what_worked: well, what_to_try_next: next } : null;
}

interface ReceiptLike {
    readonly rows: ReadonlyArray<{ step: string; verdict: string }>;
    row(step: string, verdict: Verdict, detail: string, evidence?: Record<string, string | number | boolean | null>): void;
}

/**
 * Row `coaching prompt binding` for one product journey: assemble the first and repeat takes and write the restricted
 * artifact. `firstRendered` is the pair the live review showed when the caller read it; otherwise (and always for the
 * repeat take, whose live review is left at once for its own repeat action) the pair is read from that take's Analytics
 * detail in a separate tab, leaving the journey's page and telemetry untouched.
 */
export async function coachingPromptBindingRow(input: {
    receipt: ReceiptLike;
    page: Page;
    admin: AdminClient;
    exchanges: readonly CoachingExchange[];
    fixture: { key: string; kind: string; sha256?: string };
    suiteId: string;
    product: Product;
    userId: string;
    firstSessionId: string | null;
    repeatSessionId: string | null;
    firstRendered: CoachingSuggestionPair | null;
    releaseSha: string;
    outputDirs: readonly string[];
}): Promise<void> {
    const { receipt, page, admin, product, userId } = input;
    if (input.fixture.kind !== 'synthetic' || !input.fixture.sha256) {
        receipt.row('coaching prompt binding', 'HOLD', 'the restricted collector runs only on a synthetic fixture', { reason: 'collector_synthetic_only' });
        return;
    }
    const version: CoachingSuggestionPair['version'] = product === 'focus_points' ? 'gemini_coaching_focus_v1' : 'gemini_coaching_v1';
    const destination = resolvePrivateEvidenceDir(process.env.RWT_PRIVATE_EVIDENCE_DIR, forbiddenEvidenceRoots(input.outputDirs));
    const runId = `${process.env.GITHUB_RUN_ID ?? 'local'}-${process.env.GITHUB_RUN_ATTEMPT ?? '1'}`;
    const renderedFromAnalytics = async (sessionId: string) => {
        const tab = await page.context().newPage();
        try { return await readSavedReviewPair(tab, sessionId, version); } finally { await tab.close(); }
    };
    const takeFor = async (sessionId: string | null, rendered: CoachingSuggestionPair | null, missing: string): Promise<ReturnType<typeof assembleTake>> => {
        if (!sessionId) return { hold: missing };
        return assembleTake({
            identity: { runId, suiteId: input.suiteId, product, fixtureName: input.fixture.key, fixtureSha256: input.fixture.sha256!, sessionId, userId },
            exchanges: input.exchanges,
            saved: await readSavedPromptInputs(admin, userId, sessionId, product),
            authority: await readAuthority(admin, userId, sessionId),
            rendered: rendered ?? await renderedFromAnalytics(sessionId),
        });
    };
    const firstTake = await takeFor(input.firstSessionId, input.firstRendered, 'no_saved_take');
    const repeatTake = await takeFor(input.repeatSessionId, null, 'no_repeat_take');
    const outcome = coachingEvidenceOutcome({ releaseSha: input.releaseSha, destination, firstTake, repeatTake });
    receipt.row('coaching prompt binding', outcome.verdict, outcome.detail, outcome.evidence);
}

/**
 * #1594 (PM 6120326867) — THE WHOLE-SCENARIO COACHING REQUEST BUDGET, evaluated once at the END of a scenario (after
 * feedback/navigation, before cleanup), never sampled mid-flow. Its evidence, stated exactly:
 *  - `browserRequests`: `get-ai-suggestions` POSTs the BROWSER sent (the tap's request count, including any unanswered);
 *  - `answered`: those that returned a response the tap could read;
 *  - `providerAttemptsReported`: the sum of `diagnostics.provider_attempts` the EDGE function reported for the answered
 *    requests — the server's own provider-invocation count, not something the browser can observe directly. Only a
 *    nonnegative safe-integer count is summed; a malformed count is reported (`malformedProviderAttempts`), never summed.
 * A browser count is not a provider-invocation count, and the client may retry, so both are bounded. FAIL when either
 * exceeds `maximum` or any listed take received more than one request; HOLD when a sent request has no readable Edge
 * diagnostics (provider invocations unprovable). PASS only when every sent request was answered with readable
 * diagnostics within budget. No retry is executed or hidden here; a retry the page made is simply counted.
 */
export function coachingRequestBudgetRow(
    receipt: ReceiptLike,
    tap: { sentCount: number; exchanges: readonly CoachingExchange[] },
    budget: { maximum: number; oneRequestPerSession?: readonly string[] },
): void {
    const answered = tap.exchanges.filter((e) => e.status !== null);
    // PM RETURN 6121020210: only a nonnegative SAFE integer is a provider-attempt count. A malformed value (negative,
    // fractional, unsafe, non-numeric) is never summed — so it can neither PASS nor offset a valid count above budget —
    // and it makes the budget unprovable (HOLD) unless the valid counts already exceed it (FAIL).
    const validCount = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
    const readable = answered.filter((e) => validCount(e.diagnostics?.provider_attempts));
    const malformed = answered.length - readable.length;
    const providerAttemptsReported = readable.reduce((sum, e) => sum + Number(e.diagnostics!.provider_attempts), 0);
    const perSession = (budget.oneRequestPerSession ?? []).map((id) => tap.exchanges.filter((e) => e.sent.sessionId === id).length);
    const exceeded = tap.sentCount > budget.maximum || providerAttemptsReported > budget.maximum || perSession.some((n) => n > 1);
    const unprovable = !exceeded && (malformed > 0 || readable.length !== tap.sentCount || answered.length !== tap.sentCount);
    const verdict: Verdict = exceeded ? 'FAIL' : unprovable ? 'HOLD' : 'PASS';
    receipt.row('coaching request budget', verdict,
        verdict === 'PASS' ? `the whole scenario sent at most ${budget.maximum} coaching request(s) and the Edge reported at most ${budget.maximum} provider attempt(s)`
            : verdict === 'FAIL' ? 'the scenario exceeded its coaching request or Edge-reported provider-attempt budget, or a take was requested twice'
                : 'a sent coaching request has no readable Edge diagnostics, so provider invocations are unproven',
        {
            maximum: budget.maximum, browserRequests: tap.sentCount, answered: answered.length,
            withDiagnostics: readable.length, malformedProviderAttempts: malformed, providerAttemptsReported,
            maxRequestsForOneTake: perSession.length > 0 ? Math.max(...perSession) : 0,
        });
}
