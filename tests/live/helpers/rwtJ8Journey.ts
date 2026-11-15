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
import type { ReceiptRowSink } from './feedbackDiagnosticRef';
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
    | { leg: J8Leg; action: 'forward'; keys: string[] }
    | { leg: 'J8.b'; action: 'ledger' }
    | { leg: J8Leg | null; action: 'abort'; reason: 'between-windows' | 'prior-write-unresolved' | 'not-an-insert' | 'attempt-cap' | 'unattributed-insert' | 'report-cap' };

/**
 * The one J8 write route's decision, made at route ENTRY and frozen there (Sam): a write outside an open leg window, or while an
 * earlier write is still unresolved, is aborted unsent. J8.a and J8.c each get the no-session bounds on their OWN keys and attempt
 * ordinal (one insert, one key, one same-key Retry); J8.b is handed to the AHT-07 attempt ledger, which applies its own caps.
 */
export class J8WriteGate {
    private window: J8Leg | null = null;
    private inFlight = 0;
    private readonly keys: Record<J8Leg, string[]> = { 'J8.a': [], 'J8.b': [], 'J8.c': [] };
    private readonly ordinals: Record<J8Leg, number> = { 'J8.a': 0, 'J8.b': 0, 'J8.c': 0 };
    readonly refused: Record<J8Leg | 'none', number> = { 'J8.a': 0, 'J8.b': 0, 'J8.c': 0, none: 0 };

    open(leg: J8Leg): void {
        if (this.window !== null) throw new Error(`J8 write window ${this.window} is still open`);
        this.window = leg;
    }
    close(leg: J8Leg): void {
        if (this.window !== leg) throw new Error(`J8 write window ${leg} is not the open one`);
        this.window = null;
    }
    get openLeg(): J8Leg | null { return this.window; }
    get pending(): number { return this.inFlight; }

    enter(method: string, body: () => unknown): J8WriteDecision {
        const leg = this.window;
        if (leg === null) {
            this.refused.none += 1;
            return { leg: null, action: 'abort', reason: 'between-windows' };
        }
        if (this.inFlight > 0) {
            this.refused[leg] += 1;
            return { leg, action: 'abort', reason: 'prior-write-unresolved' };
        }
        if (leg === 'J8.b') {
            this.inFlight += 1;
            return { leg, action: 'ledger' };
        }
        this.ordinals[leg] += 1;
        const d = noSessionWriteDecision({ method, body, ordinal: this.ordinals[leg], keysSeen: this.keys[leg] });
        if (d.action === 'cap-abort') {
            this.refused[leg] += 1;
            return { leg, action: 'abort', reason: d.reason ?? 'not-an-insert' };
        }
        for (const k of d.keys) if (!this.keys[leg].includes(k)) this.keys[leg].push(k);
        this.inFlight += 1;
        return { leg, action: 'forward', keys: d.keys };
    }
    /** The write admitted at entry has an outcome (answered, aborted or lost): the next one may enter. */
    settle(): void {
        if (this.inFlight > 0) this.inFlight -= 1;
    }
    keysOf(leg: J8Leg): readonly string[] { return [...this.keys[leg]]; }
}

/** One leg's evidence window for the readback: its own time window, its own action captures, and fault-leg journeys to drop. */
export interface J8LegEvidence {
    fromMs: number;
    toMs: number;
    bindings: readonly ReadbackActionBinding[];
    captures?: readonly ActionCaptureAttempt[];
    /** J8.b's fault legs: their `feedback_submit` events are never this leg's anchor (`withoutFaultLegSubmits`). */
    excludeJourneys?: readonly string[];
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
    return bindReadbackJourneys(own, { recording: [], feedback: true, actionBindings: bindings, actionCaptures: captures, ...ctx });
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

/** A non-reversible digest of a take's projection, computed privately in the test; the row itself never leaves this function. */
export function takeDigest(row: Record<string, unknown> | null | undefined): string | null {
    if (!row || typeof row.id !== 'string') return null;
    const projected = TAKE_PROJECTION_FIELDS.map((f) => [f, row[f] === undefined ? null : row[f]]);
    return createHash('sha256').update(JSON.stringify(projected)).digest('hex');
}

/**
 * J8.c leaves both takes exactly as they were: the same two identities, each with an equal projection digest before and after.
 * Counts alone could miss a changed or swapped take (Sam), so identity is compared per take, in order.
 */
export function takesUnchangedVerdict(takeIds: readonly [string, string],
    before: ReadonlyMap<string, string | null>, after: ReadonlyMap<string, string | null>):
    { status: 'PASS' | 'FAIL' | 'HOLD'; detail: string; evidence: Record<string, boolean | number> } {
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
    if (pairs.some((p) => p.b === null)) return { status: 'HOLD', detail: 'a saved take could not be read before the No-session submit', evidence };
    if (evidence.olderUnchanged && evidence.newerUnchanged && before.size === after.size) {
        return { status: 'PASS', detail: 'both saved takes are exactly as they were (same identities, equal saved and coaching fields)', evidence };
    }
    return { status: 'FAIL', detail: 'a saved take changed, disappeared or was replaced across the No-session submit', evidence };
}
