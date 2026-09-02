import { createHash } from 'node:crypto';
import { expectedAssetUrls, expectedSameOriginAssetPaths } from './pinAuthority.mjs';
/**
 * #1390 — the CDP OBSERVER for the three-model human comparison.
 *
 * SEPARATE FROM THE LAUNCHER on purpose. The launcher owns a browser the operator drives by hand; the
 * observer only reads. Keeping them apart means a bug in evidence collection can never change what the
 * operator experienced, and the observer can be attached to an already-running session.
 *
 * WHAT IT MUST NEVER DO: touch the recording, the model, or the page state. It samples and records.
 *
 * OBSERVED, NEVER REQUESTED. Every identity field here comes from what the ENGINE published
 * (`__SS_ACTIVE_CANDIDATE__().observed`, `__PRIVATE_STT_RUNTIME_DEBUG__.provider`), never from the
 * config or the switch request. A wrapper that recorded the requested model would label a v2 recording
 * as Moonshine the first time a switch silently failed — which is the exact failure the human test
 * exists to detect.
 */

/** Read identity + lifecycle from a page, tolerating surfaces that are not present yet. */
export const IDENTITY_PROBE = `(() => {
  const w = window;
  const root = document.documentElement;
  const active = typeof w.__SS_ACTIVE_CANDIDATE__ === 'function' ? w.__SS_ACTIVE_CANDIDATE__() : null;
  const dbg = w.__PRIVATE_STT_RUNTIME_DEBUG__ || null;
  return {
    capturedAt: new Date().toISOString(),
    release: w.__APP_RELEASE__ ?? null,
    // requested vs observed are reported SEPARATELY and never merged.
    requestedCandidate: active ? active.requested : null,
    observedCandidate: active ? active.observed : null,
    identityMatches: active ? active.matches === true : false,
    selectionSource: active ? active.source : null,
    observedProvider: dbg ? dbg.provider : null,
    observedVariant: dbg ? dbg.v4Variant : null,
    runtimeState: root.getAttribute('data-runtime-state'),
    modelStatus: root.getAttribute('data-model-status'),
    sessionPersisted: root.getAttribute('data-session-persisted'),
  };
})()`;

/**
 * Is this page ready for the operator to record a scored take?
 *
 * READY IS NOT "the app looks loaded". It requires the engine to have published an identity that
 * MATCHES what was asked for. A page that is visually ready while `observed` is null would produce a
 * recording nobody can attribute afterwards, and the operator cannot see that from the UI.
 */
export const TERMINAL_PRE_RECORDING_STATE = 'READY';

