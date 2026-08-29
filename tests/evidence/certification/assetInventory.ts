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
