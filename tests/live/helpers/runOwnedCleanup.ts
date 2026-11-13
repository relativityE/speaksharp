// Run-owned account cleanup for LIVE production proofs — extracted verbatim from the #1089 Private
// recording proof so every live proof shares ONE implementation.
//
// WHY EXTRACTED. This is the guarantee that a production proof leaves zero residue in a real customer
// database. Two copies of it would be two things to keep correct, and the second copy to drift would
// silently start orphaning real rows in production. A residue guarantee is exactly the kind of code
// that must not be duplicated.
//
// The ordering here is load-bearing and is preserved exactly:
//   1. Recover the UID if in-page capture missed it — never return silently after a signup that may
//      have created an account.
//   2. Cross-check UID -> email and refuse to delete anything that is not run-owned.
//   3. Clear every NON-CASCADING table BY user_id FIRST, while the column still holds it (see
//      PRE_DELETE_TABLES): a SET NULL FK survives `deleteUser()` as residue because the delete only
//      nulls the column.
//   4. Delete the auth user.
//   5. Prove deletion — ONLY an expected not-found re-fetch is proof. Any other error (network, auth,
//      rate limit) is NOT proof of deletion and must fail closed.
//   6. Assert ZERO rows across every run-owned cascade surface, then `trial_entitlements` by EMAIL
//      (keying on user_id there would read a false clean after step 4 nulled it).
//
// `user_issue_reports` is deliberately NOT deleted: its user_id FK is ON DELETE SET NULL BY DESIGN
// because the product intentionally retains "Report issue" feedback after account deletion. That is a
// feature, not residue, and scrubbing it would risk erasing real user feedback.
import { appendFileSync } from 'node:fs';
import { expect } from '@playwright/test';
import { isNotFoundError, pollForRecoveryUid } from './proofAuthority';
import { currentRunBinding, sameRunBinding, type RunBinding } from './runBinding';

/**
 * Write a MACHINE-READABLE cleanup verdict for the workflow's final `if: always()` step.
 *
 * "No second Playwright hook error" is not closure evidence — absence of a complaint is not proof of
 * deletion, and on a FAILED proof that is precisely when an operator needs to know whether a real
 * account was left behind. The verdict is written only after auth deletion AND every residue readback
 * have succeeded, so its presence means something specific. Content-free by construction: a fixed
 * token and counts, never a uid, email, session id, or row.
 */
function writeCleanupVerdict(verdict: 'cleanup_verified' | 'cleanup_not_required', tablesVerified: number): void {
    const target = process.env.PROOF_CLEANUP_VERDICT_FILE;
    const line = `${verdict} residue=0 tables_verified=${tablesVerified}`;
    console.log(`RUN_OWNED_CLEANUP ${line}`);
    if (!target) return;
    try { appendFileSync(target, `${line}\n`); } catch { /* the workflow fails closed on a missing verdict */ }
}

/** Minimal shape of the supabase-js admin client this cleanup needs. */
type AdminClient = {
    auth: {
        admin: {
            // `code` is read (never `message`) so a failure cannot echo a provider string into a
            // public log; the declared type must therefore carry it.
            listUsers: (args: { page: number; perPage: number }) => Promise<{ data: { users?: Array<{ id?: string; email?: string | null }> } | null; error: { code?: string; message: string } | null }>;
            getUserById: (uid: string) => Promise<{ data: { user?: { email?: string | null } | null } | null; error: ({ status?: number; code?: string; message: string }) | null }>;
            deleteUser: (uid: string) => Promise<{ error: { message: string } | null }>;
        };
    };
    from: (table: string) => {
        delete: () => { eq: (column: string, value: unknown) => Promise<{ error: { message: string } | null }> };
        select: (columns: string, options?: { count?: string; head?: boolean }) => { eq: (column: string, value: unknown) => Promise<{ data?: unknown; count: number | null; error: { message: string } | null }> };
        // Only the take settlement below uses it (sessions.status -> 'failed'); optional so older fakes still type-check.
        update?: (values: Record<string, unknown>) => UpdateFilter;
    };
};

