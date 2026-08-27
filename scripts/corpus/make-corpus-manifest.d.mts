/**
 * #1304 — types for the manifest generator, so `typecheck:evidence` can see the sampler its tests
 * import. The generator is `.mjs` because it runs directly under node with no build step; without
 * this declaration the gate reports an implicit `any` rather than checking the contract.
 */

/**
 * Deterministically choose `size` ids from `ids` using `seed`.
 *
 * Sorts first, so filesystem traversal order cannot change the result, and returns a sorted array so
 * a manifest diff is readable. A pool smaller than `size` returns the whole pool.
 */
export function seededSample(ids: readonly string[], size: number, seed: string): string[];
