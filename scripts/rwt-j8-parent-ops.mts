/**
 * J8 parent operations (Sam, 23 Nov: "keep the production service-role key out of the browser test process"). Run only by the
 * J8 parent (j8-live-adapters.cjs), alive for the spec's lifetime. The parent holds the key; the Playwright spec it serves does not.
 *
 * It answers exactly four NAMED operations over loopback HTTP, each bound to the ONE account the parent admitted:
 *   identity_and_claim {uid}        the run-owned identity check (which writes this run's binding) and the canary claim. The uid is
 *                                   accepted only when its Auth email equals the admitted email; from then on it is the bound uid.
 *   fence {fn, args}                one of the four feedback-fence RPCs; `open` must name the bound uid and this run's binding,
 *                                   the others this run's J8 run key. Nothing else.
 *   issue_reports {by, value}       user_issue_reports rows of the bound uid only, by idempotency key(s) or report id, fixed columns.
 *   take_digests {ids}              sessions rows of the bound uid only, the take projection's fixed columns.
 * No caller-chosen table, column, filter, account or run. Every request needs this run's bearer token (constant-time compared).
 * Every refusal is a closed code, never an email, id or row.
 *
 * Served in-process by the J8 entry (serveJ8ParentOps) with the entry's own operations client (the approved project, over its own
 * capped transport) and through the entry's settlement gate. Nothing here reads the environment.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { markRunOwnedAccountCanary, runOwnedIdentityFailures } from '../tests/live/helpers/rwtJourney';
import { fenceRunKey } from '../tests/live/helpers/feedbackFence';
import { J8_FENCE_CASE, TAKE_PROJECTION_FIELDS } from '../tests/live/helpers/rwtJ8Journey';

export const J8_PARENT_OPS = Object.freeze(['identity_and_claim', 'fence', 'issue_reports', 'take_digests'] as const);
export const FENCE_FUNCTIONS = Object.freeze(['open_rwt_feedback_fence_v1', 'close_rwt_feedback_fence_v1',
    'clean_rwt_feedback_fence_v1', 'verify_rwt_feedback_fence_v1'] as const);
const REPORT_COLUMNS = 'id,session_id,metadata';
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const KEY = /^[A-Za-z0-9:_-]{1,200}$/;
const MAX_BODY = 8192;

export interface ParentOpsBinding { repository: string; workflow: string; runId: string; runAttempt: string }
/**
 * `outcomeUnknown` (Sam, 23 Nov, review of 40e1a5a6): a WRITE whose result is not a confirmed success or a definite database refusal
 * (it threw, or failed with no error code, e.g. the transport) may have landed. The server rejects that operation through the entry's
 * settlement gate, so the entry holds cleanup for protected recovery instead of deleting. Reads are never marked.
 */
type Reply = { status: number; body: Record<string, unknown>; outcomeUnknown?: boolean };
const UNKNOWN: Reply = { status: 502, body: { refused: 'outcome_unknown' }, outcomeUnknown: true };
/** A definite refusal names a database or API code; an error without one (transport, abort) leaves the write's outcome unknown. */
const definiteRefusal = (error: { code?: string | null } | null | undefined) => !!error && typeof error.code === 'string' && error.code.length > 0;
type Admin = {
    auth: { admin: { getUserById(uid: string): PromiseLike<{ data: { user: { email?: string | null } | null } | null; error: unknown }> } };
    from(table: string): any;
    rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>;
};

const refuse = (code: string, status = 403): Reply => ({ status, body: { refused: code } });
const sameSecret = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/**
 * The operations, bound to one admitted email and one run binding. `admin` is the service-role client (only here). Returns a pure
 * request handler: (authorization header, parsed body) -> reply. The bound uid is set only by a successful identity_and_claim.
 */
