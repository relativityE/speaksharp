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
    | 'reported_total_mismatch'
    /** A served file whose response carried no length — its bytes were never independently observed. */
    | 'missing_byte_count'
    /** Declared and pinned, but absent from a ledger that claims to be complete. */
    | 'declared_not_served';

export interface AssetReconciliation {
    ok: boolean;
    /** Fraction of declared files the observed channel actually saw. */
    ledgerCoverage?: number;
    /** Which authority `ok` rests on — never left for the reader to infer. */
    ledgerAuthority?: 'served_ledger' | 'declared_pins_only';
    missingByteCounts?: string[];
    failures: Array<{ kind: ReconciliationFailure; detail: string }>;
    /** Observed more than once — normal per-worker fetching, retained for visibility, never a failure. */
    repeatedRequests: string[];
    declaredFiles: number;
    observedFiles: number;
    declaredBytes: number;
    observedBytes: number | null;
}

/** Roles an arm must actually have requested for its inventory to be selection-grade. */
export const REQUIRED_ASSET_ROLES: readonly AssetRole[] = ['encoder', 'decoder', 'tokenizer'];

const strip = (k: string): string => k.replace(/^.*\/resolve\/[^/]+\//, '').replace(/^\/+/, '');
const base = (k: string): string => k.split('/').pop() ?? k;

/**
 * Match a declared inventory key to an observed request key.
 *
 * The two channels name the same file differently ON PURPOSE: the declared inventory records a runtime
 * binary by its FILESYSTEM SOURCE (`node_modules/@xenova/transformers/dist/ort-wasm-simd-threaded.wasm`)
 * while the ledger records the URL PATH it was served from (`runtime/xenova/ort-wasm-simd-threaded.wasm`).
 * A suffix comparison alone reported that as `observed_not_declared` on the very first preflight — a
 * matcher artifact, not a missing asset.
 *
 * So basename equality is accepted as a fallback, but ONLY when that basename is unambiguous on both
 * sides. Collapsing files by basename unconditionally would silently pair two different `config.json`s
 * from different repos, turning a real omission into a false match — the opposite and worse error.
 */
const makeMatcher = (declaredKeys: string[], observedKeys: string[]) => {
    const count = (keys: string[]): Map<string, number> => {
        const m = new Map<string, number>();
        for (const k of keys) m.set(base(k), (m.get(base(k)) ?? 0) + 1);
        return m;
    };
    const dCount = count(declaredKeys);
    const oCount = count(observedKeys);
    return (declared: string, observed: string): boolean => {
        const d = strip(declared);
        const o = strip(observed);
        if (d === o || d.endsWith(o) || o.endsWith(d)) return true;
        const b = base(d);
        return b === base(o) && dCount.get(b) === 1 && oCount.get(b) === 1;
    };
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
    opts: { requirePinned: boolean; requireCompleteLedger?: boolean },
): AssetReconciliation {
    const failures: Array<{ kind: ReconciliationFailure; detail: string }> = [];
    const duplicates: string[] = [];
    const observedEntries = Object.entries(observed).filter(([, r]) => r.status >= 200 && r.status < 300);
    const sameFile = makeMatcher(inventory.files.map((f) => f.name), observedEntries.map(([k]) => k));

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
            // A repeated request is NOT a failure. The first preflight showed onnxruntime fetching the
            // same `.mjs` four times — once per worker — which is ordinary browser behaviour. Failing on
            // it would disqualify a correct arm. Recorded as an observation so it stays visible.
            if (rec.count > 1) duplicates.push(`${f.name} ×${rec.count}`);
            if (rec.bytes !== null && rec.bytes !== f.bytes) {
                failures.push({ kind: 'byte_mismatch', detail: `${f.name}: declared ${f.bytes} observed ${rec.bytes}` });
            }
        }
        // AN EXECUTABLE MUST BE PINNED REGARDLESS OF SOURCE.
        //
        // The exemption for cache-sourced assets is correct for model WEIGHTS served from a local mirror —
        // failing a correct offline run for being offline helps nobody. It is NOT correct for a module that
        // EXECUTES: `source: 'cache'` says where the bytes came from, not that anything bound which bytes
        // they were. An unpinned executable makes the arm ineligible either way.
        const executes = /\.(mjs|js|wasm)$/.test(f.name) || f.role === 'runtime';
        if (opts.requirePinned && !f.pinned && (executes || f.source === 'network')) {
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

    /**
     * THE LEDGER MUST SAY WHAT IT ACTUALLY PROVES.
     *
     * The r6 artifact reported `ok:true` while independently observing 10 of 30 declared files with a
     * NULL byte total. That is pinned server-side inventory — real, but not the "complete independent
     * byte/request reconciliation" the field name claimed. The Playwright response trace cannot see
     * worker- and module-initiated requests, so it is a DIAGNOSTIC channel, and a diagnostic channel must
     * not be the thing that makes a reconciliation `ok`.
     *
     * Coverage and byte-completeness are therefore reported as their own facts, and an incomplete or
     * byteless ledger is a FAILURE rather than a silent pass.
     */
    const missingByteCounts = observedEntries.filter(([, r]) => r.bytes === null).map(([k]) => k);
    const observedBytes = missingByteCounts.length === 0
        ? observedEntries.reduce((a, [, r]) => a + (r.bytes ?? 0), 0)
        : null;

    if (opts.requireCompleteLedger) {
        for (const k of missingByteCounts) {
            failures.push({ kind: 'missing_byte_count', detail: k });
        }
        // Every DECLARED file must appear in the served ledger. Cached files are exempt from the NETWORK
        // ledger above, but not from a ledger that claims to be complete.
        const unobserved = inventory.files
            .filter((f) => !observedEntries.some(([k]) => sameFile(f.name, k)))
            .map((f) => f.name);
        for (const name of unobserved) {
            failures.push({ kind: 'declared_not_served', detail: name });
        }
    }

    return {
        ok: failures.length === 0,
        failures,
        repeatedRequests: duplicates,
        declaredFiles: inventory.fileCount,
        observedFiles: observedEntries.length,
        declaredBytes: inventory.totalBytes,
        observedBytes,
        missingByteCounts,
        /** What the observed channel actually covered. `1` only when it saw every declared file. */
        ledgerCoverage: inventory.fileCount === 0 ? 0
            : inventory.files.filter((f) => observedEntries.some(([k]) => sameFile(f.name, k))).length / inventory.fileCount,
        /** Names the authority behind `ok`, so a reader is never left inferring it. */
        ledgerAuthority: opts.requireCompleteLedger ? 'served_ledger' : 'declared_pins_only',
    };
}

/** A committed expectation for one asset: the authority a served file is checked against. */
export interface CommittedPin { sha256: string; bytes?: number; version?: string }

export type PinVerification =
    | { ok: true; checked: number; authority: 'committed_pins' }
    | { ok: false; failures: Array<{ kind: 'unpinned' | 'hash_mismatch' | 'byte_mismatch'; detail: string }>; checked: number; authority: 'committed_pins' };

/**
 * Reconcile the SERVED ledger against the COMMITTED pin registry.
 *
 * This is where the independence actually lives. The served ledger and the declared inventory are both
 * written by the harness, so comparing them proves only self-consistency — the criticism that landed
 * against `ok:true` with 10 of 30 files observed. The committed pins are a DIFFERENT authority: a file
 * checked in, reviewed, and unchanged by the run. A served file whose bytes disagree with its committed
 * digest is caught here and nowhere else.
 *
 * The Playwright response trace stays DIAGNOSTIC: it cannot observe worker- or module-initiated requests,
 * so it can corroborate but must never be the thing that makes a reconciliation `ok`.
 */
export function verifyAgainstCommittedPins(
    inventory: AssetInventory,
    pins: Readonly<Record<string, CommittedPin>>,
    opts: { require: (f: AssetInventory['files'][number]) => boolean },
): PinVerification {
    const failures: Array<{ kind: 'unpinned' | 'hash_mismatch' | 'byte_mismatch'; detail: string }> = [];
    let checked = 0;
    const keys = Object.keys(pins);
    const findPin = (name: string): CommittedPin | undefined => {
        if (pins[name]) return pins[name];
        const b = base(name);
        const hit = keys.filter((k) => base(k) === b);
        return hit.length === 1 ? pins[hit[0]] : undefined;   // never collapse an ambiguous basename
    };

    for (const f of inventory.files) {
        if (!opts.require(f)) continue;
        checked += 1;
        const pin = findPin(f.name);
        if (!pin) { failures.push({ kind: 'unpinned', detail: f.name }); continue; }
        if (pin.sha256 !== f.sha256) {
            failures.push({ kind: 'hash_mismatch', detail: `${f.name}: served ${f.sha256} != committed ${pin.sha256}` });
            continue;
        }
        if (typeof pin.bytes === 'number' && pin.bytes !== f.bytes) {
            failures.push({ kind: 'byte_mismatch', detail: `${f.name}: served ${f.bytes} != committed ${pin.bytes}` });
        }
    }
    return failures.length
        ? { ok: false, failures, checked, authority: 'committed_pins' }
        : { ok: true, checked, authority: 'committed_pins' };
}