/** A supabase-js filter chain: every `.eq()` narrows it; `.select()` returns the changed rows, and awaiting it runs the write. */
type UpdateFilter = { eq: (column: string, value: unknown) => UpdateFilter; select: (columns: string) => PromiseLike<{ data: unknown; error: { message: string } | null }> };

/**
 * COMPLETE `auth.users` FK INVENTORY (derived from the migration history, not assumed).
 *
 * Every foreign key to `auth.users(id)` is ON DELETE CASCADE except two:
 *   - `trial_entitlements.user_id` — SET NULL. `deleteUser()` only nulls the column, so the row would
 *     survive as residue. It MUST be deleted by user_id first, while the column still holds it.
 *   - `user_issue_reports.user_id` — SET NULL BY DESIGN. The product intentionally RETAINS "Report
 *     issue" feedback after account deletion (row survives, unlinked). That is a feature, not residue;
 *     scrubbing it would risk erasing real user feedback. This proof files none anyway.
 *
 * `usage_checkpoints.user_id` deserves a note because it is the known trap: it was originally declared
 * `REFERENCES auth.users(id)` with NO on-delete clause — NO ACTION/RESTRICT — which once blocked a
 * delete and left a partially-removed account. Migration 20260625120000 changed it to CASCADE. It
 * therefore needs no pre-delete, but it IS residue-checked below so a regression that reverted that
 * migration would fail this proof rather than silently orphan rows again.
 */
export const RESIDUE_CHECKS: ReadonlyArray<{ table: string; column: string }> = Object.freeze([
    { table: 'sessions', column: 'user_id' },
    { table: 'user_profiles', column: 'id' },                       // PK = auth user id
    { table: 'user_goals', column: 'user_id' },
    // Renamed from custom_vocabulary in 20260103170500; querying the old name errors and fails every cleanup closed.
    { table: 'user_filler_words', column: 'user_id' },
    { table: 'usage_checkpoints', column: 'user_id' },              // CASCADE since 20260625120000
    { table: 'active_recording_lease', column: 'user_id' },
    { table: 'session_attribution_authority', column: 'user_id' },
    { table: 'session_attribution_challenge', column: 'user_id' },
    { table: 'session_attribution_unattributed', column: 'user_id' },
    // Progress surfaces a completed session can produce.
    { table: 'session_progress_evaluations', column: 'user_id' },
    { table: 'progress_recommendations', column: 'user_id' },
    { table: 'progress_recommendation_attempts', column: 'user_id' },
    // Coaching and Focus Points surfaces the RWT journey suites produce (all ON DELETE CASCADE; residue-checked so
    // a regression that dropped a cascade fails the proof instead of orphaning rows).
    { table: 'ai_suggestion_authority_receipts', column: 'user_id' },
    { table: 'objective_project', column: 'user_id' },
    { table: 'objective_brief', column: 'user_id' },
    { table: 'objective_brief_point', column: 'user_id' },
    { table: 'objective_session', column: 'user_id' },
    { table: 'objective_source_recording', column: 'user_id' },
    { table: 'objective_evidence', column: 'user_id' },
    // #1532 Codex P2 r4122079960: a saved Focus take also inserts an action (objective_finalize_evidence_v1).
    { table: 'objective_action', column: 'user_id' },
    // #1532 Codex P2 r4127146515 — newest-one transcript retention (20260908120000), both ON DELETE CASCADE:
    // every transcript-bearing save arms retention for the account (arm_transcript_retention_for_save) …
    { table: 'transcript_retention_arming', column: 'user_id' },
    // … and a later saved take tombstones the earlier take's transcript, so this row carries transcript text.
    { table: 'transcript_retention_tombstones', column: 'user_id' },
]);

/**
 * Tables whose user_id FK is NOT `ON DELETE CASCADE` and must be cleared BEFORE the auth user is
 * deleted. `user_issue_reports` is deliberately excluded — see the inventory above.
 */
export const PRE_DELETE_TABLES: ReadonlyArray<string> = Object.freeze(['trial_entitlements']);