export function createJ8ParentOps({ admin, email, binding, token, helpers = { runOwnedIdentityFailures, markRunOwnedAccountCanary } }: {
    admin: Admin; email: string; binding: ParentOpsBinding; token: string;
    helpers?: { runOwnedIdentityFailures: typeof runOwnedIdentityFailures; markRunOwnedAccountCanary: typeof markRunOwnedAccountCanary };
}) {
    if (!/^[a-f0-9]{64}$/.test(token) || !email || !binding?.runId || !binding?.runAttempt) throw new Error('j8_parent_ops_setup');
    const admitted = email.toLowerCase();
    const runKey = fenceRunKey(binding, J8_FENCE_CASE);
    let boundUid: string | null = null;

    async function identityAndClaim(args: Record<string, unknown>): Promise<Reply> {
        const uid = args.uid;
        if (typeof uid !== 'string' || !UUID.test(uid) || Object.keys(args).length !== 1) return refuse('bad_arguments', 400);
        if (boundUid && boundUid !== uid) return refuse('another_account');
        const user = await admin.auth.admin.getUserById(uid);
        if (user.error || (user.data?.user?.email ?? '').toLowerCase() !== admitted) return refuse('not_the_admitted_account');
        // The identity check writes this run's binding and the claim writes the canary flag: anything short of a clean pass is a
        // write whose outcome is not confirmed.
        let failures: string[];
        try { failures = await helpers.runOwnedIdentityFailures(admin as never, uid, admitted); } catch { return UNKNOWN; }
        if (failures.length > 0) return { status: 200, body: { failures: failures.length, claimed: false }, outcomeUnknown: true };
        boundUid = uid;
        let claimed: boolean;
        try { claimed = await helpers.markRunOwnedAccountCanary(admin as never, uid, admitted); } catch { return UNKNOWN; }
        return { status: 200, body: { failures: 0, claimed: claimed === true }, ...(claimed === true ? {} : { outcomeUnknown: true }) };
    }

    async function fence(args: Record<string, unknown>): Promise<Reply> {
        if (!boundUid) return refuse('no_bound_account');
        const fn = args.fn; const a = args.args as Record<string, unknown> | undefined;
        if (typeof fn !== 'string' || !(FENCE_FUNCTIONS as readonly string[]).includes(fn) || !a || typeof a !== 'object') return refuse('not_a_fence_call', 400);
        if (fn === 'open_rwt_feedback_fence_v1') {
            const keys = Object.keys(a).sort().join(',');
            if (keys !== 'p_binding,p_case,p_key_cap,p_owner') return refuse('bad_arguments', 400);
            if (a.p_owner !== boundUid) return refuse('another_account');
            const b = a.p_binding as Record<string, unknown> | null;
            if (!b || typeof b !== 'object' || b.runId !== binding.runId || b.runAttempt !== binding.runAttempt
                || b.repository !== binding.repository || b.workflow !== binding.workflow || a.p_case !== J8_FENCE_CASE) return refuse('another_run');
            if (!Number.isInteger(a.p_key_cap) || (a.p_key_cap as number) < 1 || (a.p_key_cap as number) > 8) return refuse('bad_arguments', 400);
        } else if (a.p_run_key !== runKey || Object.keys(a).length !== 1) return refuse('another_run');
        const write = fn !== 'verify_rwt_feedback_fence_v1';
        let r: { data: unknown; error: { code?: string; message?: string } | null };
        try { r = await admin.rpc(fn, a); } catch { return write ? UNKNOWN : refuse('operation_failed', 502); }
        const reply: Reply = { status: 200, body: { data: r.data ?? null, error: r.error ? { code: r.error.code ?? null } : null } };
        return write && r.error && !definiteRefusal(r.error) ? { ...reply, outcomeUnknown: true } : reply;
    }

    async function issueReports(args: Record<string, unknown>): Promise<Reply> {
        if (!boundUid) return refuse('no_bound_account');
        const { by, value } = args;
        let q = admin.from('user_issue_reports').select(REPORT_COLUMNS).eq('user_id', boundUid);
        if (by === 'keys' && Array.isArray(value) && value.length > 0 && value.length <= 8 && value.every((k) => typeof k === 'string' && KEY.test(k))) q = q.in('idempotency_key', value);
        else if (by === 'key' && typeof value === 'string' && KEY.test(value)) q = q.eq('idempotency_key', value);
        else if (by === 'id' && typeof value === 'string' && UUID.test(value)) q = q.eq('id', value);
        else return refuse('bad_arguments', 400);
        const { data, error } = await q;
        return { status: 200, body: { data: data ?? null, error: error ? { code: error.code ?? null } : null } };
    }

    async function takeDigests(args: Record<string, unknown>): Promise<Reply> {
        if (!boundUid) return refuse('no_bound_account');
        const ids = args.ids;
        if (!Array.isArray(ids) || ids.length === 0 || ids.length > 4 || !ids.every((id) => typeof id === 'string' && UUID.test(id))) return refuse('bad_arguments', 400);
        const { data, error } = await admin.from('sessions').select(TAKE_PROJECTION_FIELDS.join(',')).eq('user_id', boundUid).in('id', ids);
        return { status: 200, body: { data: data ?? null, error: error ? { code: error.code ?? null } : null } };
    }

    const table: Record<(typeof J8_PARENT_OPS)[number], (a: Record<string, unknown>) => Promise<Reply>> = {
        identity_and_claim: identityAndClaim, fence, issue_reports: issueReports, take_digests: takeDigests,
    };
    // Lifecycle (Sam, 23 Nov): once the spec has exited, admission to new operations closes; cleanup may start only after every
    // operation still in flight has settled. `settled()` resolves then; the parent HOLDs (protected recovery) if it never does.
    let closing = false;
    let inFlight = 0;
    const waiters: Array<() => void> = [];
    const release = () => { if (closing && inFlight === 0) while (waiters.length) waiters.shift()!(); };
    const handle = async function handle(authorization: string | undefined, body: unknown): Promise<Reply> {
        if (typeof authorization !== 'string' || !authorization.startsWith('Bearer ') || !sameSecret(authorization.slice(7), token)) return refuse('unauthorized', 401);
        if (closing) return refuse('closed', 409);
        if (!body || typeof body !== 'object' || Array.isArray(body)) return refuse('bad_request', 400);
        const { op, args } = body as { op?: unknown; args?: unknown };
        if (typeof op !== 'string' || !(J8_PARENT_OPS as readonly string[]).includes(op)) return refuse('unknown_operation', 400);
        if (!args || typeof args !== 'object' || Array.isArray(args)) return refuse('bad_arguments', 400);
        inFlight += 1;
        try { return await table[op as (typeof J8_PARENT_OPS)[number]](args as Record<string, unknown>); }
        catch { return refuse('operation_failed', 502); }
        finally { inFlight -= 1; release(); }
    };
    return Object.assign(handle, {
        /** Close admission to new operations; resolves once every in-flight operation has settled. */
        close(): Promise<void> { closing = true; return new Promise<void>((resolve) => { waiters.push(resolve); release(); }); },
        inFlight: () => inFlight,
    });
}

