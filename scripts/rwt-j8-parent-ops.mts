/**
 * J8 parent operations (Sam, 23 Nov: "keep the production service-role key out of the browser test process"). Run only by the
 * J8 parent (j8-live-adapters.cjs), alive for the spec's lifetime. It holds the key; the Playwright spec it serves does not.
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
 * Inputs (env, set by the parent): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RWT_J8_OPS_EMAIL (the admitted email),
 * RWT_J8_OPS_TOKEN (64 hex), GITHUB_REPOSITORY, GITHUB_WORKFLOW_REF, GITHUB_RUN_ID, GITHUB_RUN_ATTEMPT (the run binding).
 * Prints `RWT_J8_PARENT_OPS_READY <port>` once listening on 127.0.0.1.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
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
type Reply = { status: number; body: Record<string, unknown> };
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
        const failures = await helpers.runOwnedIdentityFailures(admin as never, uid, admitted);
        if (failures.length > 0) return { status: 200, body: { failures: failures.length, claimed: false } };
        boundUid = uid;
        const claimed = await helpers.markRunOwnedAccountCanary(admin as never, uid, admitted);
        return { status: 200, body: { failures: 0, claimed: claimed === true } };
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
        const r = await admin.rpc(fn, a);
        return { status: 200, body: { data: r.data ?? null, error: r.error ? { code: r.error.code ?? null } : null } };
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

async function main(): Promise<number> {
    const env = process.env;
    const binding = { repository: env.GITHUB_REPOSITORY ?? '', workflow: env.GITHUB_WORKFLOW_REF ?? '', runId: env.GITHUB_RUN_ID ?? '', runAttempt: env.GITHUB_RUN_ATTEMPT ?? '' };
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY || !env.RWT_J8_OPS_EMAIL || !env.RWT_J8_OPS_TOKEN || !binding.repository || !binding.workflow) {
        console.error('RWT_J8_PARENT_OPS blocked_setup');
        return 78;
    }
    const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    let handle: ReturnType<typeof createJ8ParentOps>;
    try { handle = createJ8ParentOps({ admin: admin as never, email: env.RWT_J8_OPS_EMAIL, binding, token: env.RWT_J8_OPS_TOKEN }); }
    catch { console.error('RWT_J8_PARENT_OPS blocked_setup'); return 78; }
    const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
        let reply: Reply;
        if (req.method !== 'POST' || req.url !== '/op') reply = refuse('not_found', 404);
        else { try { reply = await handle(req.headers.authorization, await readJson(req)); } catch { reply = refuse('bad_request', 400); } }
        res.writeHead(reply.status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify(reply.body));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    if (!address || typeof address === 'string') return 78;
    console.log(`RWT_J8_PARENT_OPS_READY ${address.port}`);
    await new Promise<void>((resolve) => {
        const stop = () => { void handle.close().then(() => { console.log('RWT_J8_PARENT_OPS_SETTLED'); server.close(() => resolve()); }); };
        process.on('SIGTERM', stop); process.on('SIGINT', stop);
    });
    return 0;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
    main().then((code) => { process.exitCode = code; }, () => { console.error('RWT_J8_PARENT_OPS failed'); process.exitCode = 1; });
}
