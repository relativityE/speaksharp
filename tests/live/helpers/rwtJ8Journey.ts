/**
 * J8 — feedback before and after takes, on ONE run-owned account (nine-journey design; Sam's disposition, 2026-11-15):
 *   J8.a  No-session feedback before any take;
 *   J8.b  two saved takes, the AHT-07 fault legs and the older-take submit;
 *   J8.c  "No session" chosen while both takes are listed: no take or coaching link, both takes unchanged.
 * One `AHT-07+AHT-08` fence (distinct-key caps 1/4/1, no borrowing), one finalizer, ONE receipt with three leg-scoped readback
 * results, each bound only to that leg's own action-time capture and submit events.
 *
 * Pure decisions only (no Playwright), so every rule is unit-tested with its failing controls in tests/unit/rwtJ8Journey.test.ts.
 * Receipts stay content-free: verdicts, counts, booleans and non-reversible digests; never ids, transcripts or feedback text.
 */
import { createHash } from 'node:crypto';
import { type ReceiptRowSink, classifyInsertBody } from './feedbackDiagnosticRef';
import { noSessionWriteDecision } from './feedbackNoSessionCleanup';
import type { ReadbackActionBinding } from './rwtAcceptance';
import { type ActionCaptureAttempt, type BindingMissReason, type ReadbackPlan, bindReadbackJourneys } from './rwtOracles';

export const J8_SUITE = 'feedback-association-boundaries-j8';
export const J8_LEGS = ['J8.a', 'J8.b', 'J8.c'] as const;
export type J8Leg = (typeof J8_LEGS)[number];
export const J8_FENCE_CASE = 'AHT-07+AHT-08' as const;
/** Distinct report keys per leg (Sam): J8.a one, J8.b the AHT-07 route's four, J8.c one. No leg borrows another's. */
export const J8_KEY_CAPS: Readonly<Record<J8Leg, number>> = Object.freeze({ 'J8.a': 1, 'J8.b': 4, 'J8.c': 1 });
/** The fence's distinct-key cap is the sum, so the route (per leg) always refuses before the fence does. */
export const J8_FENCE_KEY_CAP = J8_KEY_CAPS['J8.a'] + J8_KEY_CAPS['J8.b'] + J8_KEY_CAPS['J8.c'];

/** A row sink that scopes every row to one leg (`J8.a: …`), so a failed leg can never hide behind a passing one. */
export function legSink(sink: ReceiptRowSink, leg: J8Leg): ReceiptRowSink {
    return { row: (step, verdict, detail, evidence) => sink.row(`${leg}: ${step}`, verdict, detail, evidence) };
}

/**
 * The same leg scoping for helpers that also READ the receipt's rows (e.g. `feedbackDiagnosticChainRow`): it sees only its own
 * leg's rows, under their unscoped names, so a row another leg wrote can never stand in for this leg's.
 */
export function legReceipt<R extends { readonly rows: ReadonlyArray<{ step: string; verdict: string }> } & ReceiptRowSink>(receipt: R, leg: J8Leg):
    { readonly rows: ReadonlyArray<{ step: string; verdict: string }>; row: ReceiptRowSink['row'] } {
    const prefix = `${leg}: `;
    return {
        get rows() { return receipt.rows.filter((r) => r.step.startsWith(prefix)).map((r) => ({ ...r, step: r.step.slice(prefix.length) })); },
        row: (step, verdict, detail, evidence) => receipt.row(`${prefix}${step}`, verdict, detail, evidence),
    };
}

export type J8WriteDecision =
    | { leg: J8Leg; action: 'forward'; keys: string[]; attempt: number }
    | { leg: 'J8.b'; action: 'ledger'; keys: string[]; attempt: number }
    | { leg: J8Leg | null; action: 'abort'; reason: 'between-windows' | 'prior-write-unresolved' | 'cross-leg-key' | 'not-an-insert'
        | 'attempt-cap' | 'unattributed-insert' | 'report-cap' };

/**
 * How an admitted write ended (Sam on 94fe88d7). `answered`: the server's answer reached the route (whatever its status).
 * `committed-response-dropped`: the server's commit was OBSERVED (2xx) and only the browser's copy was dropped on purpose (J8.b's
 * stored-response-lost fault). `aborted-unsent`: refused before sending. `unknown`: the forward failed, so a commit may still be
 * pending server-side; that attempt stays UNRESOLVED, and no later write and no next leg may proceed past it.
 */
export type J8WriteOutcome = 'answered' | 'committed-response-dropped' | 'aborted-unsent' | 'unknown';

