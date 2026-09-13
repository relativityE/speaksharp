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

/**
 * How much of the acquisition this observation actually covers.
 *
 * `complete`     — every request in the window was matched and sized. The measurement describes the
 *                  whole download and may be published as such.
 * `partial`      — requests were matched, but some were missed or hid their size. Real numbers, covering
 *                  an unknown fraction. Publishing these as complete is the failure this exists to stop:
 *                  a redirected v4 download would otherwise look like a small, fast, complete one.
 * `unobservable` — nothing usable was observed. Every measurement field stays null.
 */
export type MeasurementCompleteness = 'complete' | 'partial' | 'unobservable';

/**
 * BOUNDED reason vocabulary. The free-form `unobservableReason` is for logs and tests only and must
 * never reach analytics — a sentence is unbounded cardinality and can carry whatever a future edit
 * puts in it.
 */
export type MeasurementReasonCode =
    | 'timing_unavailable'
    | 'no_scope_declared'
    | 'no_entries_recorded'
    | 'scope_matched_nothing'
    | 'sizes_opaque'
    | 'requests_outside_scope'
    // #1421 P1 — coverage could not be PROVEN, as distinct from being disproven. On a shared timeline
    // the absence of foreign traffic is not observable, so completeness must be established by
    // matching the assets the candidate declares.
    | 'component_shortfall'
    | 'coverage_unprovable';

export interface AcquisitionNetworkObservation {
    /** How much of the acquisition these numbers cover. Never inferred by the consumer. */
    completeness: MeasurementCompleteness;
    /** Bounded code for why, when the measurement is not `complete`. */
    reasonCode: MeasurementReasonCode | null;
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
    completeness: 'unobservable', reasonCode: 'timing_unavailable',
    assetCount: null, networkBytes: null, downloadMs: null, networkUsed: null, outOfScopeCount: null,
    unobservableReason: 'Resource Timing is unavailable in this environment',
};

type TimingSource = Pick<Performance, 'getEntriesByType'> | undefined;

/**
 * #1421 P1 — WHOSE TIMELINE IS THIS, AND WHAT SHOULD IT CONTAIN?
 *
 * `outOfScopeCount` was read as "part of this download went unmeasured". That inference is only
 * available when the timeline belongs to the acquisition ALONE. A dedicated worker's
 * `self.performance` does: it records the worker's own fetches and nothing else, so an unmatched entry
 * there really is an unexplained request inside the download.
 *
 * The MAIN-WINDOW timeline records the whole page. During a main-thread acquisition — Moonshine's
 * ~147 MB across seven components is seconds long — concurrent auth, history, analytics, image and
 * chunk requests are not merely possible, they are certain. Subtracting only the model-prefix matches
 * therefore labelled ordinary application traffic as unmeasured download, and ANY such request forced
 * a fully observed load to `partial` or `scope_matched_nothing`. Every Moonshine measurement would have
 * read `partial`, and completeness that is always `partial` cannot support a candidate comparison —
 * the harness would have degraded the very model it was measuring.
 *
 * So the two cases are separated rather than blended:
 *
 *   `exclusive` — the timeline is the acquisition's. An unmatched entry is evidence, and absence of
 *                 unmatched entries is evidence of full coverage. Unchanged behaviour.
 *
 *   `shared`    — the timeline is the page's. Unmatched entries say nothing about this download, so
 *                 they are not counted and `outOfScopeCount` is reported as null rather than as a
 *                 number that invites the same misreading. Coverage is then proven POSITIVELY: the
 *                 candidate declares how many components it fetches, and `complete` requires having
 *                 matched them.
 *
 * Positive coverage is strictly the stronger check, which is why nothing is lost. The protection
 * `outOfScopeCount` provided was "a redirected download must not look small, fast and complete" — a
 * redirect off the declared scope lowers the MATCHED count, so the component check catches exactly
 * that case, and catches it on both timelines.
 *
 * DEFAULTS TO `shared` ON PURPOSE. A caller that forgets to declare its timeline gets the conservative
 * reading, and the dangerous direction — claiming exclusivity the timeline does not have — requires
 * saying so explicitly.
 */
export interface AcquisitionTimelineScope {
    timeline: 'exclusive' | 'shared';
    /** How many components the candidate declares (`assets.componentCount`), or null if unknown. */
    expectedComponents: number | null;
}

