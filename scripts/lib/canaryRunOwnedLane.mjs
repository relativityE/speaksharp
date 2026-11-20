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
import { BINDING_KEY, MIN_ACCOUNT_AGE_MS, MIN_RUN_COMPLETED_MS, ROLE, RUN_OWNED_PREFIX, parseBinding, sweep } from './canaryRunOwnedSweep.mjs';
import { createRunOwnedTrialAccount, currentCanaryBinding } from './canaryRunOwnedAccount.mjs';

export const PER_PAGE = 200;
/** #1906: the service_role-only listing of runs whose deleted accounts still hold an unfinished save-journal cleanup claim. */

/** A canary run's binding in the exact shape its save-journal claim stores (the account's own `canary_run`). */
export function canaryClaimBinding(expected, runId, runAttempt) {
    return { repository: expected.repository, workflow: expected.workflow, role: ROLE, runId, runAttempt };
}
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
 * exact expected canary binding (`expected` repo/workflow/role plus `runId`/`runAttempt`). Reads pass through unchanged; the
 * four #1643 save-journal functions pass only for this account (the claim revalidated, the claim and its restart resume carrying
 * this run's binding); any other mutation is refused. A changed, foreign or vanished binding at the mutation boundary throws: nothing is deleted.
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
        // #1643 save journal: only the three service_role-only functions, only for THIS account. The shared helper knows nothing
        // of `canary_run` and claims as an unbound account (no binding); the claim is the one call that names a binding, so it is
        // forwarded only after the same revalidation as every destructive call, with THIS run's exact canary binding in its place
        // (the database then checks it against the account's own). The delete and count run after the account is deleted: the
        // delete is refused by the database unless this cleanup's own claim secret is presented.
        rpc: async (fn, args) => {
            const keys = Object.keys(args ?? {}).sort().join();
            if (args?.p_user_id !== uid) refuse();
            if (fn === 'claim_account_save_journal_cleanup_v1') {
                if (keys !== 'p_run_binding,p_token,p_user_id' || args.p_run_binding !== null) refuse();
                await revalidate();
                return admin.rpc(fn, { p_user_id: uid, p_run_binding: canaryClaimBinding(expected, runId, runAttempt), p_token: args.p_token });
            }
            // The restart after Auth deletion (Sam, #1906): the account is gone, so there is nothing to revalidate; the binding is
            // THIS run's exact canary binding in place of whatever the shared helper passed (it knows nothing of canary_run), and the
            // database accepts it only if the claim was made with that binding and this address.
            if (fn === 'resume_account_save_journal_cleanup_v1') {
                if (keys !== 'p_email,p_run_binding,p_token,p_user_id' || String(args.p_email).toLowerCase() !== String(email).toLowerCase()) refuse();
                return admin.rpc(fn, { p_user_id: uid, p_email: args.p_email, p_run_binding: canaryClaimBinding(expected, runId, runAttempt), p_token: args.p_token });
            }
            if (fn === 'delete_deleted_account_save_journal_v1' ? keys !== 'p_token,p_user_id'
                : fn !== 'count_account_save_journal_v1' || keys !== 'p_user_id') refuse();
            return admin.rpc(fn, args);
        },
    };
}

/**
 * The admin client for the BIND-FAILURE cleanup of the account THIS process just created (Codex on 62b50df). Everything passes to
 * the plain client as before, except the save-journal claim: the shared helper knows nothing of `canary_run` and claims as an
 * unbound account, which the database refuses for an account that does carry a binding. So the claim re-reads the account and,
 * when it carries THIS run's exact binding (the read-back that failed was only transient), presents that binding; otherwise it
 * stays unbound, which the database accepts only for an account with no binding at all. Only this account's claim is changed.
 */
