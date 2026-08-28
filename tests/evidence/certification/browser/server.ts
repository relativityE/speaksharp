/**
 * #1304 Task 3C — a static origin for the browser lane.
 *
 * Serves the product's OWN self-hosted weights at `/models/`, exactly the path the app uses, so a v2
 * browser arm loads the files a user would. Also serves both transformers browser bundles straight out
 * of `node_modules`, which avoids a build step: they ship prebuilt web bundles, and adding a bundler
 * between the harness and the library would be one more place for the two to diverge.
 *
 * COOP/COEP are set because cross-origin isolation is what enables SharedArrayBuffer, and therefore
 * ONNX Runtime Web's threaded WASM backend — the configuration the product actually runs in.
 */
import { createServer, type Server } from 'node:http';
import { createReadStream, existsSync, mkdirSync, renameSync, statSync, writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, extname, join, normalize, resolve } from 'node:path';

const TYPES: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.wasm': 'application/wasm',
    '.wav': 'audio/wav',
    '.onnx': 'application/octet-stream',
    '.bin': 'application/octet-stream',
    '.txt': 'text/plain; charset=utf-8',
};

export interface HarnessServer {
    server: Server;
    origin: string;
    /** Every HuggingFace asset this run served, keyed by repo-relative path. */
    assets: Record<string, AssetRecord>;
    /**
     * Start recording which assets are requested from HERE, and return the set when done.
     *
     * WITHOUT THIS, every arm's provenance listed every asset the whole RUN had served so far — a v4
     * q8 arm claiming the digests of the q4 files loaded three arms earlier. That is worse than no
     * attribution: it is attribution that names the wrong bytes while looking precise, and it is the
     * exact evidence needed to tell an int8/q8 tie from a loader alias.
     */
    beginArmCapture: () => () => Record<string, AssetRecord>;
    /** Assets that failed their pin, or had none in pinned mode. Non-empty means no valid measurement. */
    assetFailures: { path: string; reason: 'pin_mismatch' | 'missing_pin' | 'offline_miss' | 'fetch_failed'; detail: string }[];
    close: () => Promise<void>;
}

/**
 * A LOCAL MIRROR OF THE HUGGINGFACE ASSETS, because a fresh browsing context per arm has no cache and
 * re-downloads every weight file.
 *
 * That is not a theoretical concern: it got the run HTTP 429'd part-way through, and six arms failed
 * with `Error (429) ... resolve/main/onnx/decoder_model_merged.onnx` — a network verdict, recorded as
 * if it were a model result.
 *
 * MIRRORING ALONE IS NOT PINNING. The first version hashed whatever it downloaded or happened to find
 * in the cache and reported that as the asset's identity — the same defect as recording `sha256sum` of
 * a download and calling it a pin. A digest computed from the artifact it describes constrains
 * nothing.
 *
 * So the mirror now has two modes:
 *   'pinned'  — every asset must match a committed expected digest, and a MISSING pin is a failure,
 *               not a skip. This is the mode a measurement runs in.
 *   'bootstrap' — no pins exist yet; assets are fetched and their digests printed for committing.
 *
 * `offlineOnly` additionally refuses the network entirely, so a run cannot silently re-acquire an
 * asset that has changed upstream.
 */
const HF_CACHE = '.hf-cache';

export type MirrorMode = 'pinned' | 'bootstrap';

export interface HarnessServerOptions {
    mode?: MirrorMode;
    /** Refuse to fetch anything not already mirrored. A measurement run should set this. */
    offlineOnly?: boolean;
    /** Committed expected digests, keyed by repo-relative asset path. */
    pins?: Record<string, string>;
}

export interface AssetRecord {
    sha256: string;
    bytes: number;
    /** How this asset was obtained and checked. */
    source: 'cache' | 'network';
    pinned: boolean;
}

/** Prefix -> directory. Order matters: the first matching prefix wins. */
function routes(repoRoot: string): [string, string][] {
    return [
        ['/models/', join(repoRoot, 'frontend/public/models')],
        ['/fixtures/', join(repoRoot, 'tests/fixtures')],
        // The frozen corpus audio, so a browser arm scores the same bytes the Node lane verified.
        ['/corpus/', join(repoRoot, 'bench-corpus')],
        ['/lib/', join(repoRoot, 'node_modules')],
        ['/', join(repoRoot, 'tests/evidence/certification/browser')],
    ];
}

