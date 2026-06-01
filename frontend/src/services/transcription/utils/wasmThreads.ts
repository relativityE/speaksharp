/**
 * Shared WASM thread-count policy for the CPU Private STT path.
 *
 * Kept dependency-free on purpose: it is imported by both the transcription
 * worker bundle and the runtime-path resolver, so the two ALWAYS agree on how
 * many threads the CPU engine will actually use. Multi-threaded WASM requires
 * the page/worker to be cross-origin isolated; otherwise we MUST stay at 1.
 */

/**
 * Upper bound on WASM threads. tiny-whisper sees diminishing returns past ~4
 * threads, and capping avoids starving the main thread and sibling workers.
 */
export const MAX_WASM_THREADS = 4;

/**
 * Compute the WASM thread count for the CPU engine.
 * Returns 1 unless the context is cross-origin isolated (the hard requirement
 * for SharedArrayBuffer-backed threads).
 */
export function computeWasmThreadCount(
  crossOriginIsolated: boolean,
  hardwareThreads: number | undefined,
): number {
  if (!crossOriginIsolated) return 1;
  const hw = typeof hardwareThreads === 'number' && Number.isFinite(hardwareThreads)
    ? hardwareThreads
    : MAX_WASM_THREADS;
  return Math.max(1, Math.min(MAX_WASM_THREADS, Math.floor(hw)));
}

/** Read `crossOriginIsolated` from whatever global scope we are running in. */
export function isCrossOriginIsolated(): boolean {
  return typeof globalThis !== 'undefined'
    && (globalThis as unknown as { crossOriginIsolated?: boolean }).crossOriginIsolated === true;
}

/** Best-effort hardware thread count, defaulting to the cap when unknown. */
export function getHardwareThreads(): number {
  return typeof navigator !== 'undefined' && typeof navigator.hardwareConcurrency === 'number'
    ? navigator.hardwareConcurrency
    : MAX_WASM_THREADS;
}