export function bindFailureAdmin(admin, { uid, binding }) {
    return {
        auth: admin.auth,
        from: (table) => admin.from(table),
        rpc: async (fn, args) => {
            if (fn !== 'claim_account_save_journal_cleanup_v1' || args?.p_user_id !== uid || args?.p_run_binding !== null) return admin.rpc(fn, args);
            let presented = null;
            try {
                const { data, error } = await admin.auth.admin.getUserById(uid);
                const b = error ? null : parseBinding(data?.user?.app_metadata, binding);
                if (b && b.runId === binding.runId && b.runAttempt === binding.runAttempt) presented = canaryClaimBinding(binding, b.runId, b.runAttempt);
            } catch { presented = null; }
            return admin.rpc(fn, { ...args, p_run_binding: presented });
        },
    };
}

/**
 * RESTART AFTER DELETION for canary runs (Codex on 62b50df). A canary cleanup that stopped after the Auth deletion and before its
 * save journal was cleared leaves a claim that no Auth listing can find. The complete inventory of open claims is read
 * (`readSaveJournal(admin, minAgeSeconds)`: the shared helper's reader, bindings and counts only, never ids), and each canary run
 * of THIS repository/workflow is finished by its binding (`finishSaveJournal(admin, binding)`: the shared helper's resume-by-run,
 * residue read-back, delete and zero read-back), but only when none of its claims is recent, GitHub shows that exact attempt
 * completed long enough ago, and never the current run (its own cleanup step finishes it). Other workflows' runs (RWT) are not
 * the canary's and are left to their own recovery. An inventory that cannot be read or proven complete (Sam, #1906 review)
 * fails the sweep. Returns counts only; `failed` > 0 fails the sweep.
 */
export async function sweepSaveJournalRuns({ admin, getRun, expected, now, finishSaveJournal, readSaveJournal }) {
    const out = { runs: 0, finished: 0, left: 0, failed: 0 };
    let read;
    try { read = await readSaveJournal(admin, MIN_ACCOUNT_AGE_MS / 1000); } catch { read = { status: 'error' }; }
    if (read?.status === 'absent') return out;
    if (read?.status !== 'ok' || !Array.isArray(read.inventory?.runs)) { out.failed += 1; return out; }
    for (const entry of read.inventory.runs) {
        const b = parseBinding({ [BINDING_KEY]: entry?.binding }, expected);
        if (!b) continue;
        out.runs += 1;
        if (b.runId === expected.runId || entry.recent !== 0) { out.left += 1; continue; }
        let run;
        try { run = await getRun(b.runId, b.runAttempt); } catch { run = { error: true }; }
        const done = Date.parse(run?.updated_at ?? '');
        if (!run || run.error || String(run.run_attempt) !== b.runAttempt || run.status !== 'completed'
            || !Number.isFinite(done) || now - done < MIN_RUN_COMPLETED_MS) { out.left += 1; continue; }
        let finished;
        try { finished = await finishSaveJournal(admin, canaryClaimBinding(expected, b.runId, b.runAttempt)); } catch { out.failed += 1; continue; }
        // A finish must report a counted number, and at least every claim the inventory listed for that run: fewer means some
        // claim was not reached (never read as zero or as done).
        if (!Number.isSafeInteger(finished) || finished < entry.claims) { out.failed += 1; continue; }
        out.finished += finished;
    }
    return out;
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
    const result = await createRunOwnedTrialAccount(admin, { binding, domain: domainFrom(env),
        cleanup: ({ uid, email }) => cleanup({ admin: bindFailureAdmin(admin, { uid, binding }), uid, email }) });
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
 * Returns {ok, code, deleted, orphans}: `orphans` counts this run+attempt's own stopped cleanups (account already gone) finished
 * by binding. Zero accounts is truthful only because the listing is complete (it throws otherwise).
 */
/**
 * The closed failure code of one cleanup (#1826, Sam's option c): the adapter's own code when it names one (`unsettled_take`,
 * `delete_refused`, `take_read_failed`), otherwise `cleanup-unproven`. An unsettled or refused account is PRESERVED, never retried
 * into a different state and never reported as removed.
 */
export function cleanupCode(error) {
    const code = error && typeof error === 'object' ? error.canaryCode : undefined;
    return ['unsettled_take', 'delete_refused', 'take_read_failed'].includes(code) ? code : 'cleanup-unproven';
}

/** Recovery identity of a preserved account: its run binding and its owned address pattern. No email, uid or token. */
export function ownedIdentity(binding) {
    return { runId: binding.runId, runAttempt: binding.runAttempt, accountPattern: `ctrial-run-${binding.runId}-${binding.runAttempt}-*` };
}

export async function cleanupLane({ admin, env, cleanup, finishSaveJournal }) {
    const binding = currentCanaryBinding(env);
    if (!binding) return { ok: false, code: 'no-run-binding', deleted: 0 };
    if (typeof finishSaveJournal !== 'function') return { ok: false, code: 'no-save-journal-finish', deleted: 0 };
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
        try { await cleanup({ admin: guarded, uid: u.id, email: u.email }); deleted += 1; } catch (error) {
            const code = cleanupCode(error);
            return code === 'cleanup-unproven' ? { ok: false, code, deleted } : { ok: false, code, deleted, preserved: ownedIdentity(binding) };
        }
    }
    // RESTART AFTER DELETION (Codex on 62b50df): an earlier cleanup of THIS run+attempt that stopped after the Auth deletion left a
    // claim no listing above can see. Finish it by this run's own binding (plain client: the account is gone, nothing to revalidate).
    let orphans;
    try { orphans = await finishSaveJournal(admin, canaryClaimBinding(binding, binding.runId, binding.runAttempt)); }
    catch { return { ok: false, code: 'save-journal-unproven', deleted }; }
    // A finish that does not report a counted number proved nothing (never read as zero).
    if (!Number.isSafeInteger(orphans) || orphans < 0) return { ok: false, code: 'save-journal-unproven', deleted };
    if (unbound > 0) return { ok: false, code: 'prefix-without-binding', deleted, orphans };
    // Sam, #1906 review of 6b8943d: an own leftover that was actually finished is reported as a cleanup, never as nothing to clean.
    return { ok: true, code: deleted || orphans ? 'cleanup-verified' : 'nothing-to-clean', deleted, orphans };
}

