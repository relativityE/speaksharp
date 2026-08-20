// Node 22 import preflight for the DORMANT Private v4 stack (@huggingface/transformers).
//
// P1.5: the v4 ESM bundle directly imports `Tensor` from `onnxruntime-common` without declaring it as a
// dependency. If pnpm resolves that undeclared import to the hoisted CommonJS onnxruntime-common@1.14.0
// (from the @xenova/transformers v2 tree), Node fails at load with:
//     SyntaxError: Named export 'Tensor' not found. The requested module 'onnxruntime-common' is a
//     CommonJS module ...
// The `packageExtensions` entry in pnpm-workspace.yaml pins onnxruntime-common@1.24.3 (ESM) beside the
// v4 package. This preflight imports the REAL package and fails FAST (nonzero exit) if that boundary
// ever regresses — before the expensive model download in the full smoke.
//
// It does NOT touch production Private v2 (@xenova/transformers). It only proves the v4 ESM bundle loads.

try {
  const mod = await import('@huggingface/transformers');
  const { pipeline, env } = mod;
  if (typeof pipeline !== 'function') {
    throw new Error(`@huggingface/transformers export 'pipeline' is not a function (got ${typeof pipeline})`);
  }
  if (!env || typeof env !== 'object') {
    throw new Error(`@huggingface/transformers export 'env' is missing or not an object (got ${typeof env})`);
  }
  console.log('PRIVATE_V4_IMPORT_PREFLIGHT: PASS — @huggingface/transformers ESM loaded; pipeline() + env present.');
  process.exit(0);
} catch (err) {
  console.error('PRIVATE_V4_IMPORT_PREFLIGHT: FAIL — v4 ESM boundary broken (check onnxruntime-common resolution).');
  console.error(String(err?.stack ?? err?.message ?? err));
  process.exit(1);
}