/**
 * The one J8 write route's decision, made at route ENTRY and frozen there (Sam): a write outside an open leg window, or while an
 * earlier write is unresolved, is aborted unsent. Every report key has ONE owner leg: a key first seen in one leg is refused in
 * any other (a late prior-leg request or a cross-leg replay). J8.a and J8.c each get the no-session bounds on their OWN keys and
 * attempt ordinal (one insert, one key, one same-key Retry); J8.b is handed to the AHT-07 attempt ledger, which applies its caps.
 * Each admitted write must be settled with its outcome; an `unknown` outcome keeps the gate blocked (no write, no next leg).
 */
export class J8WriteGate {
    private window: J8Leg | null = null;
    private readonly inFlight = new Map<number, { leg: J8Leg; keys: string[] }>();
    private readonly unresolved = new Map<number, { leg: J8Leg; keys: string[] }>();
    private nextAttempt = 1;
    private readonly keyOwner = new Map<string, J8Leg>();
    private readonly keys: Record<J8Leg, string[]> = { 'J8.a': [], 'J8.b': [], 'J8.c': [] };
    private readonly ordinals: Record<J8Leg, number> = { 'J8.a': 0, 'J8.b': 0, 'J8.c': 0 };
    readonly refused: Record<J8Leg | 'none', number> = { 'J8.a': 0, 'J8.b': 0, 'J8.c': 0, none: 0 };

    /** Opens a leg's window. Refused while another window is open or any earlier write is in flight or unresolved. */
    open(leg: J8Leg): void {
        if (this.window !== null) throw new Error(`J8 write window ${this.window} is still open`);
        if (this.inFlight.size > 0 || this.unresolved.size > 0) {
            throw new Error(`J8 write window ${leg} cannot open: ${this.inFlight.size} write(s) in flight, ${this.unresolved.size} with an unknown outcome`);
        }
        this.window = leg;
    }
    close(leg: J8Leg): void {
        if (this.window !== leg) throw new Error(`J8 write window ${leg} is not the open one`);
        this.window = null;
    }
    get openLeg(): J8Leg | null { return this.window; }
    /** Writes admitted and not yet settled. */
    get pending(): number { return this.inFlight.size; }
    /** Writes whose server outcome is unknown: each one blocks every later write and leg. */
    get unresolvedCount(): number { return this.unresolved.size; }

    enter(method: string, body: () => unknown): J8WriteDecision {
        const leg = this.window;
        if (leg === null) {
            this.refused.none += 1;
            return { leg: null, action: 'abort', reason: 'between-windows' };
        }
        if (this.inFlight.size > 0 || this.unresolved.size > 0) {
            this.refused[leg] += 1;
            return { leg, action: 'abort', reason: 'prior-write-unresolved' };
        }
        let parsed: unknown;
        try { parsed = body(); } catch { parsed = undefined; }
        const keys = classifyInsertBody(parsed).keys;
        if (keys.some((k) => this.keyOwner.has(k) && this.keyOwner.get(k) !== leg)) {
            this.refused[leg] += 1;
            return { leg, action: 'abort', reason: 'cross-leg-key' };
        }
        if (leg !== 'J8.b') {
            this.ordinals[leg] += 1;
            const d = noSessionWriteDecision({ method, body: () => parsed, ordinal: this.ordinals[leg], keysSeen: this.keys[leg] });
            if (d.action === 'cap-abort') {
                this.refused[leg] += 1;
                return { leg, action: 'abort', reason: d.reason ?? 'not-an-insert' };
            }
        }
        for (const k of keys) {
            this.keyOwner.set(k, leg);
            if (!this.keys[leg].includes(k)) this.keys[leg].push(k);
        }
        const attempt = this.nextAttempt++;
        this.inFlight.set(attempt, { leg, keys });
        return leg === 'J8.b' ? { leg, action: 'ledger', keys, attempt } : { leg, action: 'forward', keys, attempt };
    }
    /** Settles exactly the admitted attempt with its outcome. `unknown` keeps it unresolved (blocking); others release it. */
    settle(attempt: number, outcome: J8WriteOutcome): void {
        const w = this.inFlight.get(attempt);
        if (!w) throw new Error(`J8 write attempt ${attempt} was never admitted or is already settled`);
        this.inFlight.delete(attempt);
        if (outcome === 'unknown') this.unresolved.set(attempt, w);
    }
    keysOf(leg: J8Leg): readonly string[] { return [...this.keys[leg]]; }
}

/**
 * Sam on 94fe88d7: "no runner, no signup". J8 signs up and writes ONLY under the named nine-journey runner's admission: a record the
 * runner wrote for THIS run (same run id and attempt) naming the J8 suite and the account-create attempt it recorded BEFORE the
 * signup (its non-secret lookup reference, which becomes the signup email). Anything else, including discovery by the generic
 * deployed-live config or a direct invocation, is not admitted, and the test sends nothing.
 */
