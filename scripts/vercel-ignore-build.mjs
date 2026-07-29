#!/usr/bin/env node
/**
 * Vercel "Ignored Build Step" decision, version-controlled (referenced from vercel.json `ignoreCommand`
 * so it is reviewable rather than an undocumented dashboard-only rule).
 *
 * INVERTED VERCEL CONTRACT — exit 1 = CONTINUE the build; exit 0 = IGNORE (skip) the build.
 *
 * Policy (branch-prefix opt-in):
 *   - production                       -> BUILD (1), always
 *   - preview on a `preview/*` branch  -> BUILD (1), the deliberate opt-in
 *   - preview on any other branch      -> SKIP  (0), ordinary PR commits stay cheap
 *   - missing / unknown environment    -> SKIP  (0), fail safe
 *
 * Why a branch prefix rather than a commit-message marker or a committed flag file:
 *   - creating a `preview/*` branch is a deliberate act; a marker is easy to paste in by accident
 *   - the preview branch pins an EXACT SHA, and can be deleted the moment evidence collection ends
 *   - nothing temporary enters product code (a committed flag file could be merged to `main` and then
 *     inherited by every future branch)
 *   - only collaborators who can push repository branches can trigger a preview
 *
 * Reads ONLY the two documented system env vars. No PR titles, labels, remote APIs, or secrets.
 *
 * SCOPE BOUNDARY: this script only decides WHETHER a build runs; it does not scope any header.
 * NOTE: vercel.json's cross-origin-isolation headers apply to EVERY host, production included — they are
 * no longer preview-gated. A `preview/*` build therefore reproduces the production isolation posture
 * rather than a preview-only one, and deploying production DOES enable multi-threaded WASM for testers.
 */

export const PREVIEW_BRANCH_PREFIX = 'preview/';

export const EXIT_BUILD = 1;  // Vercel: continue the build
export const EXIT_SKIP = 0;   // Vercel: ignore the build

/**
 * Pure decision — returns the exit code Vercel should observe.
 * @param {string|undefined} vercelEnv VERCEL_ENV ('production' | 'preview' | ...)
 * @param {string|undefined} gitRef    VERCEL_GIT_COMMIT_REF (the branch name)
 */
export function decideExitCode(vercelEnv, gitRef) {
    if (vercelEnv === 'production') return EXIT_BUILD;
    if (vercelEnv === 'preview') {
        return typeof gitRef === 'string' && gitRef.startsWith(PREVIEW_BRANCH_PREFIX)
            ? EXIT_BUILD
            : EXIT_SKIP;
    }
    // Missing or unrecognized environment: never build implicitly.
    return EXIT_SKIP;
}

// CLI entrypoint (skipped when imported by tests).
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
    const env = process.env.VERCEL_ENV;
    const ref = process.env.VERCEL_GIT_COMMIT_REF;
    const code = decideExitCode(env, ref);
    console.log(
        `[vercel-ignore-build] env=${env ?? '(unset)'} ref=${ref ?? '(unset)'} -> ${
            code === EXIT_BUILD ? 'BUILD' : 'SKIP'
        } (exit ${code})`,
    );
    process.exit(code);
}
