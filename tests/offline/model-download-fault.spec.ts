import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { holdModelWeight } from '../live/helpers/rwtHeldModelWeight';

const pins = JSON.parse(readFileSync('frontend/src/services/transcription/selfHostedAssetPins.json', 'utf8'));
const weightPath = `${pins.servedFrom}/onnx/encoder_model_quantized.onnx`;
let server: Server;
let origin: string;
test.beforeAll(async () => {
    server = createServer((req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Content-Type', req.url === '/' ? 'text/html' : 'application/octet-stream');
        // Synthetic fixture bytes, deliberately not an ONNX model or model download.
        res.end(req.url === '/' ? '<!doctype html><title>Local weight-request fixture</title>' : Buffer.from([1, 2, 3, 4]));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('local fixture has no TCP address');
    origin = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });

test('held exact weight request is in flight before fault; same-context retry recovers', async ({ page, context }) => {
    await page.goto(origin);
    const requests: unknown[] = [];
    context.on('request', (request) => { if (new URL(request.url()).pathname === weightPath) requests.push(request); });
    const fault = await holdModelWeight(context, origin, weightPath);
    try {
        await page.evaluate((path) => {
            const w = window as Window & { fixtureResult?: Promise<string>; fixtureSettled?: boolean };
            w.fixtureSettled = false;
            w.fixtureResult = fetch(path).then(async (response) => `bytes:${(await response.arrayBuffer()).byteLength}`, () => 'fetch_failed')
                .finally(() => { w.fixtureSettled = true; });
        }, weightPath);
        expect(await fault.waitUntilHeld()).toBe(true);
        expect(await page.evaluate(() => (window as Window & { fixtureSettled?: boolean }).fixtureSettled)).toBe(false);
        expect(fault.evidence()).toEqual({ matched: true, injected: false, failed: false, errorText: null, exercised: false });
        expect(await fault.inject()).toEqual({ matched: true, injected: true, failed: true, errorText: 'net::ERR_INTERNET_DISCONNECTED', exercised: true });
        expect(await page.evaluate(() => (window as Window & { fixtureResult?: Promise<string> }).fixtureResult)).toBe('fetch_failed');
    } finally { await fault.dispose(); }
    expect(await page.evaluate(async (path) => (await (await fetch(path)).arrayBuffer()).byteLength, weightPath)).toBe(4);
    expect(requests).toHaveLength(2);
    expect(requests[1]).not.toBe(requests[0]);
});

test('fault not exercised: unrelated model metadata does not satisfy the held weight match', async ({ page, context }) => {
    await page.goto(origin);
    const fault = await holdModelWeight(context, origin, weightPath);
    try {
        expect(await page.evaluate(async () => (await fetch('/models/whisper-base.en/config.json')).ok)).toBe(true);
        expect(await fault.waitUntilHeld(100)).toBe(false);
        await expect(fault.inject()).rejects.toThrow(/model_fault_not_exercised/);
        expect(fault.evidence().exercised).toBe(false);
    } finally { await fault.dispose(); }
});

test('fault not exercised: an offline lease confirmation failure cannot count as model failure', async ({ page, context }) => {
    await page.goto(origin);
    const fault = await holdModelWeight(context, origin, weightPath);
    await context.route('**/functions/v1/confirm-recording-lease', (route) => route.abort('internetdisconnected'));
    try {
        expect(await page.evaluate(async () => fetch('/functions/v1/confirm-recording-lease').then(() => 'ok', () => 'lease_failed'))).toBe('lease_failed');
        expect(await fault.waitUntilHeld(100)).toBe(false);
        expect(fault.evidence()).toEqual({ matched: false, injected: false, failed: false, errorText: null, exercised: false });
    } finally { await fault.dispose(); }
});
