// #1339 — COMPILE-ONLY sentinel that makes the `@shared` path mapping falsifiable.
//
// The live TypeScript project maps `@shared/*` to the edge-function shared sources, but no live proof
// currently imports through that alias. A declared-but-unexercised mapping cannot fail: breaking it
// changed nothing, so "the @shared mapping resolves" was an untestable claim. This file exercises the
// alias in a type position so a broken mapping becomes a compile error in the ordinary gate.
//
// COMPILE-ONLY BY CONSTRUCTION: `import type` is erased entirely, so this adds no runtime import, no
// Deno source to the bundle, and no behaviour to any proof. It exists purely so the resolution is
// checked. If a live proof ever imports `@shared` for real, this sentinel becomes redundant and should
// be deleted rather than left as decoration.
// `constants.ts` deliberately, not `cors.ts`: cors references the `Deno` global, and pulling it into
// this project would require declaring an ambient we do not own just to satisfy a sentinel.
import type { PORTS } from '@shared/constants.ts';

/**
 * Resolving this alias is the assertion. If `@shared/*` stops mapping, `SharedOriginList` becomes an
 * unresolved type and `typecheck:live` fails — which is exactly the falsification.
 */
export type SharedPorts = typeof PORTS;

/** Type-level use, so the import cannot be elided as unused. */
export type SharedPortName = keyof SharedPorts;
