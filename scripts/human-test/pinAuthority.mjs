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
import { readFileSync, readdirSync, statSync } from 'node:fs';
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
/** Where transformers.js resolves repo-relative pin keys. Stated, not implied. */
const HF_HOST = 'https://huggingface.co';

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
        return { modelId: resolvedModel, assets: [], sameOriginPaths: [], resolved: false };
    }
    // TWO PROVENANCES, BOTH REAL. Upstream-pinned candidates list absolute CDN URLs in a JSON table.
    // The shipping v2 default is SELF-HOSTED: `pinSource` is a directory under `frontend/public`, served
    // from the app's own origin. Reading it as JSON threw EISDIR, which the caller turned into an empty
    // allowance — safe, but it flags every legitimate fetch, so the observer was unusable for the v2 arm
    // of a three-model comparison. Failing closed is correct; failing closed on ONE OF THE THREE MODELS
    // being compared is a broken tool.
    const absolute = join(REPO_ROOT, pinSource);
    const isDirectory = (() => { try { return statSync(absolute).isDirectory(); } catch { return false; } })();

    if (isDirectory) {
        // Self-hosted assets are same-origin PATHS. `frontend/public` is the web root, so the served
        // path is what remains after it — computed, never guessed, so a move of the directory changes
        // the expectation with it.
        const WEB_ROOT = 'frontend/public';
        if (!pinSource.startsWith(WEB_ROOT)) {
            return { modelId: resolvedModel, assets: [], resolved: false, sameOriginPaths: [] };
        }
        const servedBase = pinSource.slice(WEB_ROOT.length);
        const walk = (dir, prefix) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (
            entry.isDirectory()
                ? walk(join(dir, entry.name), `${prefix}/${entry.name}`)
                : [{ path: `${prefix}/${entry.name}`, bytes: statSync(join(dir, entry.name)).size }]
        ));
        const files = walk(absolute, servedBase);
        return {
            modelId: resolvedModel,
            assets: [],
            sameOriginPaths: files.map((f) => f.path),
            resolved: files.length > 0,
        };
    }

    // A THIRD SHAPE. The Hugging Face table keys entries by `<repo>/resolve/main/<file>` with a bare
    // digest string as the value; the Moonshine table stores objects carrying an absolute `url`. Reading
    // both as the latter produced `url: undefined` for every distil component, so the distil arm got an
    // allowance of undefined entries that matched nothing — every legitimate fetch flagged, the same
    // unusable-tool outcome as v2's EISDIR, one arm over.
    const pins = JSON.parse(readFileSync(absolute, 'utf8'));
    const assets = Object.entries(pins.assets ?? {})
        .filter(([key]) => key.includes(resolvedModel))
        .map(([key, pin]) => (typeof pin === 'string'
            // Keyed by repo path with no host: transformers.js resolves these against the Hugging Face
            // CDN. The host is stated here rather than left implicit, so a reviewer can see exactly what
            // is being allowed.
            ? { url: `${HF_HOST}/${key}`, bytes: null, sha256: pin }
            : { url: pin.url, bytes: pin.bytes, sha256: pin.sha256 }))
        // A component we cannot turn into a URL is DROPPED rather than carried as undefined: an
        // undefined entry silently widens nothing but hides that the table was not understood.
        .filter((a) => typeof a.url === 'string' && a.url.startsWith('https://'));
    return { modelId: resolvedModel, assets, sameOriginPaths: [], resolved: assets.length > 0 };
}

/** The exact URLs — not origins. An origin allowance permits every path a host serves. */
export function expectedAssetUrls(candidateId) {
    return new Set(expectedAssetsForCandidate(candidateId).assets.map((a) => a.url));
}

/** Exact same-origin asset paths for a self-hosted candidate. Empty for upstream-pinned ones. */
export function expectedSameOriginAssetPaths(candidateId) {
    return new Set(expectedAssetsForCandidate(candidateId).sameOriginPaths ?? []);
}