/**
 * A residue readback proves zero only when it returned a COUNTED zero. A `{ count: null, error: null }` read is an
 * unknown, not an empty table (CLI Dev 2026-10-18: `count ?? 0` let all 23 null reads emit `residue=0`), so anything
 * other than a non-negative safe integer fails closed, and a positive count is residue. Reason codes only: the table
 * name is public schema, never a uid or row.
 */
export function requireZeroResidue(count: unknown, table: string): void {
    if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) {
        throw new Error(`cleanup residue count on ${table} was not a counted integer — residue UNPROVEN (fail closed)`);
    }
    if (count !== 0) throw new Error(`cleanup found run-owned residue in ${table} (fail closed): count=${count}`);
}

export const RUN_OWNED_PREFIX_RE = /^(private-proof-|retention-proof-|rwt-journey-)/;

/**
 * Delete exactly the run-owned account and prove no residue remains. Fail-closed throughout.
 *
 * @returns the UID that was cleaned up, or '' when no signup had been attempted.
 */
/**
 * The step a failed cleanup stopped at, as a CLOSED code (AHT-01 baseline run 42796353079 recorded only "deletion or residue
 * readback failed"). Matched against this module's own throw sites; table names only from the fixed inventory above; anything
 * else, including provider text, is `unknown`. Content-safe for a public log.
 */
export function cleanupFailureStep(error: unknown): string {
    const m = String((error as { message?: unknown } | null)?.message ?? '');
    const tables = new Set<string>([...RESIDUE_CHECKS.map((c) => c.table), ...PRE_DELETE_TABLES]);
    const table = (re: RegExp, code: string) => { const t = re.exec(m)?.[1]; return t && tables.has(t) ? `${code}:${t}` : null; };
    return (/^cleanup getUserById failed/.test(m) && 'get_user')
        || (/^cleanup recovery listUsers failed/.test(m) && 'recovery_list_users')
        || (/^cleanup_uid_email_disagreement/.test(m) && 'uid_email_disagreement')
        || (/^cleanup_refused_non_run_owned_account/.test(m) && 'non_run_owned')
        || (/^cleanup_run_binding_mismatch/.test(m) && 'run_binding_mismatch')
        || (/^cleanup requires admin client/.test(m) && 'no_admin')
        || table(/^cleanup ([a-z_]+) pre-delete failed/, 'pre_delete')
        || (/^cleanup take settlement (read|close) failed/.test(m) && 'settle_takes')
        || (/^cleanup deleteUser blocked by an unsettled take/.test(m) && 'delete_user_unsettled_take')
        || (/^cleanup deleteUser failed/.test(m) && 'delete_user')
        || ((/^post-delete verify/.test(m) || /auth user must be gone/.test(m)) && 'post_delete_verify')
        || table(/^cleanup residue query on ([a-z_]+) failed/, 'residue_query')
        || table(/^cleanup found run-owned residue in ([a-z_]+)/, 'residue_found')
        || table(/^cleanup residue count on ([a-z_]+) was not a counted integer/, 'residue_unproven')
        || 'unknown';
}

/** One `sessions` row as the take settlement reads it. */
export interface TakeRow { id: string; status: string | null; lease_id: string | null; recording_fenced_at: string | null; created_at?: string | null; expires_at?: string | null; updated_at?: string | null }

/** One `active_recording_lease` row as the take settlement reads it. */
export interface LeaseRow { lease_id: string | null; heartbeat_at: string | null }

/**
 * #1643 SAVE OBLIGATIONS (backend/supabase/migrations/20261020230653_account_pending_completion_journal_1643.sql).
 *
 * `account_save_delete_guard` (BEFORE DELETE ON auth.users) raises "account admitted save unsettled" while ANY
 * `account_save_obligations` row of the account is not `completed`. An obligation is written when a lease is acquired
 * (`zz_account_save_obligation` on active_recording_lease) and when a session is inserted or changes status
 * (`zz_account_save_session_obligation`). It becomes `completed` ONLY when its take's session is `completed`, or `failed`
 * while carrying a lease or a recording fence. No timer and no lease DELETE settles it, and service_role cannot read or
 * write the table. Auth's `deleteUser()` reports the guard only as a generic database error, which is why AHT-02/04/05/06/
 * 10/12/13/14 (rc-gates runs 43156311609 … 43156426616) all stopped at `delete_user` while AHT-03/09/11, whose every take
 * saved, cleaned up to residue 0.
 *
 * Pure: which of the account's takes are already settled, which are still OPEN and anchored (status `active` under a lease
 * or a fence: the only shape a status write to `failed` settles, and the only one `_ss_fence_session_writes_1476` always lets
 * become `failed` with its transcript unchanged), and which no status write can settle (no lease and no fence, or any status
 * other than active/completed/failed).
 */