export type J8Admission = { admitted: true; lookupRef: string; attemptId: string } | { admitted: false; reason: string };
export const J8_ADMISSION_ENV = 'RWT_J8_RUNNER_ADMISSION';
const LOOKUP_REF = /^rwt-journey-[a-z0-9-]{4,80}@[a-z0-9.-]+\.[a-z]{2,}$/;
export function j8RunnerAdmission(env: Readonly<Record<string, string | undefined>>, readFile: (p: string) => string): J8Admission {
    const file = env[J8_ADMISSION_ENV];
    if (!file) return { admitted: false, reason: `no named-runner admission (${J8_ADMISSION_ENV} is not set); J8 never runs standalone` };
    let doc: Record<string, unknown>;
    try { doc = JSON.parse(readFile(file)) as Record<string, unknown>; } catch { return { admitted: false, reason: 'the runner admission record is unreadable' }; }
    if (doc?.suite !== J8_SUITE) return { admitted: false, reason: 'the runner admission does not name the J8 suite' };
    if (!env.GITHUB_RUN_ID || doc.runId !== env.GITHUB_RUN_ID || doc.runAttempt !== env.GITHUB_RUN_ATTEMPT) {
        return { admitted: false, reason: 'the runner admission is not bound to this run and attempt' };
    }
    const attempt = doc.createAttempt as { attemptId?: unknown; lookupRef?: unknown; recordedBeforeSend?: unknown } | undefined;
    if (!attempt || typeof attempt.attemptId !== 'string' || typeof attempt.lookupRef !== 'string' || !LOOKUP_REF.test(attempt.lookupRef)
        || attempt.recordedBeforeSend !== true) {
        return { admitted: false, reason: 'the runner admission carries no account-create attempt recorded before the signup' };
    }
    return { admitted: true, lookupRef: attempt.lookupRef, attemptId: attempt.attemptId };
}

/** One leg's evidence window for the readback: its own time window, its own action captures, and fault-leg journeys to drop. */
export interface J8LegEvidence {
    fromMs: number;
    toMs: number;
    bindings: readonly ReadbackActionBinding[];
    captures?: readonly ActionCaptureAttempt[];
    /** J8.b's fault legs: their `feedback_submit` events are never this leg's anchor (`withoutFaultLegSubmits`). */
    excludeJourneys?: readonly string[];
    /**
     * The leg's OWN independently observed submit proof (Sam on 94fe88d7): exactly one stored report under the submit's own observed
     * insert key(s). A readback target without it (a capture with no submit, or only a submit from before the action) is not proof.
     */
    stored?: { storedRows: number; insertKeys: number } | null;
}
type TapEvent = Parameters<typeof bindReadbackJourneys>[0][number];

/**
 * One leg's readback plan from ITS OWN evidence only (Sam: splitting the bindings alone is not enough — the oracle checks the
 * FIRST submit in the event set). Every `feedback_submit` outside the leg's window, or from a fault-leg journey, is removed, and
 * only the leg's own in-window `share_feedback` capture is offered, so another leg's event, capture or toast can never satisfy it.
 * A missing, duplicate or mismatched binding stays a missing binding for this leg (HOLD), never borrowed.
 */
export function legReadback(events: readonly TapEvent[], ev: J8LegEvidence,
    ctx: { expectedReleaseSha?: string; expectedRunId?: string; expectedRunAttempt?: string }): ReadbackPlan {
    const inWindow = (at: number) => at >= ev.fromMs && at <= ev.toMs;
    const exclude = new Set(ev.excludeJourneys ?? []);
    const own = events.filter((e) => e.event !== 'feedback_submit' || (inWindow(e.at) && !(e.journeyId && exclude.has(e.journeyId))));
    const bindings = ev.bindings.filter((b) => b.stage === 'share_feedback' && inWindow(b.capturedAt));
    const captures = (ev.captures ?? []).filter((c) => c.stage === 'share_feedback' && typeof c.at === 'number' && inWindow(c.at));
    const plan = bindReadbackJourneys(own, { recording: [], feedback: true, actionBindings: bindings, actionCaptures: captures, ...ctx });
    // A target is this leg's ONLY with its own submit AFTER its own capture, on that journey, and its own stored report.
    const submitAfterCapture = (journeyId: string) => bindings.some((b) => b.journeyId === journeyId
        && own.some((e) => e.event === 'feedback_submit' && e.journeyId === journeyId && inWindow(e.at) && e.at >= b.capturedAt));
    const storedOnce = ev.stored?.storedRows === 1 && (ev.stored?.insertKeys ?? 0) >= 1;
    const proven = plan.journeys.filter((j) => storedOnce && submitAfterCapture(j.journeyId));
    if (proven.length === plan.journeys.length) return plan;
    const missing = plan.missingBindings.includes('share_feedback') ? plan.missingBindings : [...plan.missingBindings, 'share_feedback'];
    return {
        ...plan, journeys: proven, missingBindings: missing,
        bindingReasons: { ...(plan.bindingReasons ?? {}), share_feedback: plan.bindingReasons?.share_feedback ?? 'anchor_not_sent' },
    };
}

