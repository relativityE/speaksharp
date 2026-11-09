/* eslint-env node */
import path from 'node:path';

/**
 * One serving policy for everything under /models/ (release review of 1816ec61, P2).
 *
 * Package admission keeps active document TYPES out of the served tree, but an admitted model file can still hold
 * HTML-shaped bytes. Served without a Content-Type (Vite's static server knows no type for .onnx, .data, .ort or an
 * extension-less LICENSE) and without nosniff, a browser that navigates to it sniffs and renders that HTML on the
 * application origin. Every model response therefore gets an explicit non-executable type and nosniff, on every
 * serving path: the Vite dev and preview servers and the E2E server use this module, and vercel.json carries the same
 * table (tests/evidence/__tests__/modelAssetServing.test.ts holds the two together).
 *
 * The reviewed runtime files keep a JavaScript or WASM type: their consumers require it, and nosniff makes the browser
 * enforce it. A navigation to one renders text, never a document.
 */
export const MODEL_ASSET_PREFIX = '/models/';

export const MODEL_ASSET_CONTENT_TYPES = Object.freeze({
    json: 'application/json',
    txt: 'text/plain; charset=utf-8',
    onnx: 'application/octet-stream',
    data: 'application/octet-stream',
    bin: 'application/octet-stream',
    ort: 'application/octet-stream',
    js: 'text/javascript; charset=utf-8',
    mjs: 'text/javascript; charset=utf-8',
    cjs: 'text/javascript; charset=utf-8',
    wasm: 'application/wasm',
});

/** Extension-less files (licence and notice texts) are plain text. */
export const MODEL_ASSET_EXTENSIONLESS_TYPE = 'text/plain; charset=utf-8';

/** Any other name under /models/ is opaque bytes: never a document type. */
export const MODEL_ASSET_FALLBACK_TYPE = 'application/octet-stream';

function servedPathname(url) {
    const raw = String(url ?? '').split(/[?#]/, 1)[0];
    let decoded = raw;
    try { decoded = decodeURIComponent(raw); } catch { /* keep the raw path; it is still matched below */ }
    return path.posix.normalize(decoded.replace(/\\/g, '/'));
}

/** The headers a response for this request path must carry, or null when the path is not a model asset. */
export function modelAssetHeaders(url) {
    const pathname = servedPathname(url);
    if (!pathname.startsWith(MODEL_ASSET_PREFIX)) return null;
    const name = pathname.slice(pathname.lastIndexOf('/') + 1);
    const dot = name.lastIndexOf('.');
    const type = dot === -1 ? MODEL_ASSET_EXTENSIONLESS_TYPE
        : MODEL_ASSET_CONTENT_TYPES[name.slice(dot + 1).toLowerCase()] ?? MODEL_ASSET_FALLBACK_TYPE;
    return { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff' };
}

const OWNED = new Set(['content-type', 'x-content-type-options']);

function withoutOwnedHeaders(headers) {
    if (Array.isArray(headers)) {
        const kept = [];
        for (let i = 0; i < headers.length; i += 2) if (!OWNED.has(String(headers[i]).toLowerCase())) kept.push(headers[i], headers[i + 1]);
        return kept;
    }
    return Object.fromEntries(Object.entries(headers).filter(([key]) => !OWNED.has(key.toLowerCase())));
}

/**
 * Connect/Express middleware. The static servers set Content-Type at different points (send() via setHeader only when
 * none is set; sirv in the headers it passes to writeHead), so the policy is applied at writeHead itself and wins
 * over either. An implicit header write (res.end without writeHead) also goes through writeHead.
 */
export function modelAssetHeadersMiddleware() {
    return function modelAssetHeadersMiddleware(req, res, next) {
        const headers = modelAssetHeaders(req.url);
        if (!headers) return next();
        for (const [key, value] of Object.entries(headers)) res.setHeader(key, value);
        const writeHead = res.writeHead;
        res.writeHead = function writeModelAssetHead(statusCode, ...rest) {
            for (const [key, value] of Object.entries(headers)) this.setHeader(key, value);
            const index = rest.findIndex(arg => arg !== null && typeof arg === 'object');
            if (index !== -1) rest[index] = withoutOwnedHeaders(rest[index]);
            return writeHead.call(this, statusCode, ...rest);
        };
        return next();
    };
}

/** Vite plugin: the same middleware ahead of Vite's own static handling, in dev and in preview. */
export function modelAssetHeadersPlugin() {
    const middleware = modelAssetHeadersMiddleware();
    return {
        name: 'speaksharp-model-asset-headers',
        configureServer(server) { server.middlewares.use(middleware); },
        configurePreviewServer(server) { server.middlewares.use(middleware); },
    };
}
