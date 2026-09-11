/** The only Production arming input for the hidden model-comparison switch. */
export const MODEL_COMPARISON_CDP_ARM_KEY = 'speaksharp.model-comparison.cdp';

/**
 * Installed by Page.addScriptToEvaluateOnNewDocument before the app boots. It is deliberately a
 * non-enumerable Symbol property: no URL, localStorage value, feature flag, or visible control can
 * activate the comparison surface.
 */
export const MODEL_COMPARISON_CDP_ARM = `Object.defineProperty(
  globalThis,
  Symbol.for(${JSON.stringify(MODEL_COMPARISON_CDP_ARM_KEY)}),
  { value: true, enumerable: false, configurable: false, writable: false }
);`;

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
