import { test, expect } from '@playwright/test';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { promisify } from 'node:util';
import { resolve } from 'node:path';

const execFileAsync = promisify(execFile);

/**
 * #1390 Stage 1 — the Preview verifier must RUN the page, not read it.
 *
 * PLACED IN THE E2E SUITE DELIBERATELY. These drive a real Chromium, and they previously sat in the unit
 * suite where no browser binary is installed — so every case failed with "verification could not
 * complete" and took `unit-shard-4` red with it. A browser test belongs where browsers exist; the e2e
 * shards install them.
 *
 * THE RETURNED DEFECT. The previous verifier inspected served HTML and bundle text. That cannot decide
 * PASS: the switch module ships in BOTH builds, so its identifiers are present either way, and the
 * install is gated at runtime. A build whose install never executes — leaving the window surfaces
 * undefined — passed every text check, and the operator would have been handed a "verified" Preview on
 * which the three-model comparison is impossible.
 *
 * These serve two pages that are DELIBERATELY indistinguishable by text: both reference a chunk naming
 * the switch surfaces and both inline the internal-build literal. They differ only in whether the
 * install actually runs. A text-based verifier passes both. A runtime verifier passes exactly one.
 */
const SHA = 'a'.repeat(40);
const VERIFIER = resolve(process.cwd(), 'scripts/ci/verify-internal-preview.mjs');

/** Text that would satisfy any bundle-grep check, present in BOTH fixtures. */
const DECOY_CHUNK = `
  // installRuntimeSwitch chunk text: VITE_INTERNAL_BUILD:"true"
  // mentions __SS_SWITCH_CANDIDATE__ and __SS_ACTIVE_CANDIDATE__ without installing them
`;

const page = ({ install, release = SHA }) => `<!doctype html>
<html><head><title>fixture</title>
<script>window.__APP_RELEASE__=${JSON.stringify(release)};</script>
<script>/*${DECOY_CHUNK}*/</script>
</head><body>
<div id="root"><!-- the element the SPA mounts into; its presence is how a served page is told
     apart from the platform's own 404, which answers 200 in some rewrite misconfigurations --></div>
<script>
${install ? `
  window.__SS_SWITCH_CANDIDATE__ = async (id) => ({ ok: true, id });
  window.__SS_ACTIVE_CANDIDATE__ = () => ({ requested: 'v2:base.en', observed: null, matches: false, source: 'runtime_switch' });
` : `
  /* The install is gated and does not run. The identifiers above are still in the served text. */
`}
</script>
</body></html>`;

/**
 * Serve one fixture and return its origin.
 *
 * THE FIXTURE MUST BE A TRUTHFUL STAND-IN FOR A DEPLOYMENT, not merely a page that satisfies the
 * assertions of the day. It previously served bare HTML with no headers and 200'd every path with a
 * shell containing no app root — so once the verifier began requiring cross-origin isolation and a
 * working SPA fallback, the positive control was no longer a valid configured deployment and the
 * verifier correctly rejected it. The fixture was wrong, not the verifier.
 *
 * `isolated` sends the COOP/COEP pair the product's vercel.json configures, which is what makes
 * `crossOriginIsolated` true (127.0.0.1 is already a secure context). `spaFallback` decides whether an
 * unknown path serves the app, as the rewrite does, or answers the platform's 404.
 */
function serve(html, { isolated = true, spaFallback = true } = {}) {
    return new Promise((res) => {
        const server = createServer((req, reply) => {
            const isRoot = (req.url ?? '/') === '/';
            const headers = { 'content-type': 'text/html' };
            if (isolated) {
                headers['cross-origin-opener-policy'] = 'same-origin';
                headers['cross-origin-embedder-policy'] = 'credentialless';
            }
            if (!isRoot && !spaFallback) {
                // What a deployment root WITHOUT the rewrite does to every deep link.
                reply.writeHead(404, headers);
                reply.end('<!doctype html><html><head><title>404: NOT_FOUND</title></head><body>DEPLOYMENT_NOT_FOUND</body></html>');
                return;
            }
            reply.writeHead(200, headers);
            reply.end(html);
        });
        server.listen(0, '127.0.0.1', () => {
            const { port } = server.address();
            res({ url: `http://127.0.0.1:${port}/`, close: () => new Promise((r) => server.close(r)) });
        });
    });
}

