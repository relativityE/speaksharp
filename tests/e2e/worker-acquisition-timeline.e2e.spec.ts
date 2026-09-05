import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';

/**
 * #1259 — THE PREMISE OF THE WHOLE CORRECTION, MEASURED RATHER THAN CITED.
 *
 * v2 and v4 fetch their models inside a Web Worker. The acquisition telemetry originally read
 * `window.performance` on the main thread, and the claim that this cannot see a worker's requests came
 * from documentation, not from measurement — the same weakness as the defect it was fixing.
 *
 * So a real worker fetches a real asset in a real browser, and BOTH timelines are asked what they saw.
 * If the main window could see worker fetches, the correction would be unnecessary and this test would
 * say so.
 *
 * SELF-CONTAINED ON PURPOSE. It stands up its own origin, loads no application, needs no build, no
 * credentials and no MSW — so it runs identically here and in CI, and it never navigates the shared
 * `page` fixture. `Timing-Allow-Origin` is sent because a cross-origin response without it reports
 * zeroed sizes, and a zero would make this prove the opposite of what it is measuring.
 */
function serveAsset() {
    return new Promise<{ url: string; close: () => Promise<void> }>((res) => {
        const server = createServer((req, reply) => {
            const body = Buffer.alloc(64 * 1024, 7); // a real, sized transfer
            reply.writeHead(200, {
                'content-type': 'application/octet-stream',
                'content-length': String(body.length),
                'timing-allow-origin': '*',
                'access-control-allow-origin': '*',
            });
            reply.end(req.method === 'HEAD' ? undefined : body);
        });
        server.listen(0, '127.0.0.1', () => {
            const { port } = server.address() as { port: number };
            res({
                url: `http://127.0.0.1:${port}/models/encoder.onnx`,
                close: () => new Promise((r) => { server.close(() => r()); }),
            });
        });
    });
}

test('#1259 a worker fetch appears on the WORKER timeline and not on the window timeline', async ({ page }) => {
    const asset = await serveAsset();
    try {
        // No navigation: the document is established in place, so the shared `page` fixture is never
        // pointed at another origin and the app's own routing is left entirely alone.
        await page.setContent('<!doctype html><html><body><div id="root"></div></body></html>');

        const result = await page.evaluate(async (target) => {
            const src = `
                self.onmessage = async () => {
                    // The body MUST be drained: fetch() resolves on HEADERS, and a resource entry is
                    // only recorded once the response body is fully received. Reading the timeline
                    // straight after the await finds nothing at all.
                    const res = await fetch(${JSON.stringify(target)}, { cache: 'no-store' });
                    await res.arrayBuffer();
                    await new Promise((r) => setTimeout(r, 50));
                    const entries = performance.getEntriesByType('resource')
                        .filter((e) => e.name.indexOf('/models/') !== -1);
                    self.postMessage({
                        workerSaw: entries.length,
                        transferSize: entries[0] ? entries[0].transferSize : null,
                    });
                };
            `;
            const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
            const worker = new Worker(url);
            const fromWorker = await new Promise<{ workerSaw: number; transferSize: number | null }>((resolve) => {
                worker.onmessage = (e) => resolve(e.data);
                worker.postMessage('go');
            });
            const windowSaw = performance.getEntriesByType('resource')
                .filter((e) => e.name.indexOf('/models/') !== -1).length;
            worker.terminate();
            URL.revokeObjectURL(url);
            return { fromWorker, windowSaw };
        }, asset.url);

        // THE WORKER SEES ITS OWN FETCH, with real transferred bytes.
        expect(result.fromWorker.workerSaw, 'the worker timeline must record the model request').toBeGreaterThan(0);
        expect(result.fromWorker.transferSize, 'and it must report real transferred bytes').toBeGreaterThan(0);

        // THE MAIN WINDOW DOES NOT. This is why the observation had to move into the worker.
        expect(result.windowSaw,
            'if the window could see worker fetches, reading window.performance would have been fine')
            .toBe(0);
    } finally {
        await asset.close();
    }
});
