/**
 * Canary active-trial lane orchestration (#1826): one run-owned trial account per run.
 *
 *   setup   — create this run's single account, bind it, and hand its credentials to later steps (masked).
 *   cleanup — delete exactly this run+attempt's account(s) with the shared zero-residue proof.
 *   sweep   — remove proven orphans of FINISHED runs of this repository/workflow (bounded, re-checked).
 *
 * Everything external is injected (admin client, fetch, the zero-residue cleanup, env, output sinks) so the
 * negative controls run offline. Output is closed codes and counts only: never an email, id, token or password.
 */
import { RUN_OWNED_PREFIX, parseBinding, sweep } from './canaryRunOwnedSweep.mjs';
import { createRunOwnedTrialAccount, currentCanaryBinding } from './canaryRunOwnedAccount.mjs';

export const PER_PAGE = 200;
export const MAX_PAGES = 50;

/** Every run-owned-prefix account. Any page error, or more pages than the bound, throws (fail closed). */
export async function listRunOwnedAccounts(admin) {
    const out = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
        const { data, error } = await admin.auth.admin.listUsers({ page, perPage: PER_PAGE });
        if (error) throw new Error('list-failed');
        const users = data?.users ?? [];
        for (const u of users) if (typeof u?.email === 'string' && u.email.toLowerCase().startsWith(RUN_OWNED_PREFIX)) out.push(u);
        if (users.length < PER_PAGE) return out;
    }
    throw new Error('list-unbounded');
}

/** GitHub's state for ONE run attempt: {status, run_attempt, updated_at} or {error:true}. Never throws. */
export function makeGetRun({ fetchImpl, token, repository, apiUrl = 'https://api.github.com' }) {
    return async (runId, runAttempt) => {
        if (!/^[1-9]\d{0,19}$/.test(String(runId)) || !/^[1-9]\d{0,3}$/.test(String(runAttempt))) return { error: true };
        try {
            const res = await fetchImpl(`${apiUrl}/repos/${repository}/actions/runs/${runId}/attempts/${runAttempt}`, {
                headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' },
            });
            if (!res.ok) return { error: true };
            const body = await res.json();
            if (typeof body?.status !== 'string') return { error: true };
            return { status: body.status, run_attempt: body.run_attempt, updated_at: body.updated_at };
        } catch { return { error: true }; }
    };
}

/**
 * The admin client handed to the SHARED cleanup. The shared helper knows nothing of `canary_run`, so every DESTRUCTIVE call it
 * makes — the trial_entitlements pre-delete and deleteUser — first re-reads the account and requires the same email and the
 * exact expected canary binding (`expected` repo/workflow/role plus `runId`/`runAttempt`). Reads pass through unchanged; any
 * other mutation is refused. A changed, foreign or vanished binding at the mutation boundary throws: nothing is deleted.
 */
export function guardAdminForBinding(admin, { uid, email, expected, runId, runAttempt }) {
    const refuse = () => { throw new Error('canary_binding_changed_at_mutation (fail closed)'); };
    const revalidate = async () => {
        let got;
        try { got = await admin.auth.admin.getUserById(uid); } catch { refuse(); }
        const u = got?.data?.user;
        if (got?.error || !u || typeof u.email !== 'string' || u.email.toLowerCase() !== String(email).toLowerCase()) refuse();
        const b = parseBinding(u.app_metadata, expected);
        if (!b || b.runId !== runId || b.runAttempt !== runAttempt) refuse();
    };
    return {
        auth: { admin: {
            listUsers: (args) => admin.auth.admin.listUsers(args),
            getUserById: (id) => admin.auth.admin.getUserById(id),
            deleteUser: async (id) => { if (id !== uid) refuse(); await revalidate(); return admin.auth.admin.deleteUser(id); },
        } },
        from: (table) => ({
            select: (...args) => admin.from(table).select(...args),
            delete: () => ({
                eq: async (column, value) => {
                    if (column !== 'user_id' || value !== uid) refuse();
                    await revalidate();
                    return admin.from(table).delete().eq(column, value);
                },
            }),
        }),
    };
}

/** The account domain is the operator-owned domain of the configured trial identity (already validated upstream). */
export function domainFrom(env) {
    const at = (env.CANARY_TRIAL_EMAIL ?? '').lastIndexOf('@');
    return at > 0 ? env.CANARY_TRIAL_EMAIL.slice(at + 1).trim().toLowerCase() : '';
}

/**
 * Create this run's account and export CANARY_EMAIL / CANARY_LANE_PASSWORD to later steps, masked first.
 * Returns {ok, code}. A refusal or failure exports nothing.
 */
