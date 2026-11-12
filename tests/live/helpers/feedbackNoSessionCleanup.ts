/**
 * AHT-08 report cleanup (board: "report cleanup (S)", same go as AHT-07, one report per run). Before this, the no-session
 * scenario deleted its disposable account and proved the report was RETAINED (`user_issue_reports.user_id` is ON DELETE SET
 * NULL), then left that report behind with no owner. It now runs AHT-07's race-safe steps unchanged (feedbackReportCleanup.ts:
 * capture by uid and key before the deletion, re-capture, delete by id with an exact count, independent zero-residue reads).
 *
 * AHT-08 has no attempt ledger and never faults a write, so whether a write's server outcome is known comes from the submit's
 * own observation (plus the pass-through route's drain, below). This is that mapping, pure:
 *  - never submitted: no write was made, so nothing is uncertain;
 *  - submitted, and the stored read bound exactly one row to exactly one observed key with every insert attributed: certain;
 *  - anything else after a Submit (no key seen, more than one key, an unattributed insert, no stored row read, or the submit
 *    threw before its read): the one write's outcome is unknown, so `zero residue` HOLDs instead of PASSing on a zero read;
 *  - a pass-through route handler still in flight after the drain (or a drain that was never observed) is an unknown write too.
 *
 * Surviving runner loss (AHT-07/08 recovery-store proposal 2026-11-12, §8; Sam, #1811 RETURN on d1487bdb, item 2). The in-run
 * cleanup above is no longer the only path. The no-session test now:
 *  1. gates on a verified recovery store (`verifyRecoveryStore`) BEFORE the account exists, or HOLDs before any production write;
 *  2. opens the run's AHT-08 inventory (`aht08-…`, its own schema) and records the owner uid durably as soon as the account is
 *     created, before any submit;
 *  3. installs `NoSessionReportRoute`, a PASS-THROUGH OBSERVER on the report insert only. It records and fsyncs the insert's key
 *     BEFORE forwarding the request unchanged; a key it cannot record is aborted, never sent. It injects no fault, answers
 *     nothing itself and adds no attempt (no retry, no cap ledger);
 *  4. records every settle, and at the end stops the route BEFORE the drain; only a drain that found nothing in flight writes
 *     the writer-stopped record that recovery requires.
 * A second executor (feedbackRecoveryExecutor.ts) can then find the report by its recorded key after the account deletion nulled
 * `user_id`, and delete exactly that id.
 * KNOWN LIMIT: a runner killed before it writes its writer-stopped record cannot be recovered by this design. Recovery HOLDs,
 * deletes nothing and keeps the file, and the report stays until its owner settles it by hand. No timeout, file age or silence
 * stands in for the stopped record.
 * Case-only helper: nothing AHT-01 loads imports it.
 */
import type { WriteUncertainty } from './feedbackReportCleanup';
import { classifyInsertBody } from './feedbackDiagnosticRef';
import { type FeedbackRecoveryInventory, recordDurably } from './feedbackRecoveryInventory';

/** What the submit's insert observer saw, snapshotted when the submit ends (also when it throws). */
export interface NoSessionInsertSnapshot {
    keys: readonly string[];
    insertRequests: number;
    unattributedInserts: number;
    /**
     * Pass-through route handlers still in flight after the finalizer's drain: 0 when the drain found none, null when no drain
     * result exists. Absent (a snapshot from the submit alone) counts as 0.
     */
    inFlightAfterDrain?: number | null;
}

export function noSessionWriteUncertainty(input: {
    submitted: boolean;
    inserts: NoSessionInsertSnapshot | null;
    reportId: string | null;
    storedRows: number | null;
}): WriteUncertainty {
    const i = input.inserts;
    const pending = i?.inFlightAfterDrain === undefined ? 0 : i.inFlightAfterDrain;
    if (!input.submitted) return { pending, uncertain: [] };
    const certain = !!i && i.keys.length === 1 && i.unattributedInserts === 0 && i.insertRequests >= 1
        && typeof input.reportId === 'string' && input.reportId.length > 0 && input.storedRows === 1;
    return { pending, uncertain: certain ? [] : [1] };
}

// ── The pass-through observer route on the report insert ────────────────────────────────────────────────────────────────
/** The slice of Playwright's `Route` this route uses (structural, so unit controls drive it with a fake). */
export interface PassThroughRoute<R extends { status(): number }> {
    request(): { method(): string; postDataJSON(): unknown };
    fallback(): Promise<void>;
    abort(errorCode?: string): Promise<void>;
    fetch(): Promise<R>;
    fulfill(options: { response: R }): Promise<void>;
}

