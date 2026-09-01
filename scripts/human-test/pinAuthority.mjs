/**
 * THE OBSERVER'S ASSETS COME FROM THE REGISTRY, NOT FROM ITS CALLER.
 *
 * The audit used to accept an arbitrary list of allowed origins as a parameter. Whoever ran the observer
 * decided what counted as a legitimate model download, which means the check could be widened — by
 * accident or by convenience — to whatever made a run pass. An allowance the operator supplies is not
 * evidence about the product.
 *
 * These helpers resolve the exact committed assets for the candidate that was OBSERVED to run, through
 * the same registry and pin table the product itself loads from. There is one authority, and the
 * observer reads it rather than being told.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = (() => {
    let dir = dirname(fileURLToPath(import.meta.url));
    for (let i = 0; i < 12; i++) {
        try { readFileSync(join(dir, 'pnpm-lock.yaml')); return dir; } catch { dir = dirname(dir); }
    }
    throw new Error('repo root not found');
})();

const REGISTRY = 'frontend/src/services/transcription/candidateRegistry.ts';

/**
 * The registry block for one candidate.
 *
 * Sliced between the candidate's own id line and the next one so a value from a NEIGHBOURING candidate
 * cannot be read as this one's — which would silently allow another model's assets.
 */
function candidateBlock(candidateId) {
    const source = readFileSync(join(REPO_ROOT, REGISTRY), 'utf8');
    const start = source.indexOf(`'${candidateId}': {`);
    if (start === -1) throw new Error(`candidate ${candidateId} is not in the registry`);
    const next = source.indexOf("\n    '", start + 1);
    return source.slice(start, next === -1 ? source.length : next);
}

const field = (block, name) => {
    const m = block.match(new RegExp(`${name}:\\s*'([^']+)'`));
    return m ? m[1] : null;
};

/** Exact committed asset URLs for the model this candidate runs. */
export function expectedAssetsForCandidate(candidateId) {
    const block = candidateBlock(candidateId);
    const modelId = field(block, 'id\\s*:\\s*\'[^\']*\'\\s*,\\s*\\n\\s*revision') ?? null;
    // `model: { id: ... }` — taken from the model sub-object rather than the candidate's own `id`.
    const modelMatch = block.match(/model:\s*\{[^}]*?id:\s*'([^']+)'/s);
    const resolvedModel = modelMatch ? modelMatch[1] : modelId;
    const pinSource = field(block, 'pinSource');
    if (!resolvedModel || !pinSource) {
        // FAIL CLOSED: a candidate we cannot resolve assets for gets an EMPTY allowance, so every
        // request it makes is reported. Returning "allow everything" on a lookup failure would turn a
        // registry edit into a silent hole in the privacy check.
        return { modelId: resolvedModel, assets: [], resolved: false };
    }
    const pins = JSON.parse(readFileSync(join(REPO_ROOT, pinSource), 'utf8'));
    const assets = Object.entries(pins.assets ?? {})
        .filter(([key]) => key.includes(resolvedModel))
        .map(([, pin]) => ({ url: pin.url, bytes: pin.bytes, sha256: pin.sha256 }));
    return { modelId: resolvedModel, assets, resolved: assets.length > 0 };
}

/** The exact URLs — not origins. An origin allowance permits every path a host serves. */
export function expectedAssetUrls(candidateId) {
    return new Set(expectedAssetsForCandidate(candidateId).assets.map((a) => a.url));
}
