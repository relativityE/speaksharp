/**
 * Canary active-trial lane, run-owned trial accounts: the orphan SWEEPER core (wired by scripts/canary-run-owned.ts).
 *
 * Deletes a candidate ONLY with positive proof that it is a canary run-owned account from a FINISHED run of THIS
 * repository/workflow, re-checked immediately before deletion. Anything unknown is left alone and reported (non-success).
 * Pure decisions + an injectable orchestrator: admin, GitHub and the zero-residue cleanup proof are passed in.
 * Closed codes only — no email, id or token is ever returned in a report.
 */
export const RUN_OWNED_PREFIX = 'ctrial-run-';
export const ROLE = 'canary-active-trial';
export const MIN_ACCOUNT_AGE_MS = 2 * 3600_000;
export const MIN_RUN_COMPLETED_MS = 30 * 60_000;
export const MAX_DELETES_PER_SWEEP = 5;

const RUN_ID = /^[1-9]\d{0,19}$/;
const ATTEMPT = /^[1-9]\d{0,3}$/;

/** The exact run binding shape, or null. Extra or missing keys, wrong types or a foreign repo/workflow → null. */
export function parseBinding(meta, expected) {
    const b = meta && typeof meta === 'object' ? meta.ct_run : null;
    if (!b || typeof b !== 'object' || Array.isArray(b)) return null;
    const keys = Object.keys(b).sort().join(',');
    if (keys !== 'repository,role,runAttempt,runId,workflow') return null;
    if (b.repository !== expected.repository || b.workflow !== expected.workflow || b.role !== ROLE) return null;
    if (typeof b.runId !== 'string' || !RUN_ID.test(b.runId) || typeof b.runAttempt !== 'string' || !ATTEMPT.test(b.runAttempt)) return null;
    return { runId: b.runId, runAttempt: b.runAttempt };
}

/**
 * One candidate's decision from what was read. `run` is GitHub's run as read: {status, run_attempt, updated_at} or
 * {error:true}. Returns {action:'delete'} or {action:'leave', reason}.
 */
export function decide({ account, run, now, expected, self }) {
    if (typeof account?.email !== 'string' || !account.email.toLowerCase().startsWith(RUN_OWNED_PREFIX)) return { action: 'leave', reason: 'not-run-owned-prefix' };
    if (account.app_metadata?.ct_run === undefined) return { action: 'leave', reason: 'unbound' };
    const binding = parseBinding(account.app_metadata, expected);
    if (!binding) return { action: 'leave', reason: 'malformed-or-foreign-binding' };
    if (self && binding.runId === self.runId) return { action: 'leave', reason: 'own-current-run' };
    const created = Date.parse(account.created_at ?? '');
    if (!Number.isFinite(created) || now - created < MIN_ACCOUNT_AGE_MS) return { action: 'leave', reason: 'too-young' };
    if (!run || run.error) return { action: 'leave', reason: 'run-lookup-failed' };
    if (String(run.run_attempt) !== binding.runAttempt) return { action: 'leave', reason: 'attempt-mismatch' };
    if (run.status !== 'completed') return { action: 'leave', reason: run.status ? 'run-not-completed' : 'run-state-unknown' };
    const done = Date.parse(run.updated_at ?? '');
    if (!Number.isFinite(done) || now - done < MIN_RUN_COMPLETED_MS) return { action: 'leave', reason: 'run-completed-too-recently' };
    return { action: 'delete', binding };
}

/**
 * Sweep. deps: listRunOwnedAccounts() → [{id,email,created_at,app_metadata}] | throws; getUser(id) → account|null|throws;
 * getRun(runId, runAttempt) → that ATTEMPT's run | {error:true}; deleteAndProve(id) → {ok:true} | {ok:false, step} | {ok:'absent'} (absent = auth user
 * already gone AND full residue read-back zero; residue without an account must be {ok:false, step:'residue-without-account'}).
 */
export async function sweep(deps, { now = Date.now(), expected, self } = {}) {
    const report = { swept: 0, alreadyGone: 0, left: {}, failures: {}, capReached: false, success: true };
    const leave = (reason) => { report.left[reason] = (report.left[reason] ?? 0) + 1; report.success = false; };
    let candidates;
    try { candidates = await deps.listRunOwnedAccounts(); } catch { report.success = false; report.failures['list-failed'] = 1; return report; }
    for (const account of candidates) {
        let first;
        const bound = parseBinding(account.app_metadata, expected);
        try { first = decide({ account, run: bound ? await deps.getRun(bound.runId, bound.runAttempt) : null, now, expected, self }); }
        catch { leave('run-lookup-failed'); continue; }
        if (first.action !== 'delete') { if (first.reason !== 'not-run-owned-prefix') leave(first.reason); continue; }
        if (report.swept + report.alreadyGone >= MAX_DELETES_PER_SWEEP) { report.capReached = true; report.success = false; continue; }
        // Re-check immediately before deletion: the same account, the same binding, the run still completed.
        let again;
        try {
            const fresh = await deps.getUser(account.id);
            // Gone between list and re-check: still go through deleteAndProve, which must prove zero residue
            // before it may report `absent` (never counted as gone from the auth lookup alone).
            if (!fresh) { again = { action: 'delete', binding: first.binding }; }
            else {
                const run = await deps.getRun(first.binding.runId, first.binding.runAttempt);
                again = decide({ account: fresh, run, now, expected, self });
                if (again.action === 'delete' && (again.binding.runId !== first.binding.runId || again.binding.runAttempt !== first.binding.runAttempt)) {
                    again = { action: 'leave', reason: 'binding-changed' };
                }
            }
        } catch { leave('recheck-failed'); continue; }
        if (again.action === 'leave') { leave(again.reason === 'run-lookup-failed' ? 'run-lookup-failed' : 'state-changed'); continue; }
        let result;
        try { result = await deps.deleteAndProve(account.id); } catch { result = { ok: false, step: 'unknown' }; }
        if (result.ok === true) report.swept += 1;
        else if (result.ok === 'absent') report.alreadyGone += 1;
        else { report.failures[result.step ?? 'unknown'] = (report.failures[result.step ?? 'unknown'] ?? 0) + 1; report.success = false; }
    }
    return report;
}
