/** Content-free listener accounting, not proof of fixture identity or model consumption. */
export function createCaptureReceipt(identity: {
    captureId: string; candidateId: string | null; sampleRateHz: number;
}) {
    let active = true;
    let frames = 0;
    let samples = 0;
    let firstAtMs: number | null = null;
    let lastAtMs: number | null = null;
    return {
        receive(sampleCount: number, atMs: number): void {
            if (!active || !Number.isSafeInteger(sampleCount) || sampleCount <= 0 || !Number.isFinite(atMs)) return;
            frames += 1;
            samples += sampleCount;
            firstAtMs ??= atMs;
            lastAtMs = atMs;
        },
        stop(): void { active = false; },
        read() {
            return { ...identity, active, receivedFrames: frames, receivedSamples: samples,
                firstReceivedAtMs: firstAtMs, lastReceivedAtMs: lastAtMs };
        },
    };
}

export type CaptureReceipt = ReturnType<ReturnType<typeof createCaptureReceipt>['read']>;