export async function startHarnessServer(
    repoRoot = resolve('.'),
    options: HarnessServerOptions = {},
): Promise<HarnessServer> {
    const mounts = routes(repoRoot);
    const cacheRoot = join(repoRoot, HF_CACHE);
    const mode: MirrorMode = options.mode ?? 'pinned';
    const offlineOnly = options.offlineOnly ?? mode === 'pinned';
    const pins = options.pins ?? {};
    const assets: Record<string, AssetRecord> = {};
    const assetFailures: HarnessServer['assetFailures'] = [];
    /** Paths requested since the current arm's capture began. */
    let armCapture: Set<string> | null = null;

    /** Serve an asset, and CHECK it. A digest computed from the artifact it describes proves nothing. */
    const mirrorAsset = async (relative: string): Promise<Buffer | null> => {
        const file = join(cacheRoot, relative);
        if (!file.startsWith(cacheRoot)) return null;

        let bytes: Buffer | null = null;
        let source: AssetRecord['source'] = 'cache';

        if (existsSync(file)) {
            bytes = readFileSync(file);
        } else if (offlineOnly) {
            // A measurement must not silently re-acquire an asset that may have changed upstream.
            assetFailures.push({ path: relative, reason: 'offline_miss', detail: 'not mirrored, and the network is refused in this mode' });
            return null;
        } else {
            const upstream = await fetch(`https://huggingface.co/${relative}`);
            if (!upstream.ok) {
                assetFailures.push({ path: relative, reason: 'fetch_failed', detail: `HTTP ${upstream.status}` });
                return null;
            }
            bytes = Buffer.from(await upstream.arrayBuffer());
            mkdirSync(dirname(file), { recursive: true });
            // Write via a temporary name so an interrupted fetch cannot leave a truncated file that
            // later runs would happily serve and digest as if it were complete.
            const temporary = `${file}.partial`;
            writeFileSync(temporary, bytes);
            renameSync(temporary, file);
            source = 'network';
        }

        const sha256 = createHash('sha256').update(bytes).digest('hex');
        const expected = pins[relative];

        if (mode === 'pinned') {
            if (expected === undefined) {
                assetFailures.push({ path: relative, reason: 'missing_pin', detail: sha256 });
                return null;
            }
            if (expected !== sha256) {
                assetFailures.push({ path: relative, reason: 'pin_mismatch', detail: `${sha256} != ${expected}` });
                return null;
            }
        }

        assets[relative] = { sha256, bytes: bytes.length, source, pinned: mode === 'pinned' };
        armCapture?.add(relative);
        return bytes;
    };

    const server = createServer((req, res) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        const path = url.pathname === '/' ? '/harness.html' : url.pathname;

        if (path.startsWith('/hf/')) {
            const relative = normalize(decodeURIComponent(path.slice('/hf/'.length)))
                .replace(/^(\.\.[/\\])+/, '');
            void mirrorAsset(relative).then((bytes) => {
                if (!bytes) {
                    res.writeHead(404, { 'content-type': 'text/plain' });
                    res.end(`hf mirror miss: ${relative}`);
                    return;
                }
                res.writeHead(200, {
                    'content-type': TYPES[extname(relative)] ?? 'application/octet-stream',
                    'cross-origin-opener-policy': 'same-origin',
                    'cross-origin-embedder-policy': 'require-corp',
                    'cross-origin-resource-policy': 'cross-origin',
                    'cache-control': 'no-store',
                });
                res.end(bytes);
            });
            return;
        }

        for (const [prefix, dir] of mounts) {
            if (!path.startsWith(prefix)) continue;
            // `normalize` collapses `..` before the prefix check below, so a crafted path cannot
            // escape the mounted directory.
            const relative = normalize(path.slice(prefix.length)).replace(/^(\.\.[/\\])+/, '');
            const file = join(dir, relative);
            if (!file.startsWith(dir) || !existsSync(file) || !statSync(file).isFile()) continue;

            res.writeHead(200, {
                'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
                // Cross-origin isolation: what makes SharedArrayBuffer — and therefore ORT Web's
                // threaded WASM backend — available at all.
                'cross-origin-opener-policy': 'same-origin',
                'cross-origin-embedder-policy': 'require-corp',
                'cross-origin-resource-policy': 'cross-origin',
                'cache-control': 'no-store',
            });
            createReadStream(file).pipe(res);
            return;
        }

        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end(`not found: ${path}`);
    });

    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    return {
        server,
        origin: `http://127.0.0.1:${port}`,
        assets,
        assetFailures,
        beginArmCapture: () => {
            const capture = new Set<string>();
            armCapture = capture;
            return () => {
                armCapture = null;
                return Object.fromEntries([...capture].sort().map((path) => [path, assets[path]]));
            };
        },
        close: () => new Promise<void>((done) => { server.close(() => done()); }),
    };
}
