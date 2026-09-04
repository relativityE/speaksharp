/**
 * #1259 RETURN — MEASURED AT THE BROWSER'S OWN FETCH BOUNDARY.
 *
 * `network_used` was derived from the pre-load cache classification: a miss or partial was reported as
 * "bytes crossed the network". That is a prediction made before the load, not an observation of it. It
 * is wrong in both directions — a probe that could not see the cache reported no network for a load
 * that downloaded hundreds of megabytes, and a probed miss would have reported network for a load that
 * failed before requesting anything.
 *
 * Resource Timing is the browser's own record of what was actually fetched, and it works for any loader
 * that uses fetch or XHR, so this measures the real boundary without reaching inside a vendor library.
 *
 * PER-FIELD HONESTY. A cross-origin response without `Timing-Allow-Origin` reports zeroed sizes while
 * still reporting that the request happened and how long it took. That is a partial observation, and it
 * is reported as one: the count and duration are real, and bytes are null. Reporting zero bytes there
 * would invent a cache hit out of a missing header.
 */

export interface AcquisitionNetworkObservation {
    /** Requests the browser actually made for this candidate's assets. Null when Resource Timing is absent. */
    assetCount: number | null;
    /** Bytes over the wire. Null when every matching entry hid its sizes (cross-origin without TAO). */
    networkBytes: number | null;
    /** Wall time from the first matching request to the last one finishing. Null when nothing matched. */
    downloadMs: number | null;
    /** True when bytes provably crossed the wire, false when provably served from cache, null when unknown. */
    networkUsed: boolean | null;
    /** Why a field is null, when it is. */
    unobservableReason: string | null;
    /**
     * Requests the browser made in this window that fell OUTSIDE the declared scope.
     *
     * A repository-scoped candidate can be redirected to a CDN whose URL no longer contains the
     * repository id, and a loader can request files this product never pinned. Reporting the residue
     * makes a scope that stopped matching visible as a discrepancy, instead of quietly shrinking the
     * measured download to whatever still matched.
     */
    outOfScopeCount: number | null;
}

const UNOBSERVED: AcquisitionNetworkObservation = {
    assetCount: null, networkBytes: null, downloadMs: null, networkUsed: null, outOfScopeCount: null,
    unobservableReason: 'Resource Timing is unavailable in this environment',
};

type TimingSource = Pick<Performance, 'getEntriesByType'> | undefined;

/**
 * Read what was fetched for this candidate between `startedAt` and now.
 *
 * `startedAt` and the prefixes together scope the window: without the time bound a warm reload would
 * count the previous load's entries, and without the prefixes it would count every image on the page.
 */
export function observeAcquisitionNetwork(
    prefixes: readonly string[],
    startedAt: number,
    perf: TimingSource = typeof performance !== 'undefined' ? performance : undefined,
): AcquisitionNetworkObservation {
    if (!perf || typeof perf.getEntriesByType !== 'function') return UNOBSERVED;
    if (prefixes.length === 0) {
        return { ...UNOBSERVED, unobservableReason: 'no acquisition scope is known for this candidate' };
    }

    let entries: PerformanceResourceTiming[];
    try {
        entries = perf.getEntriesByType('resource') as PerformanceResourceTiming[];
    } catch {
        return UNOBSERVED;
    }

    const inWindow = entries.filter((e) => e.startTime >= startedAt);
    // `includes`, not `startsWith`: a scope may be a served location OR a repository identity that
    // appears inside the request path.
    const matched = inWindow.filter((e) => prefixes.some((p) => e.name.includes(p)));
    const outOfScopeCount = inWindow.length - matched.length;

    if (matched.length === 0) {
        if (inWindow.length > 0) {
            // Requests HAPPENED and none matched. Reporting zero assets here would describe a load that
            // fetched nothing, when in fact the scope stopped matching what the loader asked for —
            // a redirect to another host, or a request shape this scope does not describe.
            return {
                assetCount: null, networkBytes: null, downloadMs: null, networkUsed: null,
                outOfScopeCount,
                unobservableReason: 'requests were observed in this window but none matched the declared '
                    + 'scope; the scope no longer describes what the loader requested',
            };
        }
        // NOT a cache hit and NOT zero bytes: a load can complete without this observation existing at
        // all, for instance from a worker whose entries live on another timeline. Saying "nothing was
        // fetched" here would be the same invention this correction removes.
        return {
            assetCount: 0, networkBytes: null, downloadMs: null, networkUsed: null, outOfScopeCount,
            unobservableReason: 'no matching resource entries were recorded for this acquisition window',
        };
    }

    const sized = matched.filter((e) => typeof e.transferSize === 'number' && (e.transferSize > 0 || e.encodedBodySize > 0));
    const anyOpaque = matched.some((e) => e.transferSize === 0 && e.encodedBodySize === 0);
    const transferred = sized.reduce((sum, e) => sum + (e.transferSize ?? 0), 0);

    const firstStart = Math.min(...matched.map((e) => e.startTime));
    const lastEnd = Math.max(...matched.map((e) => e.responseEnd || e.startTime + e.duration));

    // A non-zero transferSize is proof of the wire. A zero transferSize with a real body is proof of the
    // cache. All-opaque is proof of neither, so it stays null rather than defaulting to the flattering
    // answer in either direction.
    const provenNetwork = sized.some((e) => (e.transferSize ?? 0) > 0);
    const provenCache = sized.length > 0 && sized.every((e) => (e.transferSize ?? 0) === 0);
    const networkUsed = provenNetwork ? true : (provenCache ? false : null);

    return {
        assetCount: matched.length,
        outOfScopeCount,
        networkBytes: sized.length === 0 ? null : transferred,
        downloadMs: Math.max(0, Math.round(lastEnd - firstStart)),
        networkUsed,
        unobservableReason: sized.length === 0
            ? 'every matching response hid its size (cross-origin without Timing-Allow-Origin)'
            : (anyOpaque ? 'some matching responses hid their size; bytes cover the observable ones only' : null),
    };
}
