import { existsSync, readFileSync } from 'node:fs';
import { atomicWriteFileSync } from './atomicWrite';

/**
 * #1304 — evidence-first persistence for diagnostic probes.
 *
 * A probe crashed AFTER printing its results and BEFORE writing anything, so the console showed findings
 * no artifact supported. A printed table is presentation; it is never a source of record. Every cell is
 * therefore durable before anything derived from it is printed, and the artifact exists — as a skeleton
 * with `complete: false` — before the first decode runs.
 *
 * CROSS-ATTRIBUTION IS STRUCTURALLY UNAVAILABLE, not merely discouraged.
 *
 * A probe cell can involve several inference calls: the adapter's `decode`, the pipeline's own call, and
 * a direct `model.generate`. Reporting token ids beside a `{text:""}` drawn from a DIFFERENT call invites
 * exactly the claim "the adapter received these tokens", which those observations cannot support. So a
 * cell holds no result fields of its own: every observation lives inside a tagged `invocation`, and any
 * comparison across invocations has to name both, which makes the conflation visible instead of implicit.
 */

/** One inference call and everything observed from THAT call. */
export interface ProbeInvocation {
    /** Unique within the cell. Two observations sharing an id came from one call; different ids did not. */
    invocationId: string;
    kind: 'adapter.decode' | 'pipeline.call' | 'model.generate';
    observations: Record<string, unknown>;
    error?: { name: string; message: string } | null;
}

export interface ProbeCell {
    utteranceId: string;
    invocations: ProbeInvocation[];
    [k: string]: unknown;
}

export interface ProbeHeader {
    kind: 'diagnostic_probe';
    armId: string;
    command: string;
    executionSha: string;
    expectedCells: string[];
    [k: string]: unknown;
}

/** BigInt is not JSON-serializable, and losing an artifact to one value defeats the whole mechanism. */
export const bigIntSafe = (_key: string, value: unknown): unknown =>
    (typeof value === 'bigint' ? Number(value) : value);

export function serializeProbe(header: ProbeHeader, cells: ProbeCell[], complete: boolean): string {
    return `${JSON.stringify({ ...header, complete, cells }, bigIntSafe, 2)}\n`;
}

export type FinalizeResult =
    | { ok: true }
    | { ok: false; reason: 'missing_cells' | 'duplicate_cells' | 'unexpected_cells'; detail: string };

/** The final artifact is earned by covering the exact expected set — not by the run merely ending. */
export function validateProbeCells(cells: ProbeCell[], expected: string[]): FinalizeResult {
    const seen = new Set<string>();
    const dupes: string[] = [];
    for (const c of cells) {
        if (seen.has(c.utteranceId)) dupes.push(c.utteranceId);
        seen.add(c.utteranceId);
    }
    if (dupes.length) return { ok: false, reason: 'duplicate_cells', detail: [...new Set(dupes)].sort().join(', ') };
    const missing = expected.filter(id => !seen.has(id)).sort();
    if (missing.length) return { ok: false, reason: 'missing_cells', detail: missing.join(', ') };
    const exp = new Set(expected);
    const extra = [...seen].filter(id => !exp.has(id)).sort();
    if (extra.length) return { ok: false, reason: 'unexpected_cells', detail: extra.join(', ') };
    return { ok: true };
}

/**
 * A probe recorder. The skeleton is written on construction, so an artifact exists before any inference.
 */
export class ProbeRecorder {
    private readonly cells: ProbeCell[] = [];

    constructor(
        private readonly partialPath: string,
        private readonly finalPath: string,
        private readonly header: ProbeHeader,
    ) {
        this.persist(false);
    }

    private persist(complete: boolean): void {
        atomicWriteFileSync(this.partialPath, serializeProbe(this.header, this.cells, complete));
    }

    /** Durable BEFORE the caller prints anything derived from it. Returns once the bytes are on disk. */
    addCell(cell: ProbeCell): void {
        if (this.cells.some(c => c.utteranceId === cell.utteranceId)) {
            // Silently replacing a cell would let a retry overwrite a result nobody knew existed.
            throw new Error(`probe cell already recorded: ${cell.utteranceId}`);
        }
        this.cells.push(cell);
        this.persist(false);
    }

    get recorded(): readonly ProbeCell[] { return this.cells; }

    /**
     * Promote to the final artifact only when the exact expected set is covered. The partial is retained
     * either way: a failed finalization must leave the evidence, not remove it.
     */
    finalize(): FinalizeResult {
        const verdict = validateProbeCells(this.cells, this.header.expectedCells);
        if (!verdict.ok) return verdict;
        atomicWriteFileSync(this.finalPath, serializeProbe(
            { ...this.header, partialArtifact: this.partialPath }, this.cells, true));
        return { ok: true };
    }
}

/** A retained partial must be readable by a reviewer without special tooling. */
export function readProbeArtifact(path: string): { complete: boolean; cells: ProbeCell[] } | null {
    if (!existsSync(path)) return null;
    try {
        const doc = JSON.parse(readFileSync(path, 'utf8')) as { complete?: boolean; cells?: ProbeCell[] };
        return { complete: doc.complete === true, cells: doc.cells ?? [] };
    } catch { return null; }
}
