/**
 * #1259 T2 — WHAT THE ENGINE ACTUALLY RESOLVED, readable from the telemetry seam.
 *
 * The seam runs inside `AnalyticsBuffer`, which has no handle on the live `TranscriptionService`; the
 * engine that knows what it resolved is constructed per session, deep in the transcription stack.
 * Passing that identity down through every producer is exactly the arrangement `envelope.ts` exists to
 * avoid — a producer can forget, and a forgotten field is an unattributable session.
 *
 * So the engine PUBLISHES what it resolved, once, at the moment it resolves it, and the seam reads the
 * latest value. Only the engine writes here.
 *
 * Absence is honest. Before any engine resolves, this is null and the envelope emits null attribution
 * rather than a guess.
 */
import type { ResolvedEngineMetadata } from './candidateAttribution';

let resolved: ResolvedEngineMetadata | null = null;

/** Publish the identity the engine RESOLVED. Called by the engine, never by a producer. */
export function recordResolvedEngine(metadata: ResolvedEngineMetadata | null | undefined): void {
    resolved = metadata?.candidateId ? metadata : null;
}

/** The most recently resolved engine identity, or null when nothing has resolved. */
export function resolvedEngine(): ResolvedEngineMetadata | null {
    return resolved;
}

/** Drop the published identity. Used by tests and when a session tears down. */
export function clearResolvedEngine(): void {
    resolved = null;
}
