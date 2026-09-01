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
  if (probe.observedCandidate === null) problems.push('no engine has published an identity yet');
  if (expectedCandidate && probe.observedCandidate !== expectedCandidate) {
    problems.push(`observed ${probe.observedCandidate} != requested ${expectedCandidate}`);
  }
  if (!probe.identityMatches) problems.push('requested and observed identity disagree');
  if (probe.modelStatus !== 'ready') problems.push(`model status is ${probe.modelStatus}`);
  // THE TERMINAL PRE-RECORDING STATE, not merely a ready-looking model. `modelStatus` says the weights
  // are in place; it says nothing about whether the controller has finished settling. A page probed
  // during INITIATING or ENGINE_INITIALIZING can report a ready model while the mic control is not yet
  // live, and a take started there loses its opening audio -- which reads afterwards as the MODEL
  // clipping the start of the sentence. That would be scored against the arm, and it is exactly the
  // kind of harness artefact this comparison cannot afford.
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

/** Origin + path only. Query strings and fragments carry tokens; bodies and headers carry content. */
function safeRequestForEvidence(request, category) {
  let origin = null;
  let pathname = null;
  try {
    const u = new URL(request.url);
    origin = u.origin;
    pathname = u.pathname;
  } catch { /* an unparseable URL is reported as such, never echoed */ }
  return {
    origin,
    pathname,
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
export function auditEgress(requests, appOrigin, pinnedAssetOrigins = []) {
  const allowedAssets = new Set(
    (pinnedAssetOrigins ?? []).map((o) => { try { return new URL(o).origin; } catch { return o; } }),
  );
  let appO = null;
  try { appO = new URL(appOrigin).origin; } catch { /* handled below */ }

  return (requests ?? []).flatMap((r) => {
    let origin;
    try { origin = new URL(r.url).origin; } catch {
      // An unparseable target cannot be shown to be safe, so it is not treated as safe.
      return [safeRequestForEvidence(r, 'unparseable_target')];
    }
    const hasBody = Boolean(r.hasPostData);
    const method = (r.method || '').toUpperCase();
    let host = '';
    try { host = new URL(r.url).hostname; } catch { /* already handled */ }

    // Known cloud STT: suspect even without an observed body.
    if (KNOWN_CLOUD_STT.some((rx) => rx.test(host))) {
      return [safeRequestForEvidence(r, 'known_cloud_stt')];
    }
    // The app's own origin. Whether the app itself does the right thing with audio is a different
    // question, proven elsewhere; this audit is about bytes leaving for a third party.
    if (appO && origin === appO) return [];
    // Pinned model assets, fetched read-only. A POST to an asset host is NOT an asset fetch.
    if (allowedAssets.has(origin) && SAFE_ASSET_METHODS.has(method) && !hasBody) return [];
    // Everything else off-origin with a body — regardless of hostname. This is the case the blocklist
    // could not see.
    if (hasBody) return [safeRequestForEvidence(r, 'off_origin_body')];
    return [];
  });
}
