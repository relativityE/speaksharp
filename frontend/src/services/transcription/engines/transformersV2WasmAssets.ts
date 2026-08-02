// Transformers.js v2 defaults to a jsDelivr WASM URL in browser workers. Private
// promises a self-hosted runtime, so import all ORT v1.14 variants through Vite.
// `vite.config.mjs` emits these four files under their ORT-stable filenames in
// one directory. ORT 1.14 receives that directory prefix and appends the exact
// filename selected for the browser's SIMD/thread capability.
import ortWasmUrl from '@xenova/transformers/dist/ort-wasm.wasm?url';
import ortWasmThreadedUrl from '@xenova/transformers/dist/ort-wasm-threaded.wasm?url';
import ortWasmSimdUrl from '@xenova/transformers/dist/ort-wasm-simd.wasm?url';
import ortWasmSimdThreadedUrl from '@xenova/transformers/dist/ort-wasm-simd-threaded.wasm?url';

export const TRANSFORMERS_V2_WASM_ASSET_URLS = {
  'ort-wasm.wasm': ortWasmUrl,
  'ort-wasm-threaded.wasm': ortWasmThreadedUrl,
  'ort-wasm-simd.wasm': ortWasmSimdUrl,
  'ort-wasm-simd-threaded.wasm': ortWasmSimdThreadedUrl,
} as const;

const assetDirectories = new Set(Object.values(TRANSFORMERS_V2_WASM_ASSET_URLS).map((assetUrl) => {
  const separator = assetUrl.lastIndexOf('/');
  if (separator < 0) throw new Error(`Private v2 ORT asset URL has no directory: ${assetUrl}`);
  return assetUrl.slice(0, separator + 1);
}));

if (assetDirectories.size !== 1) {
  throw new Error('Private v2 ORT assets must share one stable URL directory');
}

export const TRANSFORMERS_V2_WASM_PATH_PREFIX = [...assetDirectories][0]!;
