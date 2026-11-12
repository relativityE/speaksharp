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

/** The account domain is the operator-owned domain of the configured trial identity (already validated upstream). */
export function domainFrom(env) {
    const at = (env.CANARY_TRIAL_EMAIL ?? '').lastIndexOf('@');
    return at > 0 ? env.CANARY_TRIAL_EMAIL.slice(at + 1).trim().toLowerCase() : '';
}

/**
 * Create this run's account and export CANARY_EMAIL / CANARY_LANE_PASSWORD to later steps, masked first.
 * Returns {ok, code}. A refusal or failure exports nothing.
 */
export async function setupLane({ admin, env, mask, exportEnv }) {
    const binding = currentCanaryBinding(env);
    if (!binding) return { ok: false, code: 'no-run-binding' };
    const result = await createRunOwnedTrialAccount(admin, { binding, domain: domainFrom(env) });
    if (result.status !== 'created') return { ok: false, code: result.code };
    mask(result.email);
    mask(result.password);
    exportEnv('CANARY_EMAIL', result.email);
    exportEnv('CANARY_LANE_PASSWORD', result.password);
    return { ok: true, code: 'created-bound' };
}

/**
 * Delete exactly this run+attempt's run-owned account(s) through the shared zero-residue cleanup.
 * `cleanup({uid, email})` must throw unless deletion AND residue zero are proven.
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
        try { await cleanup({ uid: u.id, email: u.email }); deleted += 1; } catch { return { ok: false, code: 'cleanup-unproven', deleted }; }
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
        deleteAndProve: async (id) => {
            const email = byId.get(id);
            if (!email) return { ok: false, step: 'no-listed-email' };
            // The shared cleanup re-reads the account and proves deletion + zero residue; an already-gone account
            // cannot be proven that way, so it is reported unproven rather than counted as absent.
            try { await cleanup({ uid: id, email }); return { ok: true }; } catch { return { ok: false, step: 'cleanup-unproven' }; }
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