export function readiness(probe, expectedCandidate, expectedRelease) {
  const problems = [];
  if (!probe) return { ready: false, problems: ['no probe result'] };
  if (expectedRelease && probe.release !== expectedRelease) {
    problems.push(`release ${probe.release} != expected ${expectedRelease}`);
  }

  // THE THREE-WAY EQUALITY, RECOMPUTED HERE.
  //
  // This trusted `identityMatches` as an independent premise. That boolean is computed by the PAGE, from
  // the same values it also reports — so a publisher that computed it wrongly, or a page serving a stale
  // build, could assert agreement that the values themselves contradict, and the receipt would carry the
  // page's own claim about itself as though it were an observation. The wrapper exists precisely because
  // the page cannot be its own witness.
  //
  // `expected` is the third term and is NOT optional in a scored take: an arm the operator did not ask
  // for is unusable even when requested and observed agree with each other.
  if (!expectedCandidate) {
    problems.push('no expected candidate supplied; a take that nothing was asked of cannot be scored');
  }
  if (probe.observedCandidate === null) problems.push('no engine has published an identity yet');
  if (probe.requestedCandidate === null || probe.requestedCandidate === undefined) {
    problems.push('the page published no requested candidate');
  }
  if (probe.requestedCandidate !== probe.observedCandidate) {
    problems.push(`requested ${probe.requestedCandidate} != observed ${probe.observedCandidate}`);
  }
  if (expectedCandidate && probe.observedCandidate !== expectedCandidate) {
    problems.push(`observed ${probe.observedCandidate} != expected ${expectedCandidate}`);
  }
  // A publisher boolean that CONTRADICTS the recomputation is itself a defect worth reporting: the page
  // is wrong about something, and which side is wrong is not knowable from here.
  const recomputed = probe.requestedCandidate !== null
    && probe.requestedCandidate === probe.observedCandidate
    && probe.observedCandidate === expectedCandidate;
  if (probe.identityMatches === true && !recomputed) {
    problems.push('the page reports identityMatches=true, which the published values contradict');
  }
  if (probe.identityMatches === false && recomputed) {
    problems.push('the page reports identityMatches=false, which the published values contradict');
  }

  if (probe.modelStatus !== 'ready') problems.push(`model status is ${probe.modelStatus}`);
  // THE TERMINAL PRE-RECORDING STATE, not merely a ready-looking model. `modelStatus` says the weights
  // are in place; it says nothing about whether the controller has finished settling. A page probed
  // during INITIATING or ENGINE_INITIALIZING can report a ready model while the mic control is not yet
  // live, and a take started there loses its opening audio -- which reads afterwards as the MODEL
  // clipping the start of the sentence.
  //
  // RECORDING and STOPPING are deliberately not accepted: they are healthy states, but a take must
  // start from a session that has not already begun.
  if (probe.runtimeState !== TERMINAL_PRE_RECORDING_STATE) {
    problems.push(`runtime state is ${probe.runtimeState}, not ${TERMINAL_PRE_RECORDING_STATE}`);
  }
  return { ready: problems.length === 0, problems };
}

/**
 * Classify a captured take. HOLD is a first-class outcome, not a soft fail.
 *
 * A take whose identity cannot be established is neither a pass nor a failure of the MODEL — it is
 * evidence that cannot be used, and recording it as either would corrupt the comparison. HOLD says
 * "run this arm again", which is the only honest answer.
 */
export function classifyTake({ probe, saved, errors }) {
  if (!probe || probe.observedCandidate === null || !probe.identityMatches) {
    return { verdict: 'HOLD', reason: 'model identity could not be established for this take' };
  }
  if (errors && errors.length > 0) return { verdict: 'FAIL', reason: `runtime errors: ${errors.length}` };
  if (!saved) return { verdict: 'FAIL', reason: 'the take did not reach a durable saved state' };
  return { verdict: 'PASS', reason: '' };
}

/**
 * Requests that would mean recorded audio left the device.
 *
 * THIS WAS A BLOCKLIST, WHICH IS THE WRONG SHAPE FOR THE QUESTION. It matched four known cloud-STT
 * domains, so it could only ever catch vendors we had already thought of. Audio posted to any host not
 * on that list — a new vendor, a proxy, a misconfigured endpoint, an attacker-controlled origin —
 * passed the audit clean and the run would have been recorded as proving zero egress.
 *
 * The privacy claim is the product, so this fails CLOSED instead: everything off-origin carrying a body
 * during a recording is suspect regardless of who it is addressed to, and only two categories are
 * allowed — the app's own origin, and GET/HEAD fetches of the pinned model assets the run declares in
 * advance. Being unable to name the vendor is not a reason to allow the request; it is the case the
 * blocklist was blind to.
 */

/**
 * Endpoints suspect even WITHOUT an observed body. Transport metadata is not always complete — a body
 * streamed over a WebSocket or sent in a redirected follow-up may not surface as `hasPostData` — and
 * for these hosts there is no innocent reason for the app to be talking to them at all.
 *
 * This list only ever ADDS suspicion. It is not the mechanism that catches unknown hosts.
 */
export const KNOWN_CLOUD_STT = Object.freeze([
  /(^|\.)assemblyai\.com$/i,
  /(^|\.)deepgram\.com$/i,
  /(^|\.)googleapis\.com$/i,
  /(^|\.)openai\.com$/i,
]);

const SAFE_ASSET_METHODS = new Set(['GET', 'HEAD']);

/**
 * Same-origin paths the app is expected to request. Deliberately a short, explicit list: anything not on
 * it is reported rather than assumed benign, which is what "fail closed on unknown same-origin" means.
 */
