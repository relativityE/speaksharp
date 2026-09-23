/**
 * WHICH ROUTES MAY BOOT THE SPEECH RUNTIME.
 *
 * `main.tsx` warmed the runtime on EVERY route. That is not free and it is not silent:
 * `initializeInfrastructure()` transitions the controller to `READY`, and every entry into
 * `IDLE`/`READY` arms the 5-minute idle-reclamation timer (`SpeechRuntimeController.transition`).
 * On a page nobody records on — the landing page, `/terms`, `/auth/signin` — that timer fires,
 * reclaims, lands the machine back in a timer-arming state, and fires again: a permanent
 * `IDLE`↔`TERMINATED` cycle on an idle tab. It costs battery on the user's device, and it fills
 * the release's lifecycle telemetry with transitions no user performed, which is what made the
 * observed baselines unreadable.
 *
 * The warm-up is also redundant where it matters: `TranscriptionProvider` calls
 * `initializeInfrastructure()` on mount, and that provider wraps exactly the runtime routes
 * (`App.tsx`). `initializeInfrastructure()` is idempotent (guarded by `readyPromise`), so the boot
 * call is a HEAD START for a direct load of a runtime route, never the only initializer — which is
 * why declining it elsewhere cannot leave a route without a runtime: navigating to one mounts the
 * provider, which initializes it.
 *
 * It does NOT warm an engine. No model is fetched here (`warmUp()` does that, owned by the session
 * lifecycle after tier resolution), so the original "defer heavy WASM" framing overstates what this
 * call costs on the routes that keep it.
 */

/**
 * The EXACT router patterns (as declared in `App.tsx`) whose pages mount `TranscriptionProvider`.
 *
 * Codex P2 on 117e5f2e: these used to be PREFIXES, so `/session/anything` booted the runtime — but
 * `App.tsx` declares `/session` exactly and `/analytics/:sessionId` with ONE segment, and anything
 * deeper renders the `*` NotFoundPage. A prefix rule therefore armed the reclamation cycle on a 404
 * tab. Listing the patterns themselves, matched segment by segment, keeps this list and the router
 * speaking the same language (the CONTRACT test reads `App.tsx` to hold them equal).
 */
export const RUNTIME_BOOT_ROUTES = ['/session', '/analytics', '/analytics/:sessionId'] as const;

const segmentsOf = (path: string) => path.split('/').filter(Boolean);

/** React Router semantics for these patterns: same segment count; `:param` matches one non-empty segment. */
function matchesRoutePattern(pathSegments: string[], pattern: string): boolean {
    const patternSegments = segmentsOf(pattern);
    if (patternSegments.length !== pathSegments.length) return false;
    return patternSegments.every((seg, i) => seg.startsWith(':') ? pathSegments[i].length > 0 : seg === pathSegments[i]);
}

/**
 * Does a first paint at `pathname` need the runtime warmed before React mounts?
 *
 * Only a path the router would actually render a runtime page for: `/analytics/<id>` qualifies, while
 * `/session/anything`, `/analytics/a/b` (both 404) and a neighbour like `/sessions-archive` do not.
 * Compared case-insensitively because the routes in `App.tsx` are declared without `caseSensitive`, so
 * React Router will render `/Session`.
 */
export function pathNeedsRuntimeAtBoot(pathname: string | null | undefined): boolean {
    if (!pathname) return false;
    // Strip query/hash defensively: callers pass `location.pathname`, but a caller that passes a
    // whole URL must not silently fail the match.
    const path = pathname.toLowerCase().split(/[?#]/)[0].replace(/\/+$/, '') || '/';
    const pathSegments = segmentsOf(path);
    return RUNTIME_BOOT_ROUTES.some((pattern) => matchesRoutePattern(pathSegments, pattern));
}

/**
 * Boot the runtime only for a path that needs it. Returns whether `start` was invoked, so the
 * decision is observable in a test instead of inferred from a log line.
 */
export function startRuntimeIfPathNeedsIt(pathname: string | null | undefined, start: () => void): boolean {
    if (!pathNeedsRuntimeAtBoot(pathname)) return false;
    start();
    return true;
}