/**
 * The ONE J8 receipt's readback: the three leg plans side by side. Missing bindings and their reasons are leg-scoped
 * (`J8.b:share_feedback`). A journey bound by more than one leg is borrowed evidence: it is dropped from every leg that bound it
 * and each of those legs is recorded missing (`duplicate_capture`), so no leg can pass on another's submit.
 */
export function mergeLegReadback(plans: Readonly<Record<J8Leg, ReadbackPlan>>): ReadbackPlan & { legJourneys: Record<J8Leg, string[]> } {
    const owners = new Map<string, J8Leg[]>();
    for (const leg of J8_LEGS) for (const j of plans[leg].journeys) owners.set(j.journeyId, [...(owners.get(j.journeyId) ?? []), leg]);
    const shared = new Set([...owners].filter(([, legs]) => legs.length > 1).map(([id]) => id));
    const journeys: ReadbackPlan['journeys'] = [];
    const missingBindings: string[] = [];
    const bindingReasons: Record<string, BindingMissReason> = {};
    const legJourneys = { 'J8.a': [], 'J8.b': [], 'J8.c': [] } as Record<J8Leg, string[]>;
    for (const leg of J8_LEGS) {
        const p = plans[leg];
        for (const j of p.journeys) {
            if (shared.has(j.journeyId)) {
                const label = `${leg}:share_feedback`;
                if (!missingBindings.includes(label)) missingBindings.push(label);
                bindingReasons[label] = 'duplicate_capture';
                continue;
            }
            journeys.push(j);
            legJourneys[leg].push(j.journeyId);
        }
        for (const label of p.missingBindings) {
            const scoped = `${leg}:${label}`;
            if (!missingBindings.includes(scoped)) missingBindings.push(scoped);
            bindingReasons[scoped] = p.bindingReasons?.[label] ?? 'no_capture';
        }
    }
    const bound = new Set(journeys.map((j) => j.journeyId));
    const reportedJourneyIds = [...new Set(J8_LEGS.flatMap((leg) => plans[leg].reportedJourneyIds))].filter((id) => !bound.has(id));
    return {
        journeys, reportedJourneyIds, missingBindings, legJourneys,
        ...(missingBindings.length > 0 ? { bindingReasons } : {}),
    };
}

/** The saved/coaching fields of a take that J8.c must leave exactly as they were (a deterministic projection). */
export const TAKE_PROJECTION_FIELDS = Object.freeze([
    'id', 'user_id', 'status', 'transcript', 'transcript_state', 'ai_suggestions', 'filler_counts', 'filler_words', 'total_words',
    'duration', 'engine', 'idempotency_key', 'created_at', 'updated_at',
] as const);

/**
 * A non-reversible digest of a take's projection, computed privately in the test; the row itself never leaves this function. Sam on
 * 936a9a5d: an absent field is NOT a null value. The row must be the owner's (`user_id` equal to `ownerId`) and carry EVERY projected
 * key (a null value is fine); otherwise the read is incomplete and there is no digest.
 */
export function takeDigest(row: Record<string, unknown> | null | undefined, ownerId: string): string | null {
    if (!row || typeof row.id !== 'string' || row.user_id !== ownerId) return null;
    if (!TAKE_PROJECTION_FIELDS.every((f) => Object.prototype.hasOwnProperty.call(row, f) && row[f] !== undefined)) return null;
    const projected = TAKE_PROJECTION_FIELDS.map((f) => [f, row[f]]);
    return createHash('sha256').update(JSON.stringify(projected)).digest('hex');
}

/**
 * Sam on 7a755749: the take read's OWN outcome. A failed query (an error, or no row array) is UNREADABLE (`null`), never an empty
 * map: an empty map is a successful read that found no rows, which after the submit proves a take went missing.
 */