/**
 * The EXACT same-origin operations a bounded run performs, by journey phase.
 *
 * This was a prefix list containing `/api/`, which permitted every endpoint the app serves. A queryless
 * GET to `/api/log/transcript-words` passed as ordinary traffic purely because of where it started — and
 * a path is a perfectly good place to put words. Prefixes are how an allowlist stops being one.
 *
 * Exact strings only. A new operation has to be added here deliberately, which is the point: the run is
 * bounded, so its traffic is enumerable.
 */
export const EXACT_JOURNEY_OPERATIONS = Object.freeze({
    persist: Object.freeze(['/api/sessions', '/api/sessions/complete']),
    read: Object.freeze(['/api/sessions/list', '/api/analytics/summary']),
    issueReport: Object.freeze(['/api/issue-reports']),
    auth: Object.freeze(['/api/auth/session']),
    telemetry: Object.freeze(['/api/telemetry']),
});

/**
 * The app shell itself, matched EXACTLY.
 *
 * `/` was removed from the prefix list because as a prefix it matches every path. As an exact string it
 * is simply the page the operator loads, and leaving it out made every run report its own app shell as
 * suspected egress — noise that teaches the operator to skim the findings.
 */
export const EXACT_APP_SHELL = Object.freeze(['/', '/index.html']);

/** Static app paths, matched by prefix because their filenames are build-generated. */
export const DEFAULT_APP_PATHS = Object.freeze(['/assets/', '/favicon', '/index.html']);
// NOTE: '/' is deliberately NOT on this list. A '/' prefix matches every path, which would make the
// same-origin rule vacuous while reading as an allowlist — the failure mode being closed here.

const ALL_EXACT_OPERATIONS = Object.freeze(Object.values(EXACT_JOURNEY_OPERATIONS).flat());

/**
 * A BOUNDED CATEGORY, NOT A REDACTED PATH.
 *
 * The previous version replaced UUIDs, long hex and long segments and kept everything else. Heuristics
 * decide what to drop, so whatever they did not anticipate was retained verbatim — short emails,
 * usernames, search terms, a filler word in a route. Evidence is durable and shared, so "we removed the
 * shapes we thought of" is the wrong default.
 *
 * A path is reported as one of a FIXED set of categories, and anything unrecognised becomes a truncated
 * SHA-256 of the path. The digest is non-reversible and stable, so two occurrences can be compared and
 * an investigator can confirm a specific suspected path by hashing it themselves — without the receipt
 * ever carrying content.
 */
export const ROUTE_CATEGORIES = Object.freeze([
    'app-shell', 'static-asset', 'model-asset', 'session-persist', 'session-read',
    'issue-report', 'auth', 'telemetry', 'other',
]);

function categoriseRoute(pathname) {
    if (pathname === '/' || pathname === '/index.html') return 'app-shell';
    if (pathname.startsWith('/assets/')) return 'static-asset';
    if (pathname.startsWith('/models/')) return 'model-asset';
    if (EXACT_JOURNEY_OPERATIONS.persist.includes(pathname)) return 'session-persist';
    if (EXACT_JOURNEY_OPERATIONS.read.includes(pathname)) return 'session-read';
    if (EXACT_JOURNEY_OPERATIONS.issueReport.includes(pathname)) return 'issue-report';
    if (EXACT_JOURNEY_OPERATIONS.auth.includes(pathname)) return 'auth';
    if (EXACT_JOURNEY_OPERATIONS.telemetry.includes(pathname)) return 'telemetry';
    return 'other';
}

/** Non-reversible, stable, and short enough to read in a receipt. */
function routeDigest(pathname) {
    return createHash('sha256').update(pathname).digest('hex').slice(0, 12);
}

