/**
 * ONE CAPABILITY READING PER SWITCH/INIT, TAKEN ONCE AND FROZEN.
 *
 * Accelerator availability was probed twice, independently and asynchronously: the refusal gate called
 * `isWebGPUSupported()` while the runtime-path resolver called `detectWebGPUSupport()` inside itself.
 * Nothing coupled them and nothing compared them, so the two answers were free to differ — a driver
 * reset, an adapter lost between the calls, or simply the second probe seeing a different machine state.
 *
 * The failure that produces is not a crash. The gate says "accelerator present, this candidate may
 * proceed", the resolver says "no accelerator, fall to the v2 floor", and the session runs Whisper v2
 * while the switch reports success for the candidate that was requested. A silent model substitution
 * reported as success is the single outcome the whole attribution effort exists to prevent, so the
 * probes are replaced by one snapshot that every downstream decision reads.
 *
 * The snapshot is frozen because a mutable one is the same bug with extra steps.
 */
import { detectWebGPUSupport } from './utils/webgpuSupport';

export interface CapabilitySnapshot {
    readonly webgpuAvailable: boolean;
    readonly capturedAt: string;
    /** Why the answer is what it is, so a refusal can explain itself rather than just failing. */
    readonly reason: 'detected' | 'absent' | 'probe_threw';
}

/**
 * Take the reading. Called exactly once at the top of an init or a switch; the result is threaded
 * through refusal, availability and runtime selection rather than re-derived by each of them.
 *
 * FAILS CLOSED. A probe that throws yields `false`, not "unknown": an accelerator we cannot confirm is
 * one we must not select against, and treating an error as permission is how a WebGPU-only candidate
 * ends up on WASM.
 */
export async function captureCapabilities(
    detect: typeof detectWebGPUSupport = detectWebGPUSupport,
): Promise<CapabilitySnapshot> {
    let webgpuAvailable = false;
    let reason: CapabilitySnapshot['reason'] = 'absent';
    try {
        webgpuAvailable = (await detect()).supported === true;
        reason = webgpuAvailable ? 'detected' : 'absent';
    } catch {
        webgpuAvailable = false;
        reason = 'probe_threw';
    }
    return Object.freeze({ webgpuAvailable, capturedAt: new Date().toISOString(), reason });
}