export async function setupLane({ admin, env, mask, exportEnv, cleanup }) {
    const binding = currentCanaryBinding(env);
    if (!binding) return { ok: false, code: 'no-run-binding' };
    // Checked HERE, before anything is created: the wrapper below is always a function, so the core's own required-cleanup
    // guard cannot see a missing cleanup through it (review return on 5223bed2).
    if (typeof cleanup !== 'function') return { ok: false, code: 'no-cleanup' };
    // Bind failure: the account this process just created (its uid from createUser) has no valid binding to revalidate, so it
    // goes through the shared cleanup on its uid+email identity alone.
    const result = await createRunOwnedTrialAccount(admin, { binding, domain: domainFrom(env), cleanup: ({ uid, email }) => cleanup({ admin, uid, email }) });
    if (result.status !== 'created') return { ok: false, code: result.code };
    mask(result.email);
    mask(result.password);
    exportEnv('CANARY_EMAIL', result.email);
    exportEnv('CANARY_LANE_PASSWORD', result.password);
    return { ok: true, code: 'created-bound' };
}

/**
 * Delete exactly this run+attempt's run-owned account(s) through the shared zero-residue cleanup.
 * `cleanup({admin, uid, email})` must throw unless deletion AND residue zero are proven; it receives the GUARDED admin.
 * Returns {ok, code, deleted}. Zero accounts is truthful only because the listing is complete (it throws otherwise).
 */
export async function cleanupLane({ admin, env, cleanup }) {
    const binding = currentCanaryBinding(env);
    if (!binding) return { ok: false, code: 'no-run-binding', deleted: 0 };
    let accounts;
    try { accounts = await listRunOwnedAccounts(admin); } catch { return { ok: false, code: 'list-failed', deleted: 0 }; }
    const prefix = `${RUN_OWNED_PREFIX}${binding.runId}-${binding.runAttempt}-`;
    const mine = accounts.filter((u) => {
        const b = parseBinding(u.app_metadata, binding);
        return u.email.toLowerCase().startsWith(prefix) && b && b.runId === binding.runId && b.runAttempt === binding.runAttempt;
    });
    // A prefix match without this run's exact binding is never deleted here; it is the sweeper's (and a human's) to judge.
    const unbound = accounts.filter((u) => u.email.toLowerCase().startsWith(prefix)).length - mine.length;
    let deleted = 0;
    for (const u of mine) {
        const guarded = guardAdminForBinding(admin, { uid: u.id, email: u.email, expected: binding, runId: binding.runId, runAttempt: binding.runAttempt });
        try { await cleanup({ admin: guarded, uid: u.id, email: u.email }); deleted += 1; } catch { return { ok: false, code: 'cleanup-unproven', deleted }; }
    }
    if (unbound > 0) return { ok: false, code: 'prefix-without-binding', deleted };
    return { ok: true, code: deleted ? 'cleanup-verified' : 'nothing-to-clean', deleted };
}

/**
 * Hygiene sweep of orphans from finished runs. Fails only on a failed listing, an unproven deletion or the cap;
 * accounts LEFT for a reason (young, run still going, foreign ref, unbound…) are reported as warnings, not failures.
 */
export async function sweepLane({ admin, env, getRun, cleanup, now = Date.now() }) {
    const binding = currentCanaryBinding(env);
    if (!binding) return { ok: false, code: 'no-run-binding', report: null };
    const byId = new Map();
    const report = await sweep({
        listRunOwnedAccounts: async () => { const all = await listRunOwnedAccounts(admin); for (const u of all) byId.set(u.id, u.email); return all; },
        getUser: async (id) => {
            const { data, error } = await admin.auth.admin.getUserById(id);
            if (error) { if (error.status === 404 || error.code === 'user_not_found') return null; throw new Error('get-failed'); }
            return data?.user ?? null;
        },
        getRun,
        deleteAndProve: async (id, original) => {
            const email = byId.get(id);
            if (!email) return { ok: false, step: 'no-listed-email' };
            if (!original?.runId || !original?.runAttempt) return { ok: false, step: 'no-original-binding' };
            // Revalidated at every destructive call against the ORIGINALLY listed binding. The shared cleanup proves deletion
            // + zero residue; an already-gone account cannot be proven that way, so it is reported unproven, not absent.
            const guarded = guardAdminForBinding(admin, { uid: id, email, expected: binding, runId: original.runId, runAttempt: original.runAttempt });
            try { await cleanup({ admin: guarded, uid: id, email }); return { ok: true }; } catch { return { ok: false, step: 'cleanup-unproven' }; }
        },
    }, { now, expected: binding, self: { runId: binding.runId } });
    const failed = Object.keys(report.failures).length > 0 || report.capReached;
    return { ok: !failed, code: failed ? 'sweep-failed' : 'sweep-ok', report };
}

/** Content-free one-line summary of a sweep report. */
export function describeSweep(report) {
    if (!report) return 'sweep: not-run';
    const fmt = (o) => Object.entries(o).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join(',') || 'none';
    return `sweep: swept=${report.swept} left(${fmt(report.left)}) failures(${fmt(report.failures)}) cap=${report.capReached}`;
}