/** Origin + redacted path only. Query strings and fragments carry tokens; bodies and headers carry content. */
function safeRequestForEvidence(request, category) {
  let origin = null;
  let route = null;
  let routeHash = null;
  try {
    const u = new URL(request.url);
    origin = u.origin;
    route = categoriseRoute(u.pathname);
    routeHash = routeDigest(u.pathname);
  } catch { /* an unparseable URL is reported as such, never echoed */ }
  return {
    origin,
    // No path, redacted or otherwise. A category plus a non-reversible digest says where a request went
    // without carrying what it said.
    route,
    routeHash,
    method: (request.method || '').toUpperCase() || null,
    category,
  };
}

/**
 * Classify captured requests. Returns only the SUSPECT ones, sanitized.
 *
 * @param requests captured request metadata
 * @param appOrigin the app's own origin; same-origin traffic is handled separately
 * @param pinnedAssetOrigins origins serving the run's declared model assets. Passed in rather than
 *   hardcoded, so the allowance is scoped to the assets THIS run pinned instead of to a vendor family.
 */
/**
 * Classify captured requests. Returns only the SUSPECT ones, sanitized.
 *
 * FAIL CLOSED IN BOTH DIRECTIONS. The previous version had four holes, each of which looked like a
 * reasonable allowance and together left the audit unable to see most exfiltration:
 *
 *  - it took the allowed origins as a PARAMETER, so the operator running the check decided what counted
 *    as a legitimate model download;
 *  - it matched by ORIGIN, so every path a permitted host serves was allowed — an upload endpoint on the
 *    asset CDN was indistinguishable from a weight file;
 *  - it trusted every SAME-ORIGIN body, so audio posted to the app's own domain passed silently;
 *  - it permitted unknown off-origin BODYLESS GETs, and a GET carries a query string.
 *
 * Now: exact committed asset URLs are derived from the registry for the candidate that was OBSERVED to
 * run, same-origin traffic must match an expected path or it is reported, and anything not positively
 * recognised is reported regardless of method or body.
 *
 * @param requests captured request metadata
 * @param options.appOrigin the app's own origin
 * @param options.observedCandidate the candidate the ENGINE published — never the requested one, since
 *   the point is to audit what actually ran
 * @param options.expectedSameOriginPaths path prefixes the app is expected to call
 */
export function auditEgress(requests, options = {}) {
  const { appOrigin, observedCandidate, expectedSameOriginPaths = DEFAULT_APP_PATHS } = options;

  // An unattributable run gets an EMPTY allowance: if we cannot say which model ran, we cannot say which
  // downloads were legitimate, and guessing would let an unknown model's fetches pass as expected.
  let allowedUrls = new Set();
  let allowedSameOriginAssets = new Set();
  if (observedCandidate) {
    try {
      allowedUrls = expectedAssetUrls(observedCandidate);
      // The shipping v2 default is SELF-HOSTED: its assets are exact same-origin paths, not CDN URLs.
      // Without these the v2 arm of a three-model comparison flags every legitimate model fetch.
      allowedSameOriginAssets = expectedSameOriginAssetPaths(observedCandidate);
    } catch { allowedUrls = new Set(); allowedSameOriginAssets = new Set(); }
  }

  let appO = null;
  try { appO = new URL(appOrigin).origin; } catch { /* every request then reads as off-origin */ }

  return (requests ?? []).flatMap((r) => {
    let url;
    try { url = new URL(r.url); } catch {
      return [safeRequestForEvidence(r, 'unparseable_target')];
    }
    const method = (r.method || '').toUpperCase();
    const hasBody = Boolean(r.hasPostData);
    const readOnly = SAFE_ASSET_METHODS.has(method) && !hasBody;

    if (KNOWN_CLOUD_STT.some((rx) => rx.test(url.hostname))) {
      return [safeRequestForEvidence(r, 'known_cloud_stt')];
    }

    // AN EXACT COMMITTED ASSET, fetched read-only and carrying NOTHING extra. Comparing only
    // origin+pathname would allow `<pinned-url>?exfil=...`, which is a fine way to move data out under a
    // URL that passes the allowance — so a query or fragment disqualifies the match outright.
    const bare = `${url.origin}${url.pathname}`;
    if (allowedUrls.has(bare) && readOnly && url.search === '' && url.hash === '') return [];

    if (appO && url.origin === appO) {
      // SAME-ORIGIN IS NOT A FREE PASS. The app's own domain is where exfiltration is cheapest to hide,
      // so a request must look like something the app is expected to do. Anything else is reported for a
      // human to judge rather than assumed benign.
      // An EXACT self-hosted model asset, fetched read-only and carrying nothing extra.
      if (allowedSameOriginAssets.has(url.pathname) && readOnly && url.search === '') return [];

      // EXACT operation, or a static app prefix whose filenames the build generates. `/api/` as a
      // prefix is gone: it permitted every endpoint the app serves.
      const expected = EXACT_APP_SHELL.includes(url.pathname)
        || ALL_EXACT_OPERATIONS.includes(url.pathname)
        || expectedSameOriginPaths.some((p) => url.pathname.startsWith(p));
      // A QUERY STRING CARRIES DATA. Same-origin GETs were allowed on path alone, so
      // `/api/log?transcript=...` passed as ordinary app traffic — no body required, and the app's own
      // domain is exactly where that is least likely to be questioned.
      if (expected && url.search !== '') return [safeRequestForEvidence(r, 'same_origin_query')];
      if (expected && !hasBody) return [];
      if (expected && hasBody) return [safeRequestForEvidence(r, 'same_origin_body')];
      return [safeRequestForEvidence(r, 'unknown_same_origin')];
    }

    // Everything else off-origin, INCLUDING a bodyless GET: a query string carries data perfectly well,
    // and an unrecognised host is exactly the case the old blocklist could not see.
    return [safeRequestForEvidence(r, hasBody ? 'off_origin_body' : 'off_origin_unrecognised')];
  });
}

