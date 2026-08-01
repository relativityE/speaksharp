// Transformers.js v2 defaults to a jsDelivr WASM URL in browser workers. Private
// promises a self-hosted runtime, so import all ORT v1.14 variants through Vite;
// it emits content-addressed same-origin assets and the worker selects only the
// variant supported by the current browser (SIMD/thread capability).
import ortWasmUrl from '@xenova/transformers/dist/ort-wasm.wasm?url';
import ortWasmThreadedUrl from '@xenova/transformers/dist/ort-wasm-threaded.wasm?url';
import ortWasmSimdUrl from '@xenova/transformers/dist/ort-wasm-simd.wasm?url';
import ortWasmSimdThreadedUrl from '@xenova/transformers/dist/ort-wasm-simd-threaded.wasm?url';

export const TRANSFORMERS_V2_WASM_PATHS = {
  'ort-wasm.wasm': ortWasmUrl,
  'ort-wasm-threaded.wasm': ortWasmThreadedUrl,
  'ort-wasm-simd.wasm': ortWasmSimdUrl,
  'ort-wasm-simd-threaded.wasm': ortWasmSimdThreadedUrl,
} as const;
