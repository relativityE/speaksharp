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
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type Page } from '@playwright/test';
import type { CoachingExchange, CoachingSentRequest, CoachingSuggestionPair } from './coachingGenerationTap';
import { EDGE_MAX_PROVIDER_ATTEMPTS, buildRwtCoachingEvidenceArtifact, coachingContract, writeRwtCoachingEvidenceArtifact, type RwtCoachingTakeEvidence } from './rwtCoachingEvidence';
import { takesDifferVerdict } from './rwtCoachingConsistency';

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

export type SavedPromptObservation =
    | { state: 'available'; saved: SavedPromptInputs; totalWords: number | null }
    | { state: 'query_error' | 'missing' | 'expired' | 'malformed' | 'identity_mismatch' };

/** The saved inputs the Edge function builds its prompt from, scoped to the run-owned account and session. */
export async function readSavedPromptInputs(admin: AdminClient, userId: string, sessionId: string, product: Product): Promise<SavedPromptInputs | null> {
    const observed = await readSavedPromptObservation(admin, userId, sessionId, product);
    return observed.state === 'available' ? observed.saved : null;
}

/** Expiry is an explicit state, never evidence that inputs or coaching were previously saved. */
export async function readSavedPromptObservation(admin: AdminClient, userId: string, sessionId: string, product: Product, isActive = () => true): Promise<SavedPromptObservation> {
    const { data: row, error } = await admin.from('sessions').select(`id, user_id, product, transcript, transcript_state, total_words, ${PROMPT_METRIC_KEYS.join(', ')}`)
        .eq('id', sessionId).eq('user_id', userId).maybeSingle();
    if (!isActive()) return { state: 'query_error' };
    if (error) return { state: 'query_error' };
    if (!row) return { state: 'missing' };
    if (row.id !== sessionId || row.user_id !== userId || row.product !== product) return { state: 'identity_mismatch' };
    if (row.transcript_state === 'expired' && row.transcript === null) return { state: 'expired' };
    if (row.transcript_state !== 'available' || typeof row.transcript !== 'string' || !row.transcript.trim()) return { state: 'malformed' };
    const transcript = row.transcript;
    const metrics = Object.fromEntries(PROMPT_METRIC_KEYS.map((k) => [k, (row[k] ?? null) as Json])) as Record<string, Json>;
    const transcriptState = row.transcript_state;
    // Evidence for the two-take consistency check only. total_words is NOT a provider prompt input.
    const totalWords = Number.isSafeInteger(row.total_words) && Number(row.total_words) >= 0 ? Number(row.total_words) : null;
    if (product === 'open_mic') return { state: 'available', totalWords, saved: { transcript, metrics, promptContext: { transcriptState, focusContext: { kind: 'none' } } } };
    // Mirrors the Edge function's loadFocusContext over the same tables, keyed by the run-owned session.
    const { data: objective, error: oErr } = await admin.from('objective_session').select('id, brief_id')
        .eq('source_session_id', sessionId).eq('user_id', userId).order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (!isActive()) return { state: 'query_error' };
    if (oErr) return { state: 'query_error' };
    if (!objective) return { state: 'missing' };
    const [brief, points, evidence] = await Promise.all([
        admin.from('objective_brief').select('event_goal').eq('id', objective.brief_id).eq('user_id', userId).maybeSingle(),
        admin.from('objective_brief_point').select('id, label, sort_order').eq('brief_id', objective.brief_id).eq('user_id', userId).order('sort_order', { ascending: true }),
        admin.from('objective_evidence').select('brief_point_id, verdict, detected_at_seconds').eq('session_id', objective.id).eq('user_id', userId),
    ] as const);
    if (brief.error || points.error || evidence.error) return { state: 'query_error' };
    const pointRows = (points.data ?? []) as Array<{ id: string; label: string }>;
    const evidenceRows = (evidence.data ?? []) as Array<{ brief_point_id: string; verdict: string; detected_at_seconds: number | null }>;
    if (!brief.data || pointRows.length === 0 || evidenceRows.length !== pointRows.length) return { state: 'malformed' };
    const byPoint = new Map(evidenceRows.map((r) => [r.brief_point_id, r]));
    const verdicts = new Set(['detected', 'not_detected', 'unavailable']);
    if (byPoint.size !== pointRows.length || pointRows.some((p) => typeof p.label !== 'string' || !verdicts.has(byPoint.get(p.id)?.verdict ?? ''))) return { state: 'malformed' };
    const goal = brief.data?.event_goal;
    const topic = typeof goal === 'string' ? goal : null;
    return { state: 'available', totalWords, saved: {
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
    } };
}