async function readJson(req: IncomingMessage): Promise<unknown> {
    let size = 0; const chunks: Buffer[] = [];
    for await (const chunk of req) { size += chunk.length; if (size > MAX_BODY) throw new Error('too_large'); chunks.push(chunk as Buffer); }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/** The entry's admission gate (j8-nightly-entry.cjs `parentOperations().port`): runs fn while open, rejects once the spec ended. */
export interface SettlementGate { run<T>(fn: () => Promise<T>): Promise<T> }

/**
 * Serve the operations on 127.0.0.1 inside the J8 parent (the entry process; the key never leaves it). Every operation runs through
 * the entry's settlement gate (Sam, 23 Nov), so the entry closes admission when the spec ends and waits for anything in flight before
 * cleanup; a request the gate refuses is answered `closed`. -> { url, close() }; close() refuses new operations at once and stops
 * listening; settlement itself is the gate's (the entry HOLDs the run if an operation does not settle).
 */
export async function serveJ8ParentOps({ admin, email, binding, token, gate, helpers }: {
    admin: Admin; email: string; binding: ParentOpsBinding; token: string; gate: SettlementGate;
    helpers?: Parameters<typeof createJ8ParentOps>[0]['helpers'];
}): Promise<{ url: string; close(): void }> {
    if (!gate || typeof gate.run !== 'function') throw new Error('j8_parent_ops_setup');
    const handle = createJ8ParentOps({ admin, email, binding, token, ...(helpers ? { helpers } : {}) });
    const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
        let reply: Reply;
        if (req.method !== 'POST' || req.url !== '/op') reply = refuse('not_found', 404);
        else {
            let body: unknown;
            try { body = await readJson(req); } catch { body = undefined; }
            if (body === undefined) reply = refuse('bad_request', 400);
            else {
                try {
                    reply = await gate.run(async () => {
                        const r = await handle(req.headers.authorization, body);
                        // Rejecting through the gate is how the entry learns a write's outcome is unknown (it then holds cleanup).
                        if (r.outcomeUnknown) throw Object.assign(new Error('j8_parent_write_outcome_unknown'), { reply: r });
                        return r;
                    });
                } catch (e) { reply = (e as { reply?: Reply })?.reply ?? refuse('closed', 409); }
            }
        }
        res.writeHead(reply.status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Connection: 'close' });
        res.end(JSON.stringify(reply.body));
    });
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve()); });
    const address = server.address();
    if (!address || typeof address === 'string') { server.close(); throw new Error('j8_parent_ops_setup'); }
    return {
        url: `http://127.0.0.1:${address.port}/op`,
        close() { void handle.close(); server.close(); },
    };
}
