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

export const EXPECTED_TELEMETRY_VENDORS = Object.freeze([
  { match: /(^|\.)sentry\.io$/i, name: 'sentry' },
  { match: /(^|\.)posthog\.com$/i, name: 'posthog' },
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

export function routeCategoryFor(pathname) {
    return categoriseRoute(pathname);
}

export function routeDigestFor(pathname) {
    return routeDigest(pathname);
}

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

    // EXPECTED TELEMETRY VENDORS ARE RECOGNISED HERE TOO. They were not, so Sentry and PostHog -- whose
    // asset GETs and error POSTs the app makes on every page -- produced `off_origin_unrecognised` and
    // held every valid take. Recognised is not the same as trusted: this only says the destination is
    // accounted for. Whether AUDIO went there is the payload audit's question, and it blocks audio to
    // these hosts exactly as it does anywhere else.
    if (EXPECTED_TELEMETRY_VENDORS.some((v) => v.match.test(url.hostname))) {
      // RECOGNISED BY ORIGIN, BUT A QUERY IS NOT COVERED BY THAT. A query-bearing GET carries its data
      // in the URL, so there is no body for the payload audit to classify -- being on the vendor list
      // would have laundered it through on the destination alone. That is precisely the hole a vendor
      // allowlist creates, arriving through the one exception we granted.
      if (url.search !== '') return [safeRequestForEvidence(r, 'expected_vendor_query')];
      return [safeRequestForEvidence(r, 'expected_vendor')];
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
    // SENT, NOT RECEIVED. Both directions incremented one counter, so binary arriving FROM a server
    // was scored identically to audio leaving for one — and inbound bytes cannot establish egress. Only
    // outbound binary can. Frame counts and sizes are recorded; no payload is ever read.
    const sentBinary = Number(s.sentBinaryFrames ?? 0);
    const receivedBinary = Number(s.receivedBinaryFrames ?? 0);
    return {
      origin,
      frames: Number(s.frameCount ?? 0),
      sentBinaryFrames: sentBinary,
      receivedBinaryFrames: receivedBinary,
      bytes: Number(s.byteCount ?? 0),
      carriedBinary: sentBinary > 0,
      category: sentBinary > 0 ? 'websocket_binary_sent'
        : receivedBinary > 0 ? 'websocket_binary_received' : 'websocket_opened',
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
/**
 * WHY a take is held, kept distinct.
 *
 * A privacy hold and a proof hold mean opposite things to the operator. `privacy` says audio may have
 * left the device — the take is evidence of a product defect and the run must stop. `proof` says we did
 * not observe enough to make any claim — the take is unusable but says nothing about the product, and
 * re-running it is the right response. Collapsing them into one list invites a run of proof holds to be
 * read as a privacy problem, or worse, a privacy hold to be dismissed as flaky instrumentation.
 *
 * Expected non-audio transcript, text and telemetry traffic appears in neither: it is documented product
 * behaviour, not a violation.
 */
/**
 * Request-level categories that BLOCK.
 *
 * Deliberately excludes `same_origin_body` and `unrecognised_text_destination`: whether those are
 * acceptable depends on what was in them, which is the payload audit's question, and it answers it.
 * What remains are destinations and shapes no content inspection can excuse.
 */
export const BLOCKING_EGRESS_CATEGORIES = Object.freeze([
  'unknown_same_origin', 'same_origin_query', 'off_origin_unrecognised', 'unparseable_target',
  'known_cloud_stt',
  // A vendor's recognised ORIGIN does not account for data in the query string.
  'expected_vendor_query',
]);

export const PRIVACY_HOLD_CATEGORIES = Object.freeze([
  'audio_egress', 'same_origin_audio', 'unexplained_binary', 'worker_binary',
  'same_origin_binary_during_recording',
]);

export function receiptVerdict({
  probe, expectedCandidate, expectedRelease, payloads, sockets, phases, appOrigin,
  workerInstrumentation, egress, recordingStartedAt = null,
}) {
  const problems = [];
  // Privacy: audio may have left the device. Proof: we did not observe enough to say anything.
  const privacyProblems = [];
  const proofProblems = [];
  const review = [];
  const r = readiness(probe, expectedCandidate, expectedRelease);
  problems.push(...r.problems);
  proofProblems.push(...r.problems);

  // JUDGED BY PAYLOAD, NOT BY DESTINATION. Every off-origin body used to be a HOLD, so ordinary Sentry
  // and PostHog traffic held a take on a page that had never recorded — no audio could have left. A
  // check that holds every valid take gets "fixed" by allowlisting vendors, and a vendor allowlist
  // authorises whatever that vendor is sent, audio included. The promise is about audio, and the
  // product documents that transcript TEXT is persisted server-side, so text is not a violation.
  const payloadFindings = auditPayloads(payloads ?? [], { appOrigin, recordingStartedAt });
  const blocking = payloadFindings.filter((f) => BLOCKING_PAYLOAD_CATEGORIES.includes(f.category));
  const advisory = payloadFindings.filter((f) => !BLOCKING_PAYLOAD_CATEGORIES.includes(f.category));
  for (const f of blocking) {
    const message = `${f.category}: ${f.kind}${f.mime ? ` (${f.mime})` : ''} via ${f.transport} to ${f.origin}`;
    problems.push(message);
    (PRIVACY_HOLD_CATEGORIES.includes(f.category) ? privacyProblems : proofProblems).push(message);
  }
  review.push(...advisory);

  if (payloads === undefined || payloads === null) {
    // NOT observing payloads is different from observing none, and only one of the two is evidence.
    problems.push('payload observation was not enabled; zero audio egress cannot be claimed');
  }

  // WORKER INSTRUMENTATION FAILS CLOSED.
  //
  // "Workers attached" was being read as "workers watched". Attaching is CDP's doing; installing the
  // tripwire and reading it back are ours, and either can fail silently — an injected script's
  // exception goes nowhere, and a terminated session's read throws into a catch. A run where every
  // install failed looked identical to a run where nothing was sent, and the second is the claim being
  // made. Each outcome is therefore counted separately, and anything short of "instrumented and read"
  // holds the take.
  const w = workerInstrumentation ?? null;
  if (w === null) {
    problems.push('worker instrumentation was not reported; zero worker audio egress cannot be claimed');
  } else {
    if (w.installFailures > 0) problems.push(`${w.installFailures} worker tripwire install(s) failed`);
    if (w.drainFailures > 0) problems.push(`${w.drainFailures} worker(s) could not be read back`);

    // ZERO INSTRUMENTED WORKERS IS NOT A CLEAN RUN. The guard read `attached > 0 && installed === 0`, so
    // a run that attached NOTHING — auto-attach never armed, the worker starting before the observer, a
    // browser that reported no worker targets at all — sailed past with zero problems. For this product
    // that is the worst possible pass: Private STT decodes in a Web Worker, so a take with no
    // instrumented worker means the context holding PCM was never watched, and "no findings" is a
    // statement about where we looked rather than about what happened.
    if (w.installed === 0) {
      problems.push(w.attached > 0
        ? `${w.attached} worker(s) attached but none were instrumented`
        : 'no worker was instrumented; the context that holds PCM was not observed');
    }
    if (w.installed > 0 && w.drained === 0) {
      problems.push(`${w.installed} worker(s) instrumented but none were read`);
    }
    // The main document's tripwire is the other half. Its absence was never checked at all, so a run
    // where the page-level install silently failed reported no payloads and read as clean.
    // NETWORK OBSERVATION PER WORKER. Enabling it on the root session says nothing about the workers,
    // and a worker whose requests are unobserved can issue a query-bearing GET -- data in the URL, no
    // body for the payload audit to classify -- that no audit ever sees. "We attached" is not "we are
    // watching".
    if (w.networkFailures > 0) {
      problems.push(`${w.networkFailures} worker(s) could not have network observation enabled`);
    }
    if (w.attached > 0 && (w.networkEnabled ?? 0) === 0) {
      problems.push(`${w.attached} worker(s) attached with no network observation; their requests are unaudited`);
    }
    if (w.attached > 0 && w.networkEnabled !== undefined && w.networkEnabled < w.installed) {
      problems.push('fewer workers have network observation than have tripwires; some requests are unaudited');
    }

    // A STABLE, COMPLETE SNAPSHOT. Individual counters could each look fine while the set was still
    // being assembled: two workers attached, one enabled, one installed, zero failures purely because
    // the second had not finished its setup yet. Requiring the counts to AGREE is what makes the
    // snapshot a statement about the run rather than about when we happened to look.
    if (w.setupPending) {
      problems.push('worker setup was still pending when the receipt was written; observation is incomplete');
    }
    if (w.attached > 0 && !(w.attached === (w.networkEnabled ?? 0) && w.attached === w.installed)) {
      problems.push(
        `worker setup is uneven (attached ${w.attached}, network ${w.networkEnabled ?? 0}, `
        + `instrumented ${w.installed}); some contexts were not fully observed`,
      );
    }
    if (w.installed > 0 && w.drained !== w.installed) {
      problems.push(`${w.installed - w.drained} instrumented worker(s) had no final readback`);
    }
    if (w.postSealCallbacks) {
      // Evidence that arrived after the verdict cannot have informed it.
      problems.push(`${w.postSealCallbacks} worker callback(s) fired after the receipt was sealed`);
    }

    if (w.mainTripwireInstalled !== true) {
      problems.push('the main-document tripwire was not confirmed installed; payload observation is unproven');
    }
  }

  // Sockets are judged the same way. A socket carrying JSON is a transport choice; a socket carrying
  // binary frames during a recording is the channel best suited to streaming audio out.
  const socketFindings = auditSockets(sockets);
  for (const s of socketFindings) {
    if (s.carriedBinary) {
      const message = `websocket sent ${s.sentBinaryFrames} binary frame(s) to ${s.origin}`;
      problems.push(message);
      privacyProblems.push(message);
    }
    else review.push(s);
  }
  if (sockets === undefined || sockets === null) {
    problems.push('socket observation was not enabled; zero streamed egress cannot be claimed');
  }

  // THE REQUEST-LEVEL FINDINGS REACH THE VERDICT. They were computed in tests and never wired to the
  // executable receipt, so exact pinned-asset matching, unknown same-origin paths and unrecognised
  // off-origin channels had no effect on whether a take passed. Audio egress is the promise; this is
  // "anything went somewhere we cannot account for", and a take carrying either is not clean.
  // THE TWO AUDITS ANSWER DIFFERENT QUESTIONS, and wiring the request audit in without reconciling them
  // made it overrule the one that can actually see content. `auditEgress` knows only WHERE a request
  // went; it necessarily flags the transcript JSON we deliberately persist to `/api/sessions`, and every
  // Sentry/PostHog POST, as bodies going somewhere. The payload audit knows WHAT was sent and correctly
  // accepts all of those.
  //
  // So the request audit contributes only what payload classification cannot see: a destination or a
  // shape we cannot account for. Anything whose acceptability depends on the CONTENT is advisory here
  // and decided there. Blocking on it reintroduced exactly the false HOLD the payload work removed --
  // and a check that holds every valid take is one that gets switched off.
  for (const finding of egress ?? []) {
    const message = `${finding.category} to ${finding.origin ?? 'an unparseable target'}`;
    if (BLOCKING_EGRESS_CATEGORIES.includes(finding.category)) {
      problems.push(message);
      proofProblems.push(message);
    } else {
      review.push(finding);
    }
  }
  if (egress === undefined || egress === null) {
    problems.push('request-level egress was not audited; unaccounted traffic cannot be ruled out');
  }

  // TERMINAL IS REQUIRED, AND A TIMEOUT IS NOT IT. Observation continues past `sessionPersisted` until
  // the controller settles, with a grace period so a stuck teardown cannot hold the run open forever --
  // but the grace period expiring was recorded as a phase and then never checked, so a take whose
  // teardown never completed still PASSED. Teardown is where a "just upload the audio too" step would
  // live, so an unobserved one is missing evidence, not an absent finding.
  //
  // A timeout is a PROOF hold: we did not see enough. It is not a privacy hold -- nothing observed says
  // audio left -- and conflating the two would either raise a false alarm or teach the operator to
  // discount real ones.
  const required = ['pre-record', 'recording', 'stop-save', 'terminal'];
  for (const phase of required) {
    if (!(phases ?? []).includes(phase)) {
      const message = `lifecycle phase "${phase}" was never observed`;
      problems.push(message);
      proofProblems.push(message);
    }
  }
  if ((phases ?? []).includes('terminal-timeout')) {
    const message = 'teardown never reached a terminal state before the grace period expired';
    problems.push(message);
    proofProblems.push(message);
  }

  return {
    verdict: problems.length === 0 ? 'PASS' : 'HOLD',
    // The operator needs to know which kind of hold this is before deciding what to do about it.
    holdKind: privacyProblems.length > 0 ? 'privacy'
      : problems.length > 0 ? 'proof' : null,
    problems,
    privacyProblems,
    proofProblems: proofProblems.concat(problems.filter((p) => !privacyProblems.includes(p) && !proofProblems.includes(p))),
    // Reported, but not blocking: a human should see these without them holding a valid take.
    review,
    payloads: payloadFindings,
    sockets: socketFindings,
    egress: egress ?? [],
    workerInstrumentation: w,
  };
}

/**
 * Telemetry vendors whose ordinary traffic is EXPECTED — and expected to be TEXT.
 *
 * Categorised explicitly rather than allowlisted. A vendor allowlist authorises whatever that vendor is
 * sent, which would let audio out through the one destination nobody looks at twice. Being on this list
 * makes a JSON error report unremarkable; it does nothing for a Blob.
 */

/** Payload kinds that mean captured audio is leaving the device. */
const AUDIO_KINDS = new Set(['audio']);
/** Kinds that are not audio on their face but cannot be shown to be text either. */
const OPAQUE_KINDS = new Set(['binary', 'blob', 'unknown', 'opaque_stream']);

/**
 * Judge SENT PAYLOADS against the actual promise: audio never leaves the browser.
 *
 * The promise is deliberately narrower than "nothing leaves". Final transcript TEXT is persisted
 * server-side for the two newest transcript-bearing sessions — documented, and not a violation. Treating
 * it as one produced a check that held every valid take, and a check that always holds gets fixed by
 * whitelisting vendors, which is how audio would eventually pass.
 *
 * @param records tripwire records: transport, url, method, kind, mime, bytes, runtimeState
 * @param appOrigin the app's own origin
 */
export function auditPayloads(records, { appOrigin, recordingStartedAt = null } = {}) {
  let appO = null;
  try { appO = new URL(appOrigin).origin; } catch { /* everything then reads as off-origin */ }

  return (records ?? []).flatMap((r) => {
    let url;
    try { url = new URL(r.url); } catch {
      return [{
        transport: r.transport, origin: null, route: null, kind: r.kind, bytes: r.bytes,
        context: r.context ?? 'main', category: 'unparseable_target',
      }];
    }
    const sameOrigin = appO !== null && url.origin === appO;
    const vendor = EXPECTED_TELEMETRY_VENDORS.find((v) => v.match.test(url.hostname));
    // AUDIO OUTLIVES THE `RECORDING` STATE, BUT IT DOES NOT PRECEDE IT.
    //
    // Two errors, in opposite directions. The first was testing `runtimeState === 'RECORDING'` only, so
    // opaque bytes sent during STOPPING or after the state returned to READY read as ordinary traffic --
    // and stop/save is exactly when a take's audio would be uploaded.
    //
    // The second was fixing that with a single run-wide `recordingBegun` flag, computed at the end and
    // applied to EVERY retained record. An opaque startup request, sent before any recording when no
    // captured audio existed, was then judged as during-take and produced a false PRIVACY hold -- the
    // most damaging kind to get wrong, since it accuses the product of leaking audio it never had.
    //
    // Each record now carries its own timestamp and is placed relative to the moment recording actually
    // began. A record with no timestamp falls back to the state it reported, which is conservative in
    // the safe direction: audio kinds hold regardless of this window, so only same-origin opaque binary
    // depends on it.
    const during = r.runtimeState === 'RECORDING'
      || r.runtimeState === 'STOPPING'
      || (recordingStartedAt !== null && typeof r.t === 'number' && r.t >= recordingStartedAt);
    const finding = (category) => ([{
      transport: r.transport,
      origin: url.origin,
      route: routeCategoryFor(url.pathname),
      routeHash: routeDigestFor(url.pathname),
      kind: r.kind,
      mime: r.mime ?? null,
      bytes: typeof r.bytes === 'number' ? r.bytes : null,
      duringRecording: during,
      // WHICH CONTEXT SENT IT. Dropping this made a worker finding indistinguishable from a main-document
      // one, and for this product the difference is the whole point: the STT worker is where PCM lives.
      context: r.context ?? 'main',
      category,
    }]);

    // AUDIO ANYWHERE IS THE VIOLATION, including to the app's own origin: a same-origin endpoint that
    // forwards audio is exactly the shape a well-meaning "upload for better accuracy" feature takes.
    if (AUDIO_KINDS.has(r.kind)) return finding(sameOrigin ? 'same_origin_audio' : 'audio_egress');

    // Opaque bytes cannot be shown to be text. Off-origin they are a finding outright; to the app's own
    // origin they are a finding only while recording, when captured audio exists to send.
    if (OPAQUE_KINDS.has(r.kind)) {
      // A WORKER'S OPAQUE BYTES HOLD REGARDLESS OF DESTINATION. Worker records carry
      // `runtimeState: null` -- a worker has no document to read it from -- so the
      // `same_origin_binary_during_recording` rule could never fire for them, and same-origin opaque
      // binary from the STT worker walked straight through the one rule meant to catch it. The worker
      // that holds PCM has no innocent reason to send opaque bytes anywhere during a bounded proof.
      if (r.context === 'worker') return finding('worker_binary');
      if (!sameOrigin) return finding('unexplained_binary');
      if (during) return finding('same_origin_binary_during_recording');
      return [];
    }

    // Text-shaped payloads. Expected vendors and the app's own origin are ordinary product behaviour --
    // including transcript persistence, which the product documents rather than hides.
    if (r.kind === 'text' || r.kind === 'json' || r.kind === 'form' || r.kind === 'empty') {
      if (sameOrigin || vendor) return [];
      // Text to an unrecognised third party is not audio egress, but it is worth a human glance.
      return finding('unrecognised_text_destination');
    }

    return finding('unclassified_payload');
  });
}

/** Only audio-bearing findings block a take; the rest are reported for review. */
export const BLOCKING_PAYLOAD_CATEGORIES = Object.freeze([
  'audio_egress', 'same_origin_audio', 'unexplained_binary', 'worker_binary',
  'same_origin_binary_during_recording', 'unparseable_target',
]);