export function classifyTakes(rows: readonly TakeRow[]): { settled: number; closable: TakeRow[]; unsettleable: number } {
    let settled = 0; let unsettleable = 0; const closable: TakeRow[] = [];
    for (const row of rows) {
        const anchored = row.lease_id !== null || row.recording_fenced_at !== null;
        if (row.status === 'completed' || (row.status === 'failed' && anchored)) settled += 1;
        else if (anchored && row.status === 'active') closable.push(row);
        else unsettleable += 1;
    }
    return { settled, closable, unsettleable };
}

/**
 * Pure: leases the account still holds that no session row was created under. Each one is an obligation that only a session
 * under that lease could settle — a Start that failed or was abandoned before the take existed (denied microphone, failed
 * model, leaving during a cold Start). A lease already RELEASED leaves the same obligation and is invisible here.
 */
export function leaseOnlyTakes(leaseIds: readonly (string | null)[], rows: readonly TakeRow[]): number {
    const bound = new Set(rows.map((r) => r.lease_id).filter((l): l is string => l !== null));
    return leaseIds.filter((l): l is string => typeof l === 'string' && !bound.has(l)).length;
}

/**
 * Sam, reviews of the 2026-11-12 cleanup patch (v1, v2): closing a take as `failed` is final (`lease_revoked: this take is
 * closed and cannot be revived`), so if the close wins first, a later save of that take is LOST. No timer bounds that: a
 * request the page sent before it closed can still be admitted at the server later (the 3 s statement timeout bounds a
 * statement once it runs, not the network or queueing before it), so v3 waits for nothing and proves instead:
 *  - the caller opts in (only the RWT journeys, which record the harness's synthetic fixture), and proves through
 *    `writersClosedAt` that every page that could write for this account was closed (the harness parity tap's own close);
 *  - every save the pages sent was ANSWERED (`unsettledSaves`, from the same tap): an answered save has finished at the
 *    server. A take named by a save that was sent and never answered (failed, aborted or still open when its page closed)
 *    is never closed; a save whose take cannot be read from its request refuses every close;
 *  - the account is bound to THIS run (`app_metadata.ct_run`), not an unbound local account;
 *  - every browser context of the journey's browsers is one the tap watches (`writersClosedAt` is null otherwise), so no
 *    save can come from a page the tap cannot see;
 *  - the fresh read shows no writer after the pages closed: a lease heartbeat stamped later, a session expiry pushed past
 *    what a heartbeat before the close could set, an open take written later (an at-cap heartbeat writes only
 *    `updated_at`), or a take created later. Any of them means another writer exists, and NOTHING is closed. These are
 *    database stamps (`now()`, the writing transaction's start) judged against the runner's clock, so they are a backstop
 *    for an unseen writer, not the save drain: a database clock behind the runner, or a transaction that began before the
 *    close, can stamp a later write earlier. The save drain is the answered-save proof above;
 *  - each write still names the row, the account and the `active` status it read, so a save that lands first wins, and only
 *    rows the database reports changed are counted.
 */
export interface StoppedTakeProof {
    /** Harness clock (ms) at which every page that could write for this account was proven closed; null when unproven. */
    writersClosedAt: () => number | null;
    /** Saves those pages sent and never got an answer for: the takes they name, and how many name none readable. null = unobserved. */
    unsettledSaves: () => { sessionIds: readonly string[]; unnamed: number } | null;
}