/** The trusted authority readback (service role), restricted to the run-owned account's row. */
export async function readAuthority(admin: AdminClient, userId: string, sessionId: string): Promise<AuthorityReadback | null> {
    const { data, error } = await admin.rpc('read_ai_suggestion_authority_v1', { p_session_ids: [sessionId] });
    if (error || !Array.isArray(data)) return null;
    const row = (data as AuthorityReadback[]).find((r) => r.session_id === sessionId && r.user_id === userId);
    return row ?? null;
}

export type CapturedCoachingTake =
    | { take: RwtCoachingTakeEvidence; totalWords: number | null }
    | { hold: string }
    | { fail: 'saved_identity_mismatch' | 'saved_evidence_changed' };

/** Own every nested value: later tap/DB/DOM mutation must not rewrite an earlier observation. */
function immutableCopy<T>(value: T): T {
    const copy = structuredClone(value);
    const freeze = (item: unknown): void => {
        if (!item || typeof item !== 'object' || Object.isFrozen(item)) return;
        Object.values(item).forEach(freeze);
        Object.freeze(item);
    };
    freeze(copy);
    return copy;
}

/** A positive witness requires an independently read SAVED pair, not the HTTP answer or the fact of expiry. */
export function captureCoachingTake(input: {
    identity: TakeIdentity;
    exchanges: readonly CoachingExchange[];
    observed: SavedPromptObservation;
    authority: AuthorityReadback | null;
    rendered: CoachingSuggestionPair | null;
}): CapturedCoachingTake {
    if (input.observed.state === 'identity_mismatch') return { fail: 'saved_identity_mismatch' };
    if (input.observed.state !== 'available') return { hold: `saved_inputs_${input.observed.state}` };
    const assembled = assembleTake({ ...input, saved: input.observed.saved });
    return immutableCopy('take' in assembled ? { ...assembled, totalWords: input.observed.totalWords } : assembled);
}

/** Use the existing artifact validators for BOTH witnesses before a saved-word-count comparison can PASS. */
export function capturedTakesDifferVerdict(first: CapturedCoachingTake, second: CapturedCoachingTake, releaseSha: string): ReturnType<typeof takesDifferVerdict> {
    if ('fail' in first || 'fail' in second) return { status: 'FAIL', detail: 'a saved take changed or does not match its run-owned identity' };
    if (!('take' in first) || !('take' in second)) return takesDifferVerdict(null, null, null);
    try {
        const artifact = buildRwtCoachingEvidenceArtifact({ releaseSha, firstTake: first.take, repeatTake: second.take });
        const bindings = [artifact.firstTake.promptBinding.verdict, artifact.repeatTake.promptBinding.verdict];
        if (bindings.includes('FAIL')) return { status: 'FAIL', detail: 'a captured take failed its saved-input generation binding' };
        if (bindings.includes('HOLD')) return { status: 'HOLD', detail: 'a captured take lacks proven saved-input generation binding' };
    } catch {
        return { status: 'FAIL', detail: 'captured coaching failed the saved-pair or take-identity contract' };
    }
    const pair = (take: RwtCoachingTakeEvidence) => ({ well: take.authorityReceipt.ai_suggestions.what_worked, next: take.authorityReceipt.ai_suggestions.what_to_try_next });
    return takesDifferVerdict(pair(first.take), pair(second.take),
        first.totalWords === null || second.totalWords === null ? null : first.totalWords !== second.totalWords);
}

