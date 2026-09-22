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

/** Route prefixes whose pages mount `TranscriptionProvider` and therefore use the runtime. */
export const RUNTIME_BOOT_ROUTES = ['/session', '/analytics'] as const;

/**
 * Does a first paint at `pathname` need the runtime warmed before React mounts?
 *
 * Prefix match on a SEGMENT boundary, so `/analytics/<id>` qualifies while a future
 * `/sessions-archive` does not. Compared case-insensitively because the routes in `App.tsx` are
 * declared without `caseSensitive`, so React Router will render `/Session`.
 */
export function pathNeedsRuntimeAtBoot(pathname: string | null | undefined): boolean {
    if (!pathname) return false;
    // Strip query/hash defensively: callers pass `location.pathname`, but a caller that passes a
    // whole URL must not silently fail the match.
    const path = pathname.toLowerCase().split(/[?#]/)[0].replace(/\/+$/, '') || '/';
    return RUNTIME_BOOT_ROUTES.some((route) => path === route || path.startsWith(`${route}/`));
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