/** `heartbeat_session` sets a take's `expires_at` to now() + 5 minutes; a later expiry means a heartbeat after the close. */
const SESSION_HEARTBEAT_EXTENSION_MS = 5 * 60_000;

const isTakeRow = (r: unknown): r is TakeRow => {
    const o = r as Record<string, unknown> | null;
    const optionalText = (v: unknown) => v === undefined || v === null || typeof v === 'string';
    return !!o && typeof o.id === 'string' && (o.status === null || typeof o.status === 'string')
        && (o.lease_id === null || typeof o.lease_id === 'string') && (o.recording_fenced_at === null || typeof o.recording_fenced_at === 'string')
        && optionalText(o.created_at) && optionalText(o.expires_at) && optionalText(o.updated_at);
};
const isLeaseRow = (r: unknown): r is LeaseRow => {
    const o = r as Record<string, unknown> | null;
    return !!o && (o.lease_id === null || typeof o.lease_id === 'string') && (o.heartbeat_at === undefined || o.heartbeat_at === null || typeof o.heartbeat_at === 'string');
};

async function readTakes(admin: AdminClient, uid: string): Promise<{ rows: TakeRow[]; leases: LeaseRow[] }> {
    const { data, error } = await admin.from('sessions').select('id,status,lease_id,recording_fenced_at,created_at,expires_at,updated_at').eq('user_id', uid);
    if (error || !Array.isArray(data) || !data.every(isTakeRow)) throw new Error('cleanup take settlement read failed (fail closed)');
    const { data: leases, error: leaseErr } = await admin.from('active_recording_lease').select('lease_id,heartbeat_at').eq('user_id', uid);
    if (leaseErr || !Array.isArray(leases) || !leases.every(isLeaseRow)) throw new Error('cleanup take settlement read failed (fail closed)');
    return { rows: data as TakeRow[], leases: leases as LeaseRow[] };
}

/** Why a run-bound, opted-in settlement closed nothing it could otherwise have closed (counts-only log; no ids). */
export type SettlementRefusal = 'pages_open' | 'saves_unobserved' | 'save_unnamed' | 'close_moved' | 'writer_after_close';
export interface TakeSettlement { closed: number; unsettleable: number; leaseOnly: number; notStopped: number; refused?: SettlementRefusal }

/** Pure: true when the fresh read shows a writer after `closedAt` (any heartbeat, a write to an open take, or a take created, after it). */
export function writerAfter(closedAt: number, r: { rows: readonly TakeRow[]; leases: readonly LeaseRow[] }): boolean {
    const after = (iso: string | null | undefined, bound: number) => {
        const t = iso ? Date.parse(iso) : Number.NaN;
        return !Number.isFinite(t) || t > bound;
    };
    return r.leases.some((l) => after(l.heartbeat_at, closedAt))
        || r.rows.some((row) => after(row.created_at, closedAt))
        || r.rows.some((row) => row.status === 'active' && row.updated_at !== null && row.updated_at !== undefined && after(row.updated_at, closedAt))
        || r.rows.some((row) => row.expires_at !== null && row.expires_at !== undefined && after(row.expires_at, closedAt + SESSION_HEARTBEAT_EXTENSION_MS));
}

/**
 * Close this run-owned account's own STOPPED takes as the product's Discard would, so the deletion guard can pass, and report
 * (counts only) what stays open. Runs only after the UID/email/run-binding checks have passed. Without `stopped` (every
 * caller but the RWT journeys) or for an account not bound to this run, it only reads.
 */
