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
 * The privacy claim is the product, so this is asserted rather than assumed. Model/runtime asset
 * fetches are expected and allowed; anything carrying a request BODY to a non-asset host while a
 * recording is live is the thing to catch.
 */
export const AUDIO_EGRESS_SUSPECTS = Object.freeze([
  /api\.assemblyai\.com/i,
  /api\.deepgram\.com/i,
  /speech\.googleapis\.com/i,
  /openai\.com\/v1\/audio/i,
]);

export function auditEgress(requests) {
  return requests
    .filter((r) => AUDIO_EGRESS_SUSPECTS.some((rx) => rx.test(r.url || '')))
    .map((r) => ({ url: r.url, method: r.method, hasBody: Boolean(r.hasPostData) }));
}
