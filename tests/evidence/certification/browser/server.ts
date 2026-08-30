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
    /** Runtime binaries actually SERVED, keyed by repo-relative path. Only what was requested. */
    runtimeServed: Record<string, AssetRecord>;
    /** Runtime requests refused: unlisted filename, missing file, or a digest that did not match. */
    runtimeFailures: { path: string; reason: 'runtime_asset_unpinned' | 'runtime_asset_missing' | 'runtime_asset_digest_mismatch'; detail: string }[];
    /** Start recording which runtime binaries an arm requests; the returned function ends the capture. */
    beginRuntimeCapture: () => () => Record<string, AssetRecord>;
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
    /**
     * Committed digests for INFERENCE RUNTIME binaries, keyed by repo-relative path.
     *
     * Served only through `/runtime/`, which verifies every byte. The generic `/lib/` mount does NOT
     * — and pointing `wasmPaths` at `/lib/` is precisely how a CDN fetch that offline enforcement had
     * correctly REFUSED became a same-origin fetch nothing checked. The request stopped failing; it did
     * not start being verified.
     */
    runtimePins?: Record<string, string>;
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
        // Library CODE only. Runtime BINARIES are deliberately excluded below and must go through the
        // pin-enforcing `/runtime/` endpoint; serving them here is what let an unpinned
        // `ort-wasm.wasm` return 9,223,228 bytes with zero recorded failures.
        ['/lib/', join(repoRoot, 'node_modules')],
        // Locally cached third-party CDN assets (the official Moonshine component sets), served over
        // ordinary HTTP from our own origin so a pinned run needs no network.
        ['/external/', join(repoRoot, '.hf-cache', 'external')],
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
    const runtimePins = options.runtimePins ?? {};
    /** Executable modules served from `/lib/`, bound to package + locked version + SHA-256. */
    const libExecutablePins: Record<string, { sha256: string; bytes: number; package: string; version: string }> =
        (() => {
            try {
                return (JSON.parse(readFileSync(join(repoRoot, 'tests/fixtures/lib-executable-pins.json'), 'utf8')) as {
                    assets: Record<string, { sha256: string; bytes: number; package: string; version: string }>;
                }).assets;
            } catch { return {}; }
        })();
    const runtimeServed: Record<string, AssetRecord> = {};
    const runtimeFailures: HarnessServer['runtimeFailures'] = [];
    let runtimeCapture: Set<string> | null = null;

    /** Where a `/runtime/<family>/<file>` request resolves to on disk. */
    const RUNTIME_ROOTS: Record<string, string> = {
        xenova: 'node_modules/@xenova/transformers/dist',
        ortweb: 'node_modules/onnxruntime-web/dist',
    };

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

        /**
         * PIN-ENFORCING RUNTIME ENDPOINT.
         *
         * Every byte served here is checked against the committed table first. A filename that is not
         * in the table is REFUSED — not served from disk because it happens to exist — because the
         * original defect was a runtime file nobody had listed, and a mount that serves whatever is
         * present reproduces it exactly.
         */
        if (path.startsWith('/runtime/')) {
            const [family, ...rest] = path.slice('/runtime/'.length).split('/');
            const file = normalize(rest.join('/')).replace(/^(\.\.[/\\])+/, '');
            const root = RUNTIME_ROOTS[family];
            const refuse = (reason: HarnessServer['runtimeFailures'][number]['reason'], detail: string) => {
                runtimeFailures.push({ path: `${family}/${file}`, reason, detail });
                res.writeHead(403, { 'content-type': 'text/plain' });
                res.end(`${reason}: ${detail}`);
            };
            if (!root) return refuse('runtime_asset_unpinned', `unknown runtime family "${family}"`);

            const diskPath = join(root, file);
            const expected = runtimePins[diskPath];
            if (expected === undefined) return refuse('runtime_asset_unpinned', diskPath);
            const absolute = join(repoRoot, diskPath);
            if (!absolute.startsWith(join(repoRoot, root)) || !existsSync(absolute)) {
                return refuse('runtime_asset_missing', diskPath);
            }
            const bytes = readFileSync(absolute);
            const sha256 = createHash('sha256').update(bytes).digest('hex');
            if (sha256 !== expected) {
                return refuse('runtime_asset_digest_mismatch', `${diskPath}: ${sha256} != ${expected}`);
            }

            runtimeServed[diskPath] = { sha256, bytes: bytes.length, source: 'cache', pinned: true };
            runtimeCapture?.add(diskPath);
            res.writeHead(200, {
                'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
                'cross-origin-opener-policy': 'same-origin',
                'cross-origin-embedder-policy': 'require-corp',
                'cross-origin-resource-policy': 'cross-origin',
                'access-control-allow-origin': '*',
                'cache-control': 'no-store',
            });
            res.end(bytes);
            return;
        }

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
            if (prefix === '/lib/' && /ort-wasm[^/]*\.(wasm|mjs)$/.test(path)) {
                runtimeFailures.push({
                    path, reason: 'runtime_asset_unpinned',
                    detail: 'runtime binaries must be requested through /runtime/, which verifies them',
                });
                res.writeHead(403, { 'content-type': 'text/plain' });
                res.end('runtime binaries are not served from /lib/; use /runtime/');
                return;
            }
            // `normalize` collapses `..` before the prefix check below, so a crafted path cannot
            // escape the mounted directory.
            const relative = normalize(path.slice(prefix.length)).replace(/^(\.\.[/\\])+/, '');
            const file = join(dir, relative);
            if (!file.startsWith(dir) || !existsSync(file) || !statSync(file).isFile()) continue;

            /**
             * EXECUTABLE MODULES SERVED HERE ARE PART OF THE ARM'S PROVENANCE.
             *
             * Only `/runtime/` requests were recorded, so a `.mjs` or `.wasm` served from `/lib/` executed
             * without appearing in the arm's declared inventory at all. The first preflight caught exactly
             * that: `ort.webgpu.bundle.min.mjs`, `moonshine.mjs` and `moonshine.wasm` were observed on the
             * wire and declared nowhere, so the arm fingerprint did not bind every byte that ran — the same
             * defect class as a verdict reporting 9 files while its provenance reported 7.
             *
             * Recording them here does NOT claim they are pinned: `/runtime/` remains the pin-enforcing
             * mount, and these are reported `pinned: false` truthfully. What changes is that they are
             * DECLARED, with their digest, so the inventory can be reconciled against what was fetched.
             */
            if (/\.(mjs|js|wasm)$/.test(relative)) {
                const moduleBytes = readFileSync(file);
                const key = `lib/${relative}`;
                const sha256 = createHash('sha256').update(moduleBytes).digest('hex');
                const pin = libExecutablePins[key];
                // PINNED means the exact bytes AND the locked package version match. Declaring the module
                // was necessary but not sufficient: a declared-but-unpinned executable can still change
                // under the same recorded identity, which is the whole failure mode `/runtime/` exists to
                // prevent. `source: 'cache'` is NOT an exemption for something that executes.
                const pinned = pin !== undefined && pin.sha256 === sha256;
                if (!pinned) {
                    runtimeFailures.push({
                        path: key,
                        reason: pin === undefined ? 'runtime_asset_unpinned' : 'runtime_asset_digest_mismatch',
                        detail: pin === undefined ? key : `${key}: ${sha256} != ${pin.sha256}`,
                    });
                }
                runtimeServed[key] = { sha256, bytes: moduleBytes.length, source: 'cache', pinned };
                runtimeCapture?.add(key);
            }

            res.writeHead(200, {
                'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
                // Cross-origin isolation: what makes SharedArrayBuffer — and therefore ORT Web's
                // threaded WASM backend — available at all.
                'cross-origin-opener-policy': 'same-origin',
                'cross-origin-embedder-policy': 'require-corp',
                'cross-origin-resource-policy': 'cross-origin',
                // Assets redirected here are fetched from a third-party origin's code path.
                'access-control-allow-origin': '*',
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
        runtimeServed,
        runtimeFailures,
        beginRuntimeCapture: () => {
            const capture = new Set<string>();
            runtimeCapture = capture;
            return () => {
                runtimeCapture = null;
                return Object.fromEntries([...capture].sort().map((p) => [p, runtimeServed[p]]));
            };
        },
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