/**
 * Hygiene sweep of orphans from finished runs. Fails only on a failed listing, an unproven deletion or the cap;
 * accounts LEFT for a reason (young, run still going, foreign ref, unbound…) are reported as warnings, not failures.
 */
export async function sweepLane({ admin, env, getRun, cleanup, finishSaveJournal, readSaveJournal, now = Date.now() }) {
    const binding = currentCanaryBinding(env);
    if (!binding) return { ok: false, code: 'no-run-binding', report: null };
    if (typeof finishSaveJournal !== 'function') return { ok: false, code: 'no-save-journal-finish', report: null };
    if (typeof readSaveJournal !== 'function') return { ok: false, code: 'no-save-journal-read', report: null };
    const preserved = [];
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
            try { await cleanup({ admin: guarded, uid: id, email }); return { ok: true }; } catch (error) {
                const step = cleanupCode(error);
                // Preserved for recovery, not removed: the sweep never claims an unsettled orphan is gone.
                if (step !== 'cleanup-unproven') preserved.push({ step, ...ownedIdentity({ runId: original.runId, runAttempt: original.runAttempt }) });
                return { ok: false, step };
            }
        },
    }, { now, expected: binding, self: { runId: binding.runId } });
    report.saveJournal = await sweepSaveJournalRuns({ admin, getRun, expected: binding, now, finishSaveJournal, readSaveJournal });
    const failed = Object.keys(report.failures).length > 0 || report.capReached || report.saveJournal.failed > 0;
    return { ok: !failed, code: failed ? 'sweep-failed' : 'sweep-ok', report, preserved };
}

/** Content-free one-line summary of a sweep report. */
export function describeSweep(report) {
    if (!report) return 'sweep: not-run';
    const fmt = (o) => Object.entries(o).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join(',') || 'none';
    const sj = report.saveJournal ? ` save_journal(runs=${report.saveJournal.runs},finished=${report.saveJournal.finished},left=${report.saveJournal.left},failed=${report.saveJournal.failed})` : '';
    return `sweep: swept=${report.swept} left(${fmt(report.left)}) failures(${fmt(report.failures)}) cap=${report.capReached}${sj}`;
}
