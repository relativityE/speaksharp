/**
 * #1432 — inject an Ops-signed, release/origin-bound comparison authorization before app boot.
 *
 * This module never signs. The private key remains outside the repository/browser; the harness only
 * transports the already signed envelope into the new document for one-time verification by the app.
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
export function modelComparisonSwitchExpression(candidate) {
  return `(async () => {
    const w = globalThis;
    if (typeof w.__SS_SWITCH_CANDIDATE__ !== 'function' || typeof w.__SS_ACTIVE_CANDIDATE__ !== 'function') {
      return { outcome: { ok: false, code: 'surface_missing' }, active: null };
    }
    const outcome = await w.__SS_SWITCH_CANDIDATE__(${JSON.stringify(candidate)});
    return { outcome, active: w.__SS_ACTIVE_CANDIDATE__() };
  })()`;
}