const SHARED_TIMELINE: AcquisitionTimelineScope = { timeline: 'shared', expectedComponents: null };

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
    scope: AcquisitionTimelineScope = SHARED_TIMELINE,
): AcquisitionNetworkObservation {
    if (!perf || typeof perf.getEntriesByType !== 'function') return UNOBSERVED;
    if (prefixes.length === 0) {
        return {
            ...UNOBSERVED, reasonCode: 'no_scope_declared',
            unobservableReason: 'no acquisition scope is known for this candidate',
        };
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
    /*
     * COUNTED ONLY WHERE IT MEANS SOMETHING. On a shared timeline the unmatched entries are the page's
     * own traffic, so the subtraction below would be a count of unrelated requests. Null, not zero:
     * zero would assert "nothing fell outside the scope", which is precisely the claim a shared
     * timeline cannot support.
     */
    const exclusive = scope.timeline === 'exclusive';
    const outOfScopeCount = exclusive ? inWindow.length - matched.length : null;

    if (matched.length === 0) {
        if (inWindow.length > 0) {
            // Requests HAPPENED and none matched. Reporting zero assets here would describe a load that
            // fetched nothing, when in fact the scope stopped matching what the loader asked for —
            // a redirect to another host, or a request shape this scope does not describe.
            // Every measurement field stays null: the out-of-scope COUNT is retained, because knowing
            // that requests happened is exactly what tells an operator the scope stopped matching.
            return {
                completeness: 'unobservable', reasonCode: 'scope_matched_nothing',
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
            completeness: 'unobservable', reasonCode: 'no_entries_recorded',
            assetCount: null, networkBytes: null, downloadMs: null, networkUsed: null, outOfScopeCount,
            unobservableReason: 'no matching resource entries were recorded for this acquisition window',
        };
    }

    const sized = matched.filter((e) => typeof e.transferSize === 'number' && (e.transferSize > 0 || e.encodedBodySize > 0));
    const anyOpaque = matched.some((e) => e.transferSize === 0 && e.encodedBodySize === 0);
    const transferred = sized.reduce((sum, e) => sum + (e.transferSize ?? 0), 0);

    const firstStart = Math.min(...matched.map((e) => e.startTime));
    const lastEnd = Math.max(...matched.map((e) => e.responseEnd || e.startTime + e.duration));

    // A non-zero transferSize is proof of the wire. A zero transferSize with a real body is proof of the
    // cache. All-opaque is proof of neither.
    const provenNetwork = sized.some((e) => (e.transferSize ?? 0) > 0);
    const provenCache = sized.length > 0 && sized.every((e) => (e.transferSize ?? 0) === 0);

    // COMPLETENESS IS DECIDED HERE, not by whoever reads the numbers. A measurement is complete only
    // when nothing in the window fell outside the scope AND every matched response reported its size.
    // Anything else is real data covering an unknown fraction of the download.
    const sizesOpaque = sized.length === 0 || anyOpaque;
    /*
     * COVERAGE IS ESTABLISHED DIFFERENTLY ON EACH TIMELINE.
     *
     * `exclusive`: nothing unmatched in the window AND every matched response sized. Unchanged.
     *
     * `shared`: absence of foreign traffic is unobservable, so coverage is proven positively — the
     * candidate declares its component count and we must have matched it. Without a declared count
     * there is no way to establish coverage at all, and the honest answer is `partial`, never
     * `complete`. That is the fail-closed direction: an undeclared candidate cannot qualify by
     * omission.
     */
    const componentsKnown = scope.expectedComponents !== null;
    const componentsProven = componentsKnown && matched.length >= (scope.expectedComponents as number);
    /*
     * THE COMPONENT CHECK APPLIES ON BOTH TIMELINES.
     *
     * An exclusive timeline with nothing unmatched is not proof of full coverage on its own: assets the
     * loader never requested at all leave no entry to be unmatched, so `outOfScopeCount === 0` and a
     * three-of-seven load would have read `complete`. The declared count is the only thing that
     * distinguishes "everything was fetched" from "nothing unexpected was fetched".
     *
     * Where the count is unknown, an exclusive timeline still has its own evidence and keeps its
     * previous behaviour; a shared timeline has none and cannot qualify.
     */
    const covered = exclusive
        ? outOfScopeCount === 0 && (!componentsKnown || componentsProven)
        : componentsProven;
    const completeness: MeasurementCompleteness = covered && !sizesOpaque ? 'complete' : 'partial';

    // `false` IS A CLAIM ABOUT EVERY REQUEST, so only a COMPLETE observation may make it.
    //
    // Proof of the wire is local — one transferred byte anywhere proves the network was used, whatever
    // else went unobserved — so `true` survives a partial measurement. Proof of the CACHE is not local:
    // it means "nothing crossed the wire", and requests that fell outside the scope, or hid their size,
    // could each have been a download. Reporting `false` there would let a partly-redirected acquisition
    // be counted as a cache hit, which is the most flattering possible reading of an unknown.
    const networkUsed = provenNetwork
        ? true
        : (completeness === 'complete' && provenCache ? false : null);
    /*
     * THE REASON NAMES WHICH CHECK FAILED, not merely that one did. Coverage is reported ahead of
     * opaque sizes because it is the stronger defect: unmeasured assets mean the numbers describe an
     * unknown fraction, whereas opaque sizes mean a known set was fetched with bytes withheld.
     */
    const coverageReason: MeasurementReasonCode | null = covered
        ? null
        // Unmatched requests first where they are evidence: an unexplained request inside the download
        // is a stronger statement than a count that fell short, and it is the more actionable one.
        : (exclusive && outOfScopeCount !== 0) ? 'requests_outside_scope'
            : componentsKnown ? 'component_shortfall' : 'coverage_unprovable';
    const reasonCode: MeasurementReasonCode | null = completeness === 'complete'
        ? null
        : (coverageReason ?? 'sizes_opaque');

    return {
        completeness,
        reasonCode,
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
