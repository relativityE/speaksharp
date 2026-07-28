#!/usr/bin/env node
/**
 * Vercel "Ignored Build Step" decision, version-controlled (referenced from vercel.json `ignoreCommand`
 * so it is reviewable rather than an undocumented dashboard-only rule).
 *
 * INVERTED VERCEL CONTRACT — exit 1 = CONTINUE the build; exit 0 = IGNORE (skip) the build.
 *
 * Policy:
 *   - production                                  -> BUILD (1), regardless of the marker
 *   - preview + commit message contains the marker-> BUILD (1)  (explicit opt-in)
 *   - preview without the marker                  -> SKIP  (0)  (keeps normal PR commits cheap)
 *   - missing / unknown environment               -> SKIP  (0)  (fail safe)
 *
 * Reads ONLY the two documented env vars. No PR titles, labels, remote APIs, or secrets.
 */

export const PREVIEW_MARKER = '[vercel-preview]';

export const EXIT_BUILD = 1;  // Vercel: continue the build
export const EXIT_SKIP = 0;   // Vercel: ignore the build

/**
 * Pure decision — returns the exit code Vercel should observe.
 * @param {string|undefined} vercelEnv  VERCEL_ENV ('production' | 'preview' | ...)
 * @param {string|undefined} commitMessage VERCEL_GIT_COMMIT_MESSAGE
 */
export function decideExitCode(vercelEnv, commitMessage) {
    if (vercelEnv === 'production') return EXIT_BUILD;
    if (vercelEnv === 'preview') {
        return typeof commitMessage === 'string' && commitMessage.includes(PREVIEW_MARKER)
            ? EXIT_BUILD
            : EXIT_SKIP;
    }
    // Missing or unrecognized environment: never build implicitly.
    return EXIT_SKIP;
}

// CLI entrypoint (skipped when imported by tests).
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
    const env = process.env.VERCEL_ENV;
    const msg = process.env.VERCEL_GIT_COMMIT_MESSAGE;
    const code = decideExitCode(env, msg);
    const verdict = code === EXIT_BUILD ? 'BUILD' : 'SKIP';
    // Log the environment only — never the full commit message (avoids leaking arbitrary text into logs).
    console.log(`[vercel-ignore-build] env=${env ?? '(unset)'} marker=${
        typeof msg === 'string' && msg.includes(PREVIEW_MARKER) ? 'present' : 'absent'
    } -> ${verdict} (exit ${code})`);
    process.exit(code);
}
