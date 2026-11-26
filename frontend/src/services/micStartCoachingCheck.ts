/** One background readiness request, separate from any take or transcript write. */
export interface MicStartCheckContext {
    enabled: boolean;
    recordingConfirmed: boolean;
    consentStillHolds: () => boolean;
}
export function startMicCoachingCheck(
    context: MicStartCheckContext,
    request: () => PromiseLike<unknown>,
): void {
    if (context.enabled !== true || context.recordingConfirmed !== true || !context.consentStillHolds()) return;
    // Do not return a promise that Start could await. Recheck before actually sending.
    void Promise.resolve().then(() => context.consentStillHolds() ? request() : undefined).catch(() => {});
}