async function runVerifier(url, sha = SHA) {
    try {
        const { stdout } = await execFileAsync('node', [VERIFIER, url, sha], { timeout: 180_000 });
        return { code: 0, out: stdout };
    } catch (e) {
        return { code: e.code ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
    }
}

let installed;
let notInstalled;

test.beforeAll(async () => {
    installed = await serve(page({ install: true }));
    notInstalled = await serve(page({ install: false }));
});

test.afterAll(async () => {
    await installed?.close();
    await notInstalled?.close();
});

test.describe('#1390 verifier — runtime installation decides PASS, not served text', () => {
    test('CASUALTY: a page containing the switch text but NOT installing it FAILS', async () => {
        // This is the exact page the returned verifier passed.
        const r = await runVerifier(notInstalled.url);
        expect(r.code).not.toBe(0); // an uninstalled runtime must not verify
        expect(r.out).toMatch(/__SS_SWITCH_CANDIDATE__ is not a function|verification FAILED/);
    });

    test('POSITIVE CONTROL: a page that actually installs the surfaces PASSES', async () => {
        const r = await runVerifier(installed.url);
        if (r.code !== 0) console.error(r.out); // surface the verifier's own output on failure
        expect(r.code).toBe(0);
        expect(r.out).toMatch(/typeof window\.__SS_SWITCH_CANDIDATE__: function/);
        expect(r.out).toMatch(/typeof window\.__SS_ACTIVE_CANDIDATE__: function/);
        expect(r.out).toMatch(/PASSED \(evaluated on the running page\)/);
    });

    test('CASUALTY: a mismatched runtime release FAILS even when the surfaces install', async () => {
        const wrong = await serve(page({ install: true, release: 'b'.repeat(40) }));
        try {
            const r = await runVerifier(wrong.url);
            expect(r.code).not.toBe(0);
            expect(r.out).toMatch(/does not equal the requested SHA/);
        } finally {
            await wrong.close();
        }
    });

    test('CASUALTY: an unreachable Preview FAILS CLOSED rather than being skipped', async () => {
        // "Could not check" must never read as "checked and fine".
        const r = await runVerifier('http://127.0.0.1:1/');
        expect(r.code).not.toBe(0);
        expect(r.out).toMatch(/verification could not complete|verification FAILED/);
    });

    test('CASUALTY: a Preview WITHOUT COOP/COEP fails, however well the switch installs', async () => {
        // This is a deploy root that excluded vercel.json. The switch surfaces are perfect and the page
        // still cannot give the Private engine SharedArrayBuffer, so the operator could not record.
        const unisolated = await serve(page({ install: true }), { isolated: false });
        try {
            const r = await runVerifier(unisolated.url);
            expect(r.code).not.toBe(0);
            expect(r.out).toMatch(/crossOriginIsolated is false|Cross-Origin-Opener-Policy is not/);
        } finally {
            await unisolated.close();
        }
    });

    test('CASUALTY: a Preview whose deep links 404 fails, however well the root page works', async () => {
        // The missing SPA fallback rewrite. The root URL verifies happily; every route the operator
        // actually navigates to during a take is a platform 404.
        const noFallback = await serve(page({ install: true }), { spaFallback: false });
        try {
            const r = await runVerifier(noFallback.url);
            expect(r.code).not.toBe(0);
            expect(r.out).toMatch(/did not serve the app|SPA\s+fallback/);
        } finally {
            await noFallback.close();
        }
    });

    test('the verifier never prints the bypass secret', async () => {
        const r = await runVerifier(installed.url, SHA);
        expect(r.out).not.toMatch(/x-vercel-protection-bypass/i);
        // Source-level too: the value must not reach a log line.
        const src = await import('node:fs').then((fs) => fs.readFileSync(VERIFIER, 'utf8'));
        expect(src).not.toMatch(/console\.(log|error)\([^)]*bypass/i);
    });
});
