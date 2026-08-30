/**
 * #1304 — per-arm asset inventory: name, role, hash, bytes, and a total that reconciles.
 *
 * The frozen 600 serialized `modelBytes: 54458545` and `assetCount: 13` with NO per-file breakdown: the
 * row's `assets` was never written, and `decoderAssets` filtered a map that is empty for self-hosted arms.
 * The only per-file data was a run-wide mirror tally attributable to no particular arm.
 *
 * The cost was concrete — `v4:base:q4-decoder:wasm` reported 233.1 MB against a registered 142 MB, and the
 * artifact could not say which files accounted for the difference. An aggregate that cannot be decomposed
 * is a number, not evidence.
 */
export interface AssetRecord { sha256: string; bytes: number; source: 'cache' | 'network'; pinned: boolean }

export type AssetRole = 'runtime' | 'encoder' | 'decoder' | 'tokenizer' | 'config' | 'other';

/** Role from the file's own path. Deliberately explicit: a mis-role silently distorts every subtotal. */
export function roleOf(path: string): AssetRole {
    const p = path.toLowerCase();
    if (/ort-wasm|ort\.|onnxruntime|\.mjs$|\.wasm$/.test(p) && !/model|encoder|decoder/.test(p)) return 'runtime';
    if (/encoder/.test(p)) return 'encoder';
    if (/decoder/.test(p)) return 'decoder';
    if (/tokenizer|vocab|merges/.test(p)) return 'tokenizer';
    if (/config|preprocessor|\.json$/.test(p)) return 'config';
    return 'other';
}

export interface AssetInventory {
    files: Array<{ name: string; role: AssetRole; sha256: string; bytes: number; source: string; pinned: boolean }>;
    byRole: Record<string, { count: number; bytes: number }>;
    totalBytes: number;
    fileCount: number;
    /** Whether the decomposed total equals the reported aggregate — the check that was impossible before. */
    reconcilesToModelBytes: boolean | null;
    reportedModelBytes: number | null;
    reconciliationDeltaBytes: number | null;
}

export function buildAssetInventory(
    assets: Record<string, AssetRecord>,
    reportedModelBytes: number | null,
): AssetInventory {
    const files = Object.entries(assets)
        .map(([name, r]) => ({ name, role: roleOf(name), sha256: r.sha256, bytes: r.bytes, source: r.source, pinned: r.pinned }))
        .sort((a, b) => b.bytes - a.bytes);
    const byRole: Record<string, { count: number; bytes: number }> = {};
    for (const f of files) {
        byRole[f.role] ??= { count: 0, bytes: 0 };
        byRole[f.role].count += 1;
        byRole[f.role].bytes += f.bytes;
    }
    const totalBytes = files.reduce((a, f) => a + f.bytes, 0);
    return {
        files, byRole, totalBytes, fileCount: files.length,
        reportedModelBytes,
        reconcilesToModelBytes: reportedModelBytes === null ? null : totalBytes === reportedModelBytes,
        reconciliationDeltaBytes: reportedModelBytes === null ? null : totalBytes - reportedModelBytes,
    };
}

/** One independently observed response for a model/runtime file. */
export interface ObservedRequest { bytes: number | null; status: number; count: number }

export type ReconciliationFailure =
    | 'empty_inventory' | 'declared_not_observed' | 'observed_not_declared'
    | 'byte_mismatch' | 'duplicate_request' | 'unpinned_asset' | 'missing_required_role'
    | 'reported_total_mismatch';

export interface AssetReconciliation {
    ok: boolean;
    failures: Array<{ kind: ReconciliationFailure; detail: string }>;
    declaredFiles: number;
    observedFiles: number;
    declaredBytes: number;
    observedBytes: number | null;
}

/** Roles an arm must actually have requested for its inventory to be selection-grade. */
export const REQUIRED_ASSET_ROLES: readonly AssetRole[] = ['encoder', 'decoder', 'tokenizer'];

/** Match a declared inventory key to an observed request key: paths differ by mirror prefix. */
const sameFile = (declared: string, observed: string): boolean => {
    const d = declared.replace(/^.*\/resolve\/[^/]+\//, '').replace(/^\/+/, '');
    const o = observed.replace(/^.*\/resolve\/[^/]+\//, '').replace(/^\/+/, '');
    return d === o || d.endsWith(o) || o.endsWith(d);
};

/**
 * Reconcile the DECLARED inventory against an INDEPENDENTLY OBSERVED request ledger.
 *
 * `buildAssetInventory` alone could only compare a total against a number derived from the same object,
 * which is a tautology: it cannot detect a file the arm requested but the harness never recorded. This
 * compares two channels that are written by different code paths, so a disagreement is visible.
 *
 * An arm whose inventory is empty, incomplete, duplicated, unattributed, unpinned or byte-mismatched is
 * NOT selection-grade, regardless of how good its WER looks.
 */
export function reconcileAssets(
    inventory: AssetInventory,
    observed: Record<string, ObservedRequest>,
    opts: { requirePinned: boolean },
): AssetReconciliation {
    const failures: Array<{ kind: ReconciliationFailure; detail: string }> = [];
    const observedEntries = Object.entries(observed).filter(([, r]) => r.status >= 200 && r.status < 300);

    if (inventory.fileCount === 0) {
        failures.push({ kind: 'empty_inventory', detail: 'the arm declared no assets at all' });
    }

    for (const f of inventory.files) {
        const hit = observedEntries.find(([k]) => sameFile(f.name, k));
        // A CACHED asset is legitimately never requested over the wire; only network-sourced files must
        // appear in the ledger. Otherwise a correct offline run would be failed for being offline.
        if (!hit && f.source === 'network') {
            failures.push({ kind: 'declared_not_observed', detail: f.name });
            continue;
        }
        if (hit) {
            const [, rec] = hit;
            if (rec.count > 1) failures.push({ kind: 'duplicate_request', detail: `${f.name} ×${rec.count}` });
            if (rec.bytes !== null && rec.bytes !== f.bytes) {
                failures.push({ kind: 'byte_mismatch', detail: `${f.name}: declared ${f.bytes} observed ${rec.bytes}` });
            }
        }
        if (opts.requirePinned && !f.pinned && f.source === 'network') {
            failures.push({ kind: 'unpinned_asset', detail: f.name });
        }
    }

    for (const [k] of observedEntries) {
        if (!inventory.files.some((f) => sameFile(f.name, k))) {
            failures.push({ kind: 'observed_not_declared', detail: k });
        }
    }

    for (const role of REQUIRED_ASSET_ROLES) {
        if (!inventory.byRole[role]?.count) {
            failures.push({ kind: 'missing_required_role', detail: role });
        }
    }

    if (inventory.reconcilesToModelBytes === false) {
        failures.push({
            kind: 'reported_total_mismatch',
            detail: `delta ${inventory.reconciliationDeltaBytes} bytes`,
        });
    }

    const observedBytes = observedEntries.every(([, r]) => r.bytes !== null)
        ? observedEntries.reduce((a, [, r]) => a + (r.bytes ?? 0), 0)
        : null;

    return {
        ok: failures.length === 0,
        failures,
        declaredFiles: inventory.fileCount,
        observedFiles: observedEntries.length,
        declaredBytes: inventory.totalBytes,
        observedBytes,
    };
}
