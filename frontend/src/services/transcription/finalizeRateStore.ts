/**
 * #34 DURABLE finalize-time estimate.
 *
 * The post-Stop whole-utterance decode time ≈ recordingSeconds × RTF, and RTF is ENGINE-specific
 * (WASM v2 ≈ 0.27, WebGPU v4 ≈ 0.08, Native ≈ 0, Cloud streams). The old estimate hardcoded a single
 * 0.27 for every engine, so v4 (which finalizes ~3× faster) still showed the v2 wait.
 *
 * This store makes the estimate self-correcting: after every real decode we record the OBSERVED RTF
 * per engine (EMA-smoothed, persisted in localStorage), and the estimate prefers that measured value.
 * The per-engine DEFAULTS below are used ONLY until a real observation exists — they are a fallback,
 * not the source of truth, so if an engine's speed changes the estimate follows the measurements
 * rather than a stale constant.
 */
export type FinalizeEngineKey = 'private_v2' | 'private_v4' | 'native' | 'cloud';

const STORAGE_KEY = 'ss_finalize_rtf_v1';
const EMA_ALPHA = 0.5; // weight of the newest observation; smooths run-to-run jitter.

/** Documented FALLBACKS — used only until a real observation is recorded for that engine. */
const DEFAULT_RATE: Record<FinalizeEngineKey, number> = {
  private_v2: 0.27, // whisper-base.en on WASM
  private_v4: 0.09, // base-q4 on WebGPU
  native: 0, // Web Speech finalizes live — no whole-utterance decode wait
  cloud: 0.02, // streaming — negligible Stop wait
};

/** Map a runtime engine type / mode to a finalize-rate key. */
export function toFinalizeEngineKey(engineType: string | null | undefined): FinalizeEngineKey {
  const t = (engineType ?? '').toLowerCase();
  if (t.includes('v4')) return 'private_v4';
  if (t.includes('transformers-js') || t.includes('private') || t.includes('whisper')) return 'private_v2';
  if (t.includes('cloud') || t.includes('assembly')) return 'cloud';
  return 'native';
}

function readAll(): Partial<Record<FinalizeEngineKey, number>> {
  try {
    if (typeof localStorage === 'undefined') return {};
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') || {};
  } catch {
    return {};
  }
}

function writeAll(map: Partial<Record<FinalizeEngineKey, number>>): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* best-effort: a full/blocked storage must never break finalization */
  }
}

/** Record the OBSERVED real-time factor for an engine after a real decode (EMA-smoothed). */
export function recordFinalizeRate(key: FinalizeEngineKey, rtf: number): void {
  if (!Number.isFinite(rtf) || rtf <= 0 || rtf > 5) return; // guard against bad/degenerate values
  const map = readAll();
  const prev = map[key];
  map[key] = Number((prev != null ? prev * (1 - EMA_ALPHA) + rtf * EMA_ALPHA : rtf).toFixed(4));
  writeAll(map);
}

/** Best-known RTF for an engine: the observed value if we have one, else the documented default. */
export function getFinalizeRate(key: FinalizeEngineKey | null | undefined): number {
  const k = key ?? 'private_v2';
  const observed = readAll()[k];
  if (observed != null && Number.isFinite(observed)) return observed;
  return DEFAULT_RATE[k] ?? DEFAULT_RATE.private_v2;
}

/** Estimated finalize seconds for a recording of the given length on the given engine. Null = no wait. */
export function estimateFinalizeSeconds(key: FinalizeEngineKey | null | undefined, recordingSeconds: number): number | null {
  if (!(recordingSeconds > 0)) return null;
  const rate = getFinalizeRate(key);
  if (!(rate > 0)) return null; // Native/Cloud: no meaningful decode wait to estimate.
  return Math.max(2, Math.round(recordingSeconds * rate));
}