/**
 * Sockets, which request metadata cannot see at all.
 *
 * `auditEgress` reasons about requests. A WebSocket is ONE request at creation and then an open pipe:
 * every audio frame after the handshake is invisible to that audit, so a clean egress report proved
 * nothing about the channel most suited to streaming audio out. This is not a gap in the rules — it is a
 * gap in what was being looked at.
 *
 * The bounded run has no legitimate socket, so any socket is HOLD rather than a judgement call about its
 * contents. Frames are counted and their sizes summed; NOTHING from a payload is retained, because the
 * question is whether a channel existed, not what crossed it.
 */
export function auditSockets(sockets) {
  return (sockets ?? []).map((s) => {
    let origin = null;
    try { origin = new URL(s.url).origin; } catch { /* unparseable is still a socket */ }
    return {
      origin,
      frames: Number(s.frameCount ?? 0),
      bytes: Number(s.byteCount ?? 0),
      category: 'websocket_opened',
    };
  });
}

/**
 * The receipt verdict. HOLD is a first-class outcome, never a soft pass.
 *
 * Every input is recomputed here rather than trusted: the page's own agreement boolean is not evidence,
 * an empty egress list only counts if sockets were also observed, and a take whose identity cannot be
 * established is unusable regardless of how clean everything else looks.
 */
export function receiptVerdict({ probe, expectedCandidate, expectedRelease, egress, sockets, phases }) {
  const problems = [];
  const r = readiness(probe, expectedCandidate, expectedRelease);
  problems.push(...r.problems);

  const socketFindings = auditSockets(sockets);
  // A socket during a bounded local run has no legitimate purpose, and frames are the one channel that
  // can carry continuous audio without another request ever appearing.
  if (socketFindings.length > 0) {
    problems.push(`${socketFindings.length} websocket(s) opened during the run`);
  }
  if (sockets === undefined || sockets === null) {
    // NOT observing sockets is different from observing none, and only one of the two is evidence.
    problems.push('socket observation was not enabled; zero streamed egress cannot be claimed');
  }
  if ((egress ?? []).length > 0) problems.push(`${egress.length} suspect request(s)`);

  const required = ['pre-record', 'recording', 'stop-save'];
  for (const phase of required) {
    if (!(phases ?? []).includes(phase)) problems.push(`lifecycle phase "${phase}" was never observed`);
  }

  return {
    verdict: problems.length === 0 ? 'PASS' : 'HOLD',
    problems,
    egress: egress ?? [],
    sockets: socketFindings,
  };
}