export async function settleRunOwnedTakes(admin: AdminClient, uid: string,
    scope: { runBound: boolean; stopped?: StoppedTakeProof } = { runBound: false }): Promise<TakeSettlement> {
    const first = await readTakes(admin, uid);
    const report = (r: { rows: TakeRow[]; leases: LeaseRow[] }, closed: number, refused?: SettlementRefusal): TakeSettlement => {
        const c = classifyTakes(r.rows);
        const out: TakeSettlement = { closed, unsettleable: c.unsettleable, leaseOnly: leaseOnlyTakes(r.leases.map((l) => l.lease_id), r.rows), notStopped: c.closable.length };
        return refused ? { ...out, refused } : out;
    };
    const { stopped } = scope;
    if (!stopped || !scope.runBound || classifyTakes(first.rows).closable.length === 0) return report(first, 0);

    const closedAt = stopped.writersClosedAt();
    if (closedAt === null || !Number.isFinite(closedAt)) return report(first, 0, 'pages_open');
    const unsettled = stopped.unsettledSaves();
    if (!unsettled) return report(first, 0, 'saves_unobserved');
    if (unsettled.unnamed !== 0) return report(first, 0, 'save_unnamed');
    const inFlight = new Set(unsettled.sessionIds.map((id) => id.toLowerCase()));

    const fresh = await readTakes(admin, uid);
    // The pages must still be closed, at the same moment, after the read; and no writer may show after that moment.
    if (stopped.writersClosedAt() !== closedAt) return report(fresh, 0, 'close_moved');
    if (writerAfter(closedAt, fresh)) return report(fresh, 0, 'writer_after_close');

    let closed = 0;
    for (const row of classifyTakes(fresh.rows).closable) {
        if (inFlight.has(row.id.toLowerCase())) continue; // a save of this take was sent and never answered: it may still be admitted
        // The query builder is the receiver: never detach `update` from it (Sam reproduced a TypeError with the real client).
        const sessions = admin.from('sessions');
        if (typeof sessions.update !== 'function') throw new Error('cleanup take settlement close failed (fail closed): no update');
        // Exactly this row of this account, and only while it is still the `active` take that was read: a save that lands
        // first wins, and the guard then judges what it left. Only rows the database returns as changed are counted.
        const { data, error: upErr } = await sessions.update({ status: 'failed' }).eq('id', row.id).eq('user_id', uid).eq('status', 'active').select('id');
        if (upErr || !Array.isArray(data)) throw new Error('cleanup take settlement close failed (fail closed)');
        closed += data.length;
    }
    return report(await readTakes(admin, uid), closed);
}

/** Counts only: what the take settlement did, for the Actions log (content-free, like the verdict line). */
function writeTakeSettlementLine(t: TakeSettlement): void {
    // Not prefixed RUN_OWNED_CLEANUP: that prefix is the verdict line, which readers match by prefix.
    console.log(`RUN_TAKE_SETTLEMENT closed=${t.closed} not_stopped=${t.notStopped} unsettleable=${t.unsettleable} lease_only=${t.leaseOnly}`
        + (t.refused ? ` refused=${t.refused}` : ''));
}