/** Read identity and visible content in ONE browser turn. A B/C transition cannot splice two different DOM states. */
export async function readLiveCoachingPair(page: Pick<Page, 'evaluate'>, product: Product): Promise<{ sessionId: string; pair: CoachingSuggestionPair } | null> {
    return page.evaluate((kind) => {
        const root = document.documentElement;
        const sessionId = root.getAttribute('data-session-persisted-id');
        const card = document.querySelector('[data-testid="ai-suggestions-card"][data-review-state="ready"]');
        const block = card?.querySelector('[data-testid="ai-suggestions-pair"]');
        if (!sessionId || root.getAttribute('data-session-persisted') !== 'true' || !block || block.getClientRects().length === 0) return null;
        const text = (id: string) => {
            const el = block.querySelector<HTMLElement>(`[data-testid="${id}"]`);
            return el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden' ? el.innerText.trim() : '';
        };
        const well = text('review-what-went-well');
        const next = text('review-try-next');
        return well && next ? { sessionId, pair: { version: kind === 'focus_points' ? 'gemini_coaching_focus_v1' as const : 'gemini_coaching_v1' as const, what_worked: well, what_to_try_next: next } } : null;
    }, product);
}

/**
 * Transient synthetic witnesses, keyed by exact session ID, not take order. Start alongside Practice again, never await
 * a coaching result before its rapid Repeat press. An interrupted B with no positive saved/rendered witness stays HOLD;
 * C can never stand in for B. No navigation, provider call, retry or durable write is performed by this observer.
 */
export const COACHING_CAPTURE_READ_TIMEOUT_MS = 5_000;

