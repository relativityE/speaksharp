/** Run binding of a disposable account (no imports: shared by rwtJourney and runOwnedCleanup without a module cycle). */
/**
 * The run that owns a disposable account (PO option C, 2026-11-10): written by the service role into app_metadata.ct_run, which
 * only the service role can write, so an interrupted run's account can later be selected by this binding instead of by its
 * public address pattern and time window. Null outside GitHub Actions (a local run binds nothing).
 */
export interface RunBinding { repository: string; workflow: string; runId: string; runAttempt: string; role: 'rwt-journey' }
/**
 * The binding of THIS run: `{ binding }` in a well-formed GitHub Actions run, `{ local: true }` outside Actions (a local run binds
 * nothing), and `{ error }` in Actions when any field is unusable — never silently treated as local (review: a valid ref such as
 * `refs/heads/a+b` must bind, and an unusable one must fail clearly). Ref names: any non-whitespace, non-control characters.
 */
export function runBindingState(env: Record<string, string | undefined> = process.env): { binding: RunBinding } | { local: true } | { error: string } {
    if (env.GITHUB_ACTIONS !== 'true') return { local: true };
    const b = { repository: env.GITHUB_REPOSITORY ?? '', workflow: env.GITHUB_WORKFLOW_REF ?? '', runId: env.GITHUB_RUN_ID ?? '',
        runAttempt: env.GITHUB_RUN_ATTEMPT ?? '', role: 'rwt-journey' as const };
    if (!/^[\w.-]+\/[\w.-]+$/.test(b.repository)) return { error: 'repository' };
    // no whitespace, no C0 control or DEL anywhere in the ref
    if (!/^[\w.-]+\/[\w.-]+\/\.github\/workflows\/[\w.-]+\.ya?ml@refs\/[^\s]+$/.test(b.workflow) || [...b.workflow].some((ch) => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127)) {
        return { error: 'workflow' };
    }
    if (!/^[1-9]\d{0,19}$/.test(b.runId)) return { error: 'run-id' };
    if (!/^[1-9]\d{0,3}$/.test(b.runAttempt)) return { error: 'run-attempt' };
    return { binding: b };
}
/** This run's binding, or null (outside Actions, or unusable in Actions — callers that bind must use runBindingState). */
export function currentRunBinding(env: Record<string, string | undefined> = process.env): RunBinding | null {
    const s = runBindingState(env);
    return 'binding' in s ? s.binding : null;
}
/** Exactly this binding (no extra or missing key). */
export function sameRunBinding(meta: unknown, binding: RunBinding): boolean {
    const ct = (meta as { ct_run?: unknown } | null | undefined)?.ct_run;
    if (!ct || typeof ct !== 'object' || Array.isArray(ct)) return false;
    const c = ct as Record<string, unknown>;
    const keys = Object.keys(binding) as Array<keyof RunBinding>;
    return Object.keys(c).length === keys.length && keys.every((k) => c[k] === binding[k]);
}