export async function cleanupRunOwnedAccount(params: {
    admin: AdminClient | null;
    capturedUid: string;
    createdEmail: string;
    /** Email prefix this proof owns, e.g. 'retention-proof-'. Anything else is refused. */
    runOwnedPrefix: string;
    /** Only the separately SHA-acknowledged recovery path supplies the original, validated binding. */
    recovery?: { originalBinding: RunBinding; dispatchSha: string; deleteAck: string; minAgeMs: number };
    /** RWT synthetic journeys only: the harness's proof that every page that could write for this account has closed. */
    stoppedTakes?: StoppedTakeProof;
}): Promise<string> {
    const { admin, createdEmail, runOwnedPrefix } = params;
    let capturedUid = params.capturedUid;

    if (!capturedUid && !createdEmail) {
        // Distinguish "nothing to clean" from "cleaned successfully" — collapsing them would let a run
        // that silently skipped signup report the same verdict as one that proved deletion.
        writeCleanupVerdict('cleanup_not_required', 0);
        return '';
    }
    if (!admin) throw new Error('cleanup requires admin client (fail closed)');

    // Signup can create the user before the in-page UID capture times out. Recover by EXACT-email,
    // unique-result admin lookup so the account is never orphaned; pagination/errors fail closed.
    if (!capturedUid) {
        capturedUid = await pollForRecoveryUid({
            listAllUsers: async () => {
                const all: Array<{ id?: string; email?: string | null }> = [];
                for (let p = 1; p <= 50; p++) {
                    const { data, error } = await admin.auth.admin.listUsers({ page: p, perPage: 200 });
                    if (error) throw new Error(`cleanup recovery listUsers failed (fail closed): ${error.code ?? 'unknown'}`);
                    const users = data?.users ?? [];
                    all.push(...users);
                    if (users.length < 200) break;                  // last page
                }
                return all;
            },
            sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
            createdEmailLower: createdEmail.toLowerCase(),
            runOwnedPrefix,
            maxAttempts: 12,
            delayMs: 5000,
        });
    }

    const { data: got, error: getErr } = await admin.auth.admin.getUserById(capturedUid);
    if (getErr) throw new Error(`cleanup getUserById failed (fail closed): ${getErr.message}`);
    const foundEmail = got?.user?.email?.toLowerCase() ?? '';
    // PRIVACY: reason codes only. A FAILING run is published to a public Actions log, so a thrown
    // message must never carry the run-owned uid or the generated email — the values are still used
    // internally for scoping, they are simply not printed.
    if (foundEmail !== createdEmail.toLowerCase()) throw new Error('cleanup_uid_email_disagreement (fail closed)');
    if (!foundEmail.startsWith(runOwnedPrefix)) throw new Error('cleanup_refused_non_run_owned_account (fail closed)');
    // PO option C: an account bound to a run (app_metadata.ct_run) is deleted only by that run. An unbound account (local run,
    // binding never written) keeps the UID/email identity above as its only proof.
    const ctRun = (got?.user as { app_metadata?: { ct_run?: Record<string, unknown> } } | null | undefined)?.app_metadata?.ct_run;
    const mine = currentRunBinding();
    if (params.recovery) {
        const { originalBinding: original, dispatchSha, deleteAck } = params.recovery;
        const parsed = currentRunBinding({ GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: original.repository,
            GITHUB_WORKFLOW_REF: original.workflow, GITHUB_RUN_ID: original.runId, GITHUB_RUN_ATTEMPT: original.runAttempt });
        // Recovery is a different authorized run, never a blanket foreign-run bypass. Revalidate the original
        // service-role binding against the fresh user read immediately before deletion. Ordinary teardown is unchanged.
        if (!mine || !parsed || !sameRunBinding({ ct_run: original }, parsed)
            || original.repository !== mine.repository
            || !original.workflow.startsWith(`${mine.repository}/.github/workflows/rc-gates.yml@refs/`)
            || !createdEmail.toLowerCase().split('@')[0].endsWith(`-${original.runId}`)
            || original.runId === mine.runId
            || !/^[a-f0-9]{40}$/.test(dispatchSha) || process.env.GITHUB_SHA !== dispatchSha
            || process.env.GITHUB_REF !== 'refs/heads/main' || mine.runAttempt !== '1'
            || deleteAck !== `RWT-INTERRUPTED-RUN-RECOVERY-DELETE@${dispatchSha}`
            || !sameRunBinding({ ct_run: ctRun }, original)) {
            throw new Error('cleanup_run_binding_mismatch (fail closed)');
        }
    } else if (ctRun !== undefined && (!mine || !sameRunBinding({ ct_run: ctRun }, mine))) {
        throw new Error('cleanup_run_binding_mismatch (fail closed)');
    }

    if (params.recovery) {
        const { originalBinding: original, minAgeMs } = params.recovery;
        // Age is not proof that another workflow version has stopped. Read both the exact owning
        // attempt and the latest attempt: a completed old attempt must not authorize deleting a rerun's account.
        // Public repository read, fixed API origin, no redirects or provider error text in the report.
        try {
            if (!Number.isFinite(minAgeMs) || minAgeMs < 135 * 60_000) throw new Error('age floor');
            for (const suffix of [`/attempts/${original.runAttempt}`, '']) {
                const response = await fetch(`https://api.github.com/repos/${original.repository}/actions/runs/${original.runId}${suffix}`, {
                    headers: { Accept: 'application/vnd.github+json' }, redirect: 'error', signal: AbortSignal.timeout(10_000),
                });
                if (!response.ok) throw new Error('unavailable');
                const run = await response.json();
                if (!run || String(run.id) !== original.runId || String(run.run_attempt) !== original.runAttempt
                    || run.repository?.full_name !== original.repository || run.path !== '.github/workflows/rc-gates.yml'
                    || run.status !== 'completed' || typeof run.conclusion !== 'string' || !run.conclusion) throw new Error('not terminal');
            }
            // The listing and first lookup are not a mutation-time eligibility proof. Re-read after
            // GitHub I/O and refuse changed identity/binding, missing timestamps or newly fresh accounts.
            const { data: fresh, error } = await admin.auth.admin.getUserById(capturedUid);
            const user = fresh?.user as { email?: string; created_at?: string; app_metadata?: unknown } | null | undefined;
            const created = typeof user?.created_at === 'string' ? Date.parse(user.created_at) : Number.NaN;
            const now = Date.now();
            if (error || user?.email?.toLowerCase() !== createdEmail.toLowerCase()
                || !sameRunBinding(user?.app_metadata, original) || !Number.isFinite(created)
                || created > now || now - created < minAgeMs) throw new Error('account changed');
        } catch {
            throw new Error('cleanup_recovery_eligibility_unproven (HOLD)');
        }
    }

    // Only an account bound to THIS run (never an unbound local one, never the recovery path) may have a take closed. A
    // caller that closes nothing only reads, to name a refused deletion: its read failing never blocks the deletion.
    let takes: TakeSettlement | null = null;
    if (params.stoppedTakes) {
        takes = await settleRunOwnedTakes(admin, capturedUid, { runBound: !params.recovery && ctRun !== undefined, stopped: params.stoppedTakes });
    } else {
        takes = await settleRunOwnedTakes(admin, capturedUid).catch(() => null);
    }
    if (takes) writeTakeSettlementLine(takes);

    for (const table of PRE_DELETE_TABLES) {
        const { error: preErr } = await admin.from(table).delete().eq('user_id', capturedUid);
        if (preErr) throw new Error(`cleanup ${table} pre-delete failed (fail closed): ${preErr.message}`);
    }

    const { error: delErr } = await admin.auth.admin.deleteUser(capturedUid);
    if (delErr) {
        // Counts only: the guard's own error never reaches this client, so name what this cleanup saw and could not settle.
        if (takes && (takes.unsettleable > 0 || takes.leaseOnly > 0 || takes.notStopped > 0)) {
            throw new Error(`cleanup deleteUser blocked by an unsettled take (fail closed): unsettleable=${takes.unsettleable} lease_only=${takes.leaseOnly} not_stopped=${takes.notStopped}`);
        }
        throw new Error(`cleanup deleteUser failed (fail closed): ${delErr.message}`);
    }

    const { data: after, error: afterErr } = await admin.auth.admin.getUserById(capturedUid);
    if (afterErr) {
        if (!isNotFoundError(afterErr as { status?: number; code?: string; message?: string })) {
            throw new Error(`post-delete verify returned a non-not-found error — deletion UNPROVEN (fail closed): ${afterErr.message}`);
        }
        // not-found → confirmed deleted
    } else {
        expect(after?.user ?? null, 'auth user must be gone after cleanup (returned a user)').toBeNull();
    }

    for (const { table, column } of RESIDUE_CHECKS) {
        const { count, error: rErr } = await admin
            .from(table).select(column, { count: 'exact', head: true }).eq(column, capturedUid);
        if (rErr) throw new Error(`cleanup residue query on ${table} failed (fail closed): ${rErr.message}`);
        requireZeroResidue(count, table);
    }

    const { count: teCount, error: teResErr } = await admin
        .from('trial_entitlements').select('email', { count: 'exact', head: true }).eq('email', createdEmail.toLowerCase());
    if (teResErr) throw new Error(`cleanup residue query on trial_entitlements failed (fail closed): ${teResErr.message}`);
    requireZeroResidue(teCount, 'trial_entitlements');

    // Emitted ONLY here — after auth deletion is proven and every residue readback returned zero.
    writeCleanupVerdict('cleanup_verified', RESIDUE_CHECKS.length + 1);

    return capturedUid;
}