export function createCoachingTakeCapture(input: {
    page: Page;
    admin: AdminClient;
    tap: { exchanges: readonly CoachingExchange[]; inFlight(): { sent: CoachingSentRequest }[] };
    fixture: { key: string; kind: string; sha256?: string };
    suiteId: string;
    product: Product;
    userId: string;
    /** Injectable only for offline tests; production reads the page atomically above. */
    readRendered?: () => Promise<{ sessionId: string; pair: CoachingSuggestionPair } | null>;
}) {
    const captures = new Map<string, CapturedCoachingTake>();
    const witnesses = new Map<string, Extract<CapturedCoachingTake, { take: RwtCoachingTakeEvidence }>>();
    // A timed-out transport may still be pending. Do not stack more reads behind it or accept its late answer.
    const reading = new Set<string>();
    const activeReads = new Set<Promise<void>>();
    const cancellations = new Set<() => void>();
    const runId = `${process.env.GITHUB_RUN_ID ?? 'local'}-${process.env.GITHUB_RUN_ATTEMPT ?? '1'}`;
    const synthetic = input.fixture.kind === 'synthetic' && Boolean(input.fixture.sha256);
    let stopped = false;
    let disposed = false;
    let started = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pending: Promise<void> = Promise.resolve();
    const get = (id: string | null): CapturedCoachingTake => disposed ? { hold: 'capture_disposed' }
        : !synthetic ? { hold: 'collector_synthetic_only' }
            : id ? captures.get(id) ?? { hold: 'saved_take_not_witnessed' } : { hold: 'saved_take_identity_unavailable' };
    const sample = async (sessionId: string, rendered?: CoachingSuggestionPair | null): Promise<void> => {
        if (disposed || !synthetic || reading.has(sessionId) || ('fail' in get(sessionId))) return;
        reading.add(sessionId);
        let active = true;
        let deadline: ReturnType<typeof setTimeout>;
        let cancel: () => void;
        const timeout = new Promise<CapturedCoachingTake>((resolve) => {
            cancel = () => { active = false; clearTimeout(deadline); resolve({ hold: 'capture_disposed' }); };
            deadline = setTimeout(() => { active = false; resolve({ hold: 'saved_evidence_read_timeout' }); }, COACHING_CAPTURE_READ_TIMEOUT_MS);
            cancellations.add(cancel);
        });
        const read = (async (): Promise<CapturedCoachingTake> => {
          try {
            const observed = await readSavedPromptObservation(input.admin, input.userId, sessionId, input.product, () => active && !disposed);
            if (!active || disposed) return { hold: 'saved_evidence_read_timeout' };
            const authority = observed.state === 'available' ? await readAuthority(input.admin, input.userId, sessionId) : null;
            if (!active || disposed) return { hold: 'saved_evidence_read_timeout' };
            const previous = witnesses.get(sessionId);
            if (previous && observed.state === 'expired') {
                return previous; // Explicit, identity-checked expiry preserves only a prior positive witness.
            } else if (previous && observed.state === 'malformed') {
                return { fail: 'saved_evidence_changed' };
            } else if (previous && observed.state === 'available') {
                const savedBefore = previous.take.savedInputReadback;
                const unchangedInputs = savedBefore.transcript === observed.saved.transcript && previous.totalWords === observed.totalWords
                    && JSON.stringify(savedBefore.metrics) === JSON.stringify(observed.saved.metrics)
                    && JSON.stringify(savedBefore.promptContext) === JSON.stringify(observed.saved.promptContext);
                const before = previous.take.authorityReceipt;
                const unchangedPair = authority && ['session_id', 'user_id', 'provider', 'model', 'provider_request_made', 'receipt_suggestion_sha256', 'current_suggestion_sha256', 'ai_suggestions']
                    .every((key) => JSON.stringify(before[key as keyof typeof before]) === JSON.stringify(authority[key as keyof AuthorityReadback]));
                return !unchangedInputs ? { fail: 'saved_evidence_changed' }
                    : !authority?.ai_suggestions ? { hold: 'server_authority_readback_unavailable' }
                        : unchangedPair ? previous : { fail: 'saved_evidence_changed' };
            } else {
                const shown = rendered === undefined ? await (input.readRendered?.() ?? readLiveCoachingPair(input.page, input.product)) : null;
                if (!active || disposed) return { hold: 'saved_evidence_read_timeout' };
                return captureCoachingTake({
                identity: { runId, suiteId: input.suiteId, product: input.product, fixtureName: input.fixture.key,
                    fixtureSha256: input.fixture.sha256!, sessionId, userId: input.userId },
                exchanges: input.tap.exchanges, observed, authority,
                rendered: rendered === undefined ? (shown?.sessionId === sessionId ? shown.pair : null) : rendered,
                });
            }
          } catch { return { hold: 'saved_evidence_query_error' }; }
          finally { reading.delete(sessionId); }
        })();
        const bounded = Promise.race([read, timeout]).then((captured) => {
            if (!disposed) {
                captures.set(sessionId, captured);
                if ('take' in captured && !witnesses.has(sessionId)) witnesses.set(sessionId, captured);
            }
        }).finally(() => { active = false; clearTimeout(deadline); cancellations.delete(cancel); });
        activeReads.add(bounded);
        try { await bounded; } finally { activeReads.delete(bounded); }
    };
    const poll = (): void => {
        if (stopped || disposed || !synthetic) return;
        pending = (async () => {
            const ids = new Set([...input.tap.exchanges.map((e) => e.sent.sessionId), ...input.tap.inFlight().map((e) => e.sent.sessionId)]);
            for (const id of ids) if (id && !stopped && !disposed) await sample(id);
        })().finally(() => { if (!stopped && !disposed) timer = setTimeout(poll, 250); });
    };
    return {
        sample, get,
        start: () => { if (!started && !stopped && !disposed) { started = true; poll(); } },
        stop: async () => { stopped = true; clearTimeout(timer); await Promise.all([pending, ...activeReads]); },
        dispose: async () => {
            disposed = true; stopped = true; clearTimeout(timer); captures.clear(); witnesses.clear();
            for (const cancel of cancellations) cancel();
            await Promise.all([pending, ...activeReads]);
        },
    };
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
    /** Prior positive witnesses; when supplied, NEVER fall back to late DB reads or another session. */
    captured?: { get(sessionId: string | null): CapturedCoachingTake };
}): Promise<void> {
    const { receipt, page, admin, product, userId } = input;
    if (input.fixture.kind !== 'synthetic' || !input.fixture.sha256) {
        receipt.row('coaching prompt binding', 'HOLD', 'the restricted collector runs only on a synthetic fixture', { reason: 'collector_synthetic_only' });
        return;
    }
    const version: CoachingSuggestionPair['version'] = product === 'focus_points' ? 'gemini_coaching_focus_v1' : 'gemini_coaching_v1';
    const destination = resolvePrivateEvidenceDir(process.env.RWT_PRIVATE_EVIDENCE_DIR, forbiddenEvidenceRoots(input.outputDirs));
    if (input.captured) {
        const firstTake = input.captured.get(input.firstSessionId);
        const repeatTake = input.captured.get(input.repeatSessionId);
        if ('fail' in firstTake || 'fail' in repeatTake) {
            receipt.row('coaching prompt binding', 'FAIL', 'a saved take changed or does not match its run-owned identity',
                { reason: 'fail' in firstTake ? firstTake.fail : 'fail' in repeatTake ? repeatTake.fail : 'saved_identity_mismatch' });
            return;
        }
        // totalWords is comparison-only evidence; it must never enter the strict artifact or provider-prompt shape.
        const evidence = (captured: Exclude<CapturedCoachingTake, { fail: string }>) => 'take' in captured ? { take: captured.take } : captured;
        const outcome = coachingEvidenceOutcome({ releaseSha: input.releaseSha, destination, firstTake: evidence(firstTake), repeatTake: evidence(repeatTake) });
        receipt.row('coaching prompt binding', outcome.verdict, outcome.detail, outcome.evidence);
        return;
    }
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
 *
 * #1258 RWT round 2 (run 38876644751, PM 6216341052) — ONE REQUEST MAY COST UP TO `EDGE_MAX_PROVIDER_ATTEMPTS` PROVIDER
 * ATTEMPTS. Merge 2's shipped Edge retry (#1624) spends up to that many attempts inside one request's 45 s budget, so the
 * old rule — provider attempts bounded by the same `maximum` as browser requests — refused the shipped contract (2
 * requests that each retried read as a breach). The browser-request cap and one-request-per-take are unchanged. Provider
 * attempts are now bounded TWICE: in aggregate by `maximum × EDGE_MAX_PROVIDER_ATTEMPTS`, AND per request by
 * `EDGE_MAX_PROVIDER_ATTEMPTS`, so a request over the server cap can never hide behind another request's underspend.
 */
const sha = (v: string | null): string => (v ? createHash('sha256').update(v, 'utf8').digest('hex') : '-');
const n = (v: number | null | undefined): string => (Number.isFinite(v) ? String(v) : '-');
/**
 * #1593 — one record per exchange, in arrival order: `outcome|status|sentAt|recordedAt|clientMs|requestSha256|attemptSha256|clientAttempt`
 * (epoch ms; `-` when absent). Content-free: hashed ids and numbers only.
 */
export function exchangeTimeline(exchanges: readonly CoachingExchange[]): string {
    return exchanges.map((e) => [e.outcome ?? '-', n(e.status), n(e.sentAt), n(e.at), n(e.clientMs), sha(e.sent.requestId),
        sha(e.sent.attemptId), n(e.sent.clientAttempt)].join('|')).join(';');
}

/**
 * #1593 (Sam, #1656 review) — the requests STILL OPEN when the row is written, one record each:
 * `in_flight|statusSeen|sentAt|ageMs|requestSha256|attemptSha256|clientAttempt`. Nonterminal and separate from
 * `exchangeTimeline`, so an in-flight request is correlatable (its hashes are captured at the request event) without
 * being counted as answered or unanswered.
 */
export function inFlightTimeline(open: readonly { sent: CoachingExchange['sent']; sentAt: number | null; ageMs: number | null; status: number | null }[]): string {
    return open.map((o) => ['in_flight', n(o.status), n(o.sentAt), n(o.ageMs), sha(o.sent.requestId), sha(o.sent.attemptId),
        n(o.sent.clientAttempt)].join('|')).join(';');
}

export function coachingRequestBudgetRow(
    receipt: ReceiptLike,
    tap: { sentCount: number; exchanges: readonly CoachingExchange[]; inFlight?: () => { sent: CoachingExchange['sent']; sentAt: number | null; ageMs: number | null; status: number | null }[] },
    budget: { maximum: number; oneRequestPerSession?: readonly string[]; sessionIdsVerified?: boolean },
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
    const providerAttemptAllowance = budget.maximum * EDGE_MAX_PROVIDER_ATTEMPTS;
    const maxProviderAttemptsForOneRequest = readable.reduce((m, e) => Math.max(m, Number(e.diagnostics!.provider_attempts)), 0);
    const exceeded = tap.sentCount > budget.maximum || providerAttemptsReported > providerAttemptAllowance
        || maxProviderAttemptsForOneRequest > EDGE_MAX_PROVIDER_ATTEMPTS || perSession.some((n) => n > 1);
    const unprovable = !exceeded && (budget.sessionIdsVerified === false
        || malformed > 0 || readable.length !== tap.sentCount || answered.length !== tap.sentCount);
    const verdict: Verdict = exceeded ? 'FAIL' : unprovable ? 'HOLD' : 'PASS';
    // #1474 (Sam 6242612760): how each unproven exchange ended, as observed after settling every sent request.
    const outcomeCount = (o: CoachingExchange['outcome']) => tap.exchanges.filter((e) => e.outcome === o).length;
    const unansweredAtBound = outcomeCount('unanswered');
    const bodyPendingAtBound = outcomeCount('body_pending');
    const failedInBrowser = outcomeCount('failed');
    // #1593 (Sam case-1 diagnosis): a request still inside its own allowance when the scenario ended is left OPEN by
    // settle() — not closed as unanswered — so it is counted here, and it keeps the budget unprovable (HOLD), never PASS.
    const inFlightAtEnd = Math.max(0, tap.sentCount - tap.exchanges.length);
    const holdReason = budget.sessionIdsVerified === false
        ? 'final saved-take identities could not be verified, so the per-take coaching budget is unproven'
        : inFlightAtEnd > 0
        ? 'a sent coaching request was still inside its allowance when the scenario ended, so provider invocations are unproven'
        : unansweredAtBound > 0
        ? 'a sent coaching request was still unanswered when the bounded wait ended, so provider invocations are unproven'
        : bodyPendingAtBound > 0
            ? 'a coaching response body was still unread when the bounded wait ended, so provider invocations are unproven'
            : failedInBrowser > 0
                ? 'a sent coaching request failed in the browser before an answer, so provider invocations are unproven'
                : 'a sent coaching request has no readable Edge diagnostics, so provider invocations are unproven';
    receipt.row('coaching request budget', verdict,
        verdict === 'PASS' ? `the whole scenario sent at most ${budget.maximum} coaching request(s); the Edge reported at most ${providerAttemptAllowance} provider attempt(s) in all and at most ${EDGE_MAX_PROVIDER_ATTEMPTS} for any one request`
            : verdict === 'FAIL' ? 'the scenario exceeded its coaching request budget, its provider-attempt allowance or the per-request provider-attempt cap, or a take was requested twice'
                : holdReason,
        {
            maximum: budget.maximum, browserRequests: tap.sentCount, answered: answered.length,
            withDiagnostics: readable.length, malformedProviderAttempts: malformed, providerAttemptsReported,
            providerAttemptAllowance, perRequestProviderAttemptCap: EDGE_MAX_PROVIDER_ATTEMPTS, maxProviderAttemptsForOneRequest,
            maxRequestsForOneTake: perSession.length > 0 ? Math.max(...perSession) : 0,
            unansweredAtBound, bodyPendingAtBound, failedInBrowser, inFlightAtEnd,
            // #1593 (Sam case-1 diagnosis): per-exchange, content-free correlation and timing, so each browser exchange can be
            // bound to the Edge's own diagnostic (which records the same SHA-256 of the request and attempt ids) instead of
            // inferred from order. Ids are hashed; no session id, text or token is published. Receipt evidence is scalar,
            // so the exchanges are one ';'-separated string (see exchangeTimeline).
            exchangeTimeline: exchangeTimeline(tap.exchanges),
            inFlightTimeline: inFlightTimeline(tap.inFlight?.() ?? []),
        });
}
