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

/** #1258: a device with exactly this many hardware threads gives the engine only FOUR_CORE_ENGINE_THREADS. */
export const FOUR_CORE_DEVICE_THREADS = 4;
export const FOUR_CORE_ENGINE_THREADS = 2;

/**
 * Compute the WASM thread count for the CPU engine.
 * Returns 1 unless the context is cross-origin isolated (the hard requirement
 * for SharedArrayBuffer-backed threads).
 *
 * #1258 (PO direction "4 cores → 2 threads"): a device reporting exactly 4 hardware threads gets 2 engine threads
 * instead of 4; every other device is unchanged. Context: in Open Mic Production rehearsal run 36729186252 on a
 * 4-vCPU runner, the page stopped answering Playwright ~50 s into a take. Whether engine threads contributed is a
 * hypothesis under test (a deployed rerun), not an established cause.
 */
export function computeWasmThreadCount(
  crossOriginIsolated: boolean,
  hardwareThreads: number | undefined,
): number {
  if (!crossOriginIsolated) return 1;
  const hw = typeof hardwareThreads === 'number' && Number.isFinite(hardwareThreads)
    ? hardwareThreads
    : MAX_WASM_THREADS;
  // Only a device that REPORTS 4 hardware threads; unknown hardware keeps the previous default.
  if (typeof hardwareThreads === 'number' && Math.floor(hardwareThreads) === FOUR_CORE_DEVICE_THREADS) return FOUR_CORE_ENGINE_THREADS;
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
