/**
 * #1390 — CDP PORT AND TARGET DISCOVERY.
 *
 * The operator drives a real browser by hand; the observer has to find that browser's page without
 * guessing. Guessing is the failure mode worth designing against: attaching to the WRONG target means
 * every subsequent identity reading, egress audit and verdict describes a page nobody recorded in.
 *
 * Pure functions here, so the selection rules are testable without a browser. The transport that
 * actually fetches `/json/version` and `/json/list` lives with the launcher.
 */

export const DEFAULT_CDP_ORIGIN = 'http://127.0.0.1:9222';

/**
 * LOOPBACK ONLY. A CDP endpoint is full control of a browser holding a live authenticated session, so
 * a non-loopback origin is refused rather than trusted from an env var — `localhost` included, because
 * it can resolve somewhere unexpected while `127.0.0.1` cannot.
 */
export function assertLoopbackOrigin(origin) {
    let url;
    try {
        url = new URL(origin);
    } catch {
        throw new Error(`CDP origin is not a URL: ${String(origin)}`);
    }
    if (url.protocol !== 'http:') throw new Error(`CDP origin must be http, got ${url.protocol}`);
    if (url.hostname !== '127.0.0.1') {
        throw new Error(
            `CDP origin must be 127.0.0.1 (got "${url.hostname}"). A debugging endpoint is full control `
            + 'of a browser holding a live session; it is not attached to over a non-loopback host.',
        );
    }
    return url.origin;
}

/**
 * Pick the ONE page target for the app under test.
 *
 * AMBIGUITY IS AN ERROR, not a tie-break. If two tabs match, the operator has the app open twice and
 * the observer cannot know which one holds the take — choosing "the first" would silently attach to
 * the wrong session, and every reading afterwards would look perfectly valid.
 */
export function selectAppTarget(targets, appOrigin) {
    const pages = (targets ?? []).filter((t) => t && t.type === 'page' && typeof t.url === 'string');
    const matching = pages.filter((t) => {
        try { return new URL(t.url).origin === new URL(appOrigin).origin; } catch { return false; }
    });
    if (matching.length === 0) {
        return { target: null, error: `no open page on ${appOrigin} (open the app in the launched browser first)` };
    }
    if (matching.length > 1) {
        return {
            target: null,
            error: `${matching.length} pages open on ${appOrigin}; close the extras so the take cannot be `
                + `attributed to the wrong tab (${matching.map((t) => t.url).join(', ')})`,
        };
    }
    return { target: matching[0], error: null };
}

/**
 * Redact a target before it goes into evidence.
 *
 * Target URLs carry query strings and fragments, which is where auth callbacks put tokens. The
 * evidence file is the thing we keep and share, so it holds origin + path only.
 */
export function safeTargetForEvidence(target) {
    if (!target) return null;
    let origin = null;
    let pathname = null;
    try {
        const u = new URL(target.url);
        origin = u.origin;
        pathname = u.pathname;
    } catch { /* leave null rather than echo an unparseable URL */ }
    return { id: target.id ?? null, type: target.type ?? null, origin, pathname };
}
