/** Run binding of a disposable account (no imports: shared by rwtJourney and runOwnedCleanup without a module cycle). */
/**
 * The run that owns a disposable account (PO option C, 2026-11-10): written by the service role into app_metadata.ct_run, which
 * only the service role can write, so an interrupted run's account can later be selected by this binding instead of by its
 * public address pattern and time window. Null outside GitHub Actions (a local run binds nothing).
 */
export interface RunBinding { repository: string; workflow: string; runId: string; runAttempt: string; role: 'rwt-journey' }
export function currentRunBinding(env: Record<string, string | undefined> = process.env): RunBinding | null {
    const b = { repository: env.GITHUB_REPOSITORY ?? '', workflow: env.GITHUB_WORKFLOW_REF ?? '', runId: env.GITHUB_RUN_ID ?? '',
        runAttempt: env.GITHUB_RUN_ATTEMPT ?? '', role: 'rwt-journey' as const };
    if (env.GITHUB_ACTIONS !== 'true' || !/^[\w.-]+\/[\w.-]+$/.test(b.repository) || !/^[\w.-]+\/[\w.-]+\/\.github\/workflows\/[\w.-]+\.ya?ml@refs\/[\w./-]+$/.test(b.workflow)
        || !/^[1-9]\d{0,19}$/.test(b.runId) || !/^[1-9]\d{0,3}$/.test(b.runAttempt)) return null;
    return b;
}
/** Exactly this binding (no extra or missing key). */
export function sameRunBinding(meta: unknown, binding: RunBinding): boolean {
    const ct = (meta as { ct_run?: unknown } | null | undefined)?.ct_run;
    if (!ct || typeof ct !== 'object' || Array.isArray(ct)) return false;
    const c = ct as Record<string, unknown>;
    const keys = Object.keys(binding) as Array<keyof RunBinding>;
    return Object.keys(c).length === keys.length && keys.every((k) => c[k] === binding[k]);
}
