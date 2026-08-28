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
    /** SHA-256 of every HuggingFace asset this run served, keyed by repo-relative path. */
    assetDigests: Record<string, string>;
    close: () => Promise<void>;
}

/**
 * A LOCAL MIRROR OF THE HUGGINGFACE ASSETS, because a fresh browsing context per arm has no cache and
 * re-downloads every weight file.
 *
 * That is not a theoretical concern: it got the run HTTP 429'd part-way through, and six arms failed
 * with `Error (429) ... resolve/main/onnx/decoder_model_merged.onnx` — a network verdict, recorded as
 * if it were a model result. Mirroring makes the lane reproducible, offline after the first fetch, and
 * — the part that matters for evidence — lets every served file be DIGESTED, so an arm's provenance
 * names the exact bytes it ran on rather than "whatever the CDN had".
 */
const HF_CACHE = '.hf-cache';

/** Prefix -> directory. Order matters: the first matching prefix wins. */
function routes(repoRoot: string): [string, string][] {
    return [
        ['/models/', join(repoRoot, 'frontend/public/models')],
        ['/fixtures/', join(repoRoot, 'tests/fixtures')],
        ['/lib/', join(repoRoot, 'node_modules')],
        ['/', join(repoRoot, 'tests/evidence/certification/browser')],
    ];
}

export async function startHarnessServer(repoRoot = resolve('.')): Promise<HarnessServer> {
    const mounts = routes(repoRoot);
    const cacheRoot = join(repoRoot, HF_CACHE);
    const assetDigests: Record<string, string> = {};

    /** Fetch once, keep forever, and record the digest of what was served. */
    const mirrorAsset = async (relative: string): Promise<Buffer | null> => {
        const file = join(cacheRoot, relative);
        if (!file.startsWith(cacheRoot)) return null;
        if (existsSync(file)) {
            const bytes = readFileSync(file);
            assetDigests[relative] ??= createHash('sha256').update(bytes).digest('hex');
            return bytes;
        }
        const upstream = await fetch(`https://huggingface.co/${relative}`);
        if (!upstream.ok) return null;
        const bytes = Buffer.from(await upstream.arrayBuffer());
        mkdirSync(dirname(file), { recursive: true });
        // Write via a temporary name so an interrupted fetch cannot leave a truncated file that later
        // runs would happily serve and digest as if it were complete.
        const temporary = `${file}.partial`;
        writeFileSync(temporary, bytes);
        renameSync(temporary, file);
        assetDigests[relative] = createHash('sha256').update(bytes).digest('hex');
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
        assetDigests,
        close: () => new Promise<void>((done) => { server.close(() => done()); }),
    };
}