export function readTakeDigests(result: { data: unknown; error: unknown }, ownerId: string): ReadonlyMap<string, string | null> | null {
    if (result.error || !Array.isArray(result.data)) return null;
    return new Map((result.data as Record<string, unknown>[]).map((r) => [String(r?.id), takeDigest(r, ownerId)]));
}

/** Both saved takes read completely and owner-bound: the precondition for opening J8.c (Sam on 94fe88d7). Unreadable is not. */
export function takesReadComplete(takeIds: readonly [string, string], digests: ReadonlyMap<string, string | null> | null): boolean {
    return digests !== null && new Set(takeIds).size === 2 && takeIds.every((id) => typeof digests.get(id) === 'string') && digests.size === 2;
}

/**
 * J8.c leaves both takes exactly as they were: the same two identities, each with an equal projection digest before and after.
 * Counts alone could miss a changed or swapped take (Sam), so identity is compared per take, in order.
 */
export function takesUnchangedVerdict(takeIds: readonly [string, string],
    beforeRead: ReadonlyMap<string, string | null> | null, afterRead: ReadonlyMap<string, string | null> | null):
    { status: 'PASS' | 'FAIL' | 'HOLD'; detail: string; evidence: Record<string, boolean | number> } {
    // Sam on 7a755749: an unreadable read is not evidence of anything (HOLD); only a SUCCESSFUL read that lacks a take is a FAIL.
    if (beforeRead === null || afterRead === null) {
        return { status: 'HOLD', detail: `the saved takes could not be read ${beforeRead === null ? 'before' : 'after'} the No-session submit`,
            evidence: { distinctTakes: new Set(takeIds).size === 2, readableBefore: beforeRead !== null, readableAfter: afterRead !== null } };
    }
    const before = beforeRead;
    const after = afterRead;
    const read = (m: ReadonlyMap<string, string | null>, id: string) => (m.has(id) ? m.get(id) ?? null : null);
    const pairs = takeIds.map((id) => ({ b: read(before, id), a: read(after, id) }));
    const evidence = {
        distinctTakes: new Set(takeIds).size === 2,
        olderReadBefore: pairs[0].b !== null, newerReadBefore: pairs[1].b !== null,
        olderUnchanged: pairs[0].b !== null && pairs[0].b === pairs[0].a,
        newerUnchanged: pairs[1].b !== null && pairs[1].b === pairs[1].a,
        rowsBefore: before.size, rowsAfter: after.size,
    };
    if (!evidence.distinctTakes) return { status: 'FAIL', detail: 'the two saved takes are not two distinct identities', evidence };
    if (pairs.some((p) => p.b === null)) return { status: 'HOLD', detail: 'a saved take could not be read completely before the No-session submit', evidence };
    // A take ABSENT after the submit was removed (FAIL); one present but read incompletely is not proof either way (HOLD, never PASS).
    if (takeIds.some((id) => !after.has(id))) return { status: 'FAIL', detail: 'a saved take disappeared across the No-session submit', evidence };
    if (pairs.some((p) => p.a === null)) return { status: 'HOLD', detail: 'a saved take could not be read completely after the No-session submit', evidence };
    if (evidence.olderUnchanged && evidence.newerUnchanged && before.size === after.size) {
        return { status: 'PASS', detail: 'both saved takes are exactly as they were (same identities, equal saved and coaching fields)', evidence };
    }
    return { status: 'FAIL', detail: 'a saved take changed, disappeared or was replaced across the No-session submit', evidence };
}

/**
 * Sam on 7a755749: the writer is drained only when nothing is in flight AND no write's server outcome is unknown. An unresolved
 * write may still commit, so it is HOLD (the fence close records it) and counted apart from in-flight writes.
 */
export function writerDrainedVerdict(o: { inFlight: number; unresolved: number }):
    { status: 'PASS' | 'HOLD'; detail: string; evidence: { inFlight: number; unresolved: number } } {
    const evidence = { inFlight: o.inFlight, unresolved: o.unresolved };
    const counted = Number.isInteger(o.inFlight) && o.inFlight >= 0 && Number.isInteger(o.unresolved) && o.unresolved >= 0;
    if (!counted) return { status: 'HOLD', detail: 'the writer\'s in-flight or unresolved writes could not be counted', evidence };
    if (o.inFlight === 0 && o.unresolved === 0) return { status: 'PASS', detail: 'no feedback write was in flight or unresolved when the writer stopped', evidence };
    const parts = [o.inFlight > 0 ? `${o.inFlight} write(s) still in flight` : null, o.unresolved > 0 ? `${o.unresolved} write(s) with an unknown server outcome` : null];
    return { status: 'HOLD', detail: `${parts.filter(Boolean).join(' and ')}; the fence close records any that commit`, evidence };
}