/** What the route saw. The keys never leave memory except into the inventory and the run's own cleanup reads. */
export interface NoSessionRouteObservation { keys: string[]; recorded: number; refused: number }

const READS = ['GET', 'HEAD', 'OPTIONS'];

/**
 * AHT-08's pass-through observer on `user_issue_reports` writes. For each write: a read is passed on untouched; an insert that
 * carries exactly one valid idempotency key is recorded and fsynced in the run's inventory FIRST, then forwarded unchanged
 * (`route.fetch()`), its settle recorded, and its own answer returned to the page (`route.fulfill({ response })`). Anything it
 * cannot record (no single valid key, a non-insert write, a full or lost store, or a write after `stop()`) is aborted unsent.
 * No fault injection, no synthetic answer, no retry and no attempt cap: the page's one Submit is the only attempt.
 */
export class NoSessionReportRoute {
    private ordinal = 0;
    private inFlight = 0;
    private stopped = false;
    readonly keys: string[] = [];
    /** Writes aborted unsent because they could not be recorded. */
    refused = 0;

    constructor(private readonly inventory: FeedbackRecoveryInventory) {}

    async handle<R extends { status(): number }>(route: PassThroughRoute<R>): Promise<void> {
        const request = route.request();
        const method = request.method();
        if (READS.includes(method)) return route.fallback();
        this.inFlight += 1;
        try {
            let body: unknown = null;
            try { body = request.postDataJSON(); } catch { body = null; }
            const { keys, unattributed } = classifyInsertBody(body);
            const recordable = !this.stopped && method === 'POST' && keys.length === 1 && unattributed === 0;
            const ordinal = this.ordinal + 1;
            // Recorded and fsynced BEFORE anything can leave the browser. A key that cannot be recorded is aborted, never sent.
            if (!recordable || !recordDurably(this.inventory, { ordinal, action: 'forward', keys })) {
                this.refused += 1;
                return await route.abort('failed');
            }
            this.ordinal = ordinal;
            if (!this.keys.includes(keys[0])) this.keys.push(keys[0]);
            let response: R;
            try { response = await route.fetch(); } catch {
                // Forwarded with no answer: the server may or may not have committed. Recovery resolves it only by its commit.
                this.inventory.recordSettle({ ordinal, status: null, forwarded: null });
                return await route.abort('failed');
            }
            this.inventory.recordSettle({ ordinal, status: response.status(), forwarded: true });
            return await route.fulfill({ response });
        } catch {
            // The page closed under the route: the attempt line (if any) is already durable.
            return undefined;
        } finally {
            this.inFlight = Math.max(0, this.inFlight - 1);
        }
    }

    /** Close the door: from here every write is aborted unsent (the inventory takes no new attempt). Called BEFORE the drain. */
    stop(): void {
        this.stopped = true;
        this.inventory.stop();
    }

    get pending(): number { return this.inFlight; }

    /** Wait (bounded) for handlers in flight; returns how many are still in flight. */
    async drain(ms: number, pollMs = 100): Promise<number> {
        const deadline = Date.now() + ms;
        while (this.inFlight > 0 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, pollMs));
        return this.inFlight;
    }

    observation(): NoSessionRouteObservation {
        return { keys: [...this.keys], recorded: this.ordinal, refused: this.refused };
    }
}

/**
 * Pure. The submit's snapshot with the route's drain folded in: every key the route recorded joins the run's keys (so cleanup
 * and its residue reads cover a write the submit observer never saw), and the drain's result decides `inFlightAfterDrain`.
 * With no route (the store gate halted first) the snapshot is returned unchanged.
 */
export function withRouteDrain(
    snapshot: NoSessionInsertSnapshot | null, route: NoSessionRouteObservation | null, pendingAfterDrain: number | null,
): NoSessionInsertSnapshot | null {
    if (!route) return snapshot;
    const keys = [...new Set([...(snapshot?.keys ?? []), ...route.keys])];
    const base: NoSessionInsertSnapshot = snapshot ?? { keys: [], insertRequests: 0, unattributedInserts: 0 };
    return { ...base, keys, inFlightAfterDrain: pendingAfterDrain };
}
