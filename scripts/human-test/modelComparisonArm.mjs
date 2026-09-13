/**
 * #1432 — inject a release/origin-bound comparison authorization before app boot.
 *
 * Product Owner decision 5651663038 / PM decision 5651684739: the authorization is minted by one owner-dispatched
 * `rc-gates.yml` run attempt and live-read from GitHub by trusted Node before it is injected. The page's own
 * check of it is defense-in-depth only; nothing here is signed or secret.
 */
export const MODEL_COMPARISON_AUTH_KEY = 'speaksharp.model-comparison.authorization';

export function modelComparisonArmExpression(authorization) {
  return `Object.defineProperty(
    globalThis,
    Symbol.for(${JSON.stringify(MODEL_COMPARISON_AUTH_KEY)}),
    { value: ${JSON.stringify(authorization)}, enumerable: false, configurable: true, writable: false }
  );`;
}

/** One CDP evaluation: switch the model, then read the page's independent identity receipt. */
export function modelComparisonSwitchExpression(candidate, journey) {
  return `(async () => {
    const w = globalThis;
    if (typeof w.__SS_SWITCH_CANDIDATE__ !== 'function' || typeof w.__SS_ACTIVE_CANDIDATE__ !== 'function') {
      return { outcome: { ok: false, code: 'surface_missing' }, active: null };
    }
    const outcome = await w.__SS_SWITCH_CANDIDATE__(${JSON.stringify(candidate)}, ${JSON.stringify(journey)});
    return { outcome, active: w.__SS_ACTIVE_CANDIDATE__() };
  })()`;
}
