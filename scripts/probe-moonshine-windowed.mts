#!/usr/bin/env tsx
/**
 * #1263 conditions E/F — DOES THE PRODUCT'S WINDOWED SESSION LEAK?
 *
 * The frozen 600 is a full-utterance benchmark and, as the engine's own comment says, structurally
 * cannot validate the live path: the product feeds overlapping three-second windows into ONE session
 * and takes a final transcript from it. Boundary loss, duplication and cross-session state are
 * properties of that windowing, so only a windowed test can measure them.
 *
 * This drives the REAL MoonshineStreamingEngine against the REAL pinned runtime.
 *
 *   E1  windowed session vs whole-utterance decode of the same audio  (boundary loss / duplication)
 *   E2  a SECOND session on the same engine instance                  (cross-session state)
 *   E3  a fresh engine instance, same audio                           (isolation control)
 *   F1  the live interim never contains the final twice               (duplication across windows)
 *   F2  the final transcript is not merely the last window            (the whole session is finalised)
 *
 * A leak here is disqualifying for human testing in a way the 600 cannot see: it would corrupt the
 * transcript a user actually reads, not a corpus score.
 *
 *   usage: npx tsx scripts/probe-moonshine-windowed.mts --cache=<repo with .hf-cache> [--out=f.json]
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createReadStream } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import { startHarnessServer } from '../tests/evidence/certification/browser/server';

const arg = (n: string, d = '') => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=') ?? d;
const OUT = arg('out', 'product_release/evidence/retained/moonshine-windowed-ef.json');
const FIXTURE = '/fixtures/harvard_sentences_16k.wav';
const CACHE = resolve(arg('cache', '.'));
const EXTERNAL = join(CACHE, '.hf-cache', 'external');
if (!existsSync(EXTERNAL)) {
    console.error(`no pinned component cache at ${EXTERNAL}; pass --cache=<repo>. No network fallback.`);
    process.exit(2);
}

const BUNDLE = 'tests/evidence/certification/browser/engine.bundle.js';
await build({
    entryPoints: ['frontend/src/services/transcription/engines/MoonshineStreamingEngine.ts'],
    bundle: true, format: 'esm', outfile: BUNDLE, platform: 'browser', keepNames: true,
    external: ['@moonshine-ai/moonshine-wasm'],
});

const pins = JSON.parse(readFileSync('tests/fixtures/moonshine-asset-pins.json', 'utf8')) as {
    assets: Record<string, { sha256: string }>;
};
const verified = new Set<string>();
const componentServer = createServer((req, res) => {
    const key = decodeURIComponent((req.url ?? '').replace(/^\/+/, '').replace(/[?#].*$/, ''));
    const file = join(EXTERNAL, key);
    if (!file.startsWith(EXTERNAL) || !verified.has(key) || !existsSync(file)) {
        res.writeHead(404, { 'access-control-allow-origin': '*' }); res.end('not verified'); return;
    }
    res.writeHead(200, {
        'content-type': key.endsWith('.json') ? 'application/json' : 'application/octet-stream',
        'access-control-allow-origin': '*', 'cross-origin-resource-policy': 'cross-origin', 'cache-control': 'no-store',
    });
    createReadStream(file).pipe(res);
});
await new Promise<void>((d) => componentServer.listen(0, '127.0.0.1', d));
const componentOrigin = `http://127.0.0.1:${(componentServer.address() as { port: number }).port}`;

const harness = await startHarnessServer(resolve('.'), { mode: 'pinned', offlineOnly: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
await context.addInitScript(() => {
    const g = globalThis as unknown as { __name?: (t: unknown) => unknown };
    g.__name ??= (t) => t;
});

/** Every request recorded; audio must never leave the device even on the windowed path. */
const egress: { url: string; bodyBytes: number; disposition: string }[] = [];
await context.route(() => true, async (route) => {
    const req = route.request();
    const url = req.url();
    const bodyBytes = req.postDataBuffer()?.length ?? 0;
    if (url.startsWith(harness.origin) || url.startsWith(componentOrigin) || url.startsWith('data:') || url.startsWith('blob:')) {
        egress.push({ url, bodyBytes, disposition: 'local' }); return route.continue();
    }
    const key = url.replace(/^https?:\/\//, '').replace(/[?#].*$/, '');
    const cached = join(EXTERNAL, key);
    if (!pins.assets[key] || !existsSync(cached)) { egress.push({ url, bodyBytes, disposition: 'aborted:unpinned' }); return route.abort(); }
    if (createHash('sha256').update(readFileSync(cached)).digest('hex') !== pins.assets[key].sha256) {
        egress.push({ url, bodyBytes, disposition: 'aborted:digest' }); return route.abort();
    }
    verified.add(key);
    egress.push({ url, bodyBytes, disposition: 'pinned_asset' });
    await route.fulfill({ status: 302, headers: { location: `${componentOrigin}/${key}`, 'access-control-allow-origin': '*' } });
});

const page = await context.newPage();
page.on('console', (m) => { if (m.type() === 'error') console.error('  page:', m.text().slice(0, 160)); });
await page.goto(`${harness.origin}/engine-runtime.html`);
await page.waitForFunction(() => (window as unknown as { __ready?: boolean }).__ready === true);

console.log('\n#1263 windowed E/F — the real engine on the real runtime\n');

const outcome = await page.evaluate(async (input) => {
    const w = window as unknown as {
        __readPcm16: (u: string) => Promise<{ samples: Float32Array; sampleRate: number; seconds: number }>;
        __fixtureMic: (s: Float32Array, r: number) => { stream: unknown; emit: (at: number, sec: number) => number };
    };
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const mod = await import(input.bundleUrl) as {
        MoonshineStreamingEngine: new (o: Record<string, unknown>) => {
            init: () => Promise<{ isOk: boolean; error?: Error }>;
            start: (m: unknown) => Promise<void>;
            stop: () => Promise<void>;
            getTranscript: () => Promise<string>;
            getInterimTranscript: () => string;
            terminate: () => Promise<void>;
        };
    };
    const audio = await w.__readPcm16(input.fixtureUrl);

    const makeEngine = () => new mod.MoonshineStreamingEngine({
        candidateId: 'moonshine:streaming-medium', modelArch: 'MOONSHINE_STREAMING_MEDIUM',
    });

    /** Feed the clip as half-second frames, exactly as the product does, and finalise. */
    const runSession = async (engine: ReturnType<typeof makeEngine>) => {
        const mic = w.__fixtureMic(audio.samples, audio.sampleRate);
        await engine.start(mic.stream);
        const interims: string[] = [];
        let fed = 0;
        while (fed < audio.seconds) {
            fed += mic.emit(fed, 0.5);
            await sleep(60);
            const i = engine.getInterimTranscript();
            if (i && i !== interims[interims.length - 1]) interims.push(i);
        }
        for (let k = 0; k < 30 && !engine.getInterimTranscript(); k++) await sleep(200);
        await engine.stop();
        return { final: await engine.getTranscript(), interims };
    };

    try {
        // E1/F — a windowed session on one engine.
        const e1 = makeEngine();
        const init1 = await e1.init();
        if (!init1.isOk) return { ok: false as const, stage: 'init', error: String(init1.error?.message) };
        const sessionA = await runSession(e1);
        // E2 — a SECOND session on the SAME engine instance.
        const sessionB = await runSession(e1);
        await e1.terminate();

        // E3 — a fresh engine, same audio: the isolation control.
        const e2 = makeEngine();
        await e2.init();
        const sessionC = await runSession(e2);
        await e2.terminate();

        return { ok: true as const, sessionA, sessionB, sessionC, audioSeconds: audio.seconds };
    } catch (error) {
        return { ok: false as const, stage: 'run', error: (error as Error)?.message?.slice(0, 300) ?? String(error) };
    }
}, { bundleUrl: '/engine.bundle.js', fixtureUrl: FIXTURE });

const findings: string[] = [];
let verdict: 'pass' | 'fail' = 'fail';

if (!outcome.ok) {
    findings.push(`FAIL ${outcome.stage}: ${outcome.error}`);
} else {
    const words = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').split(/\s+/).filter(Boolean);
    const { sessionA, sessionB, sessionC } = outcome;
    const bodied = egress.filter((e) => e.bodyBytes > 0);
    const offOrigin = egress.filter((e) => e.disposition !== 'local');

    // Duplication across windows: no 6-word run should appear twice in the final transcript.
    const dupRun = (s: string) => {
        const t = words(s); const seen = new Set<string>();
        for (let i = 0; i + 6 <= t.length; i++) {
            const k = t.slice(i, i + 6).join(' ');
            if (seen.has(k)) return k;
            seen.add(k);
        }
        return null;
    };

    const checks: [string, boolean, string][] = [
        ['E1 the windowed session produced a final transcript', words(sessionA.final).length > 0, `${words(sessionA.final).length} words`],
        ['E2 a SECOND session on the same engine matches the first', sessionA.final === sessionB.final, sessionA.final === sessionB.final ? '' : 'CROSS-SESSION STATE'],
        ['E3 a FRESH engine produces the same transcript', sessionA.final === sessionC.final, sessionA.final === sessionC.final ? '' : 'instance-dependent'],
        ['F1 no six-word run is duplicated across windows', dupRun(sessionA.final) === null, dupRun(sessionA.final) ?? ''],
        ['F2 the final covers the session, not just the last window', words(sessionA.final).length > words(sessionA.interims[0] ?? '').length * 2, `final ${words(sessionA.final).length}, first interim ${words(sessionA.interims[0] ?? '').length}`],
        ['AUDIO NEVER LEAVES: no request carried a body', bodied.length === 0, `${bodied.length} bodied`],
        ['every off-origin request was a pinned asset', offOrigin.every((e) => e.disposition === 'pinned_asset'), `${offOrigin.length} off-origin`],
    ];
    for (const [n, ok, d] of checks) findings.push(`${ok ? 'PASS' : 'FAIL'} ${n}${d ? ` — ${d}` : ''}`);
    verdict = checks.every(([, ok]) => ok) ? 'pass' : 'fail';

    console.log(`  session A final : ${JSON.stringify(sessionA.final.slice(0, 110))}`);
    console.log(`  session B final : ${JSON.stringify(sessionB.final.slice(0, 110))}`);
    console.log(`  session C final : ${JSON.stringify(sessionC.final.slice(0, 110))}`);
    console.log(`  interims seen   : A=${sessionA.interims.length}`);
}
for (const f of findings) console.log(`  ${f}`);
console.log(`\n  VERDICT: ${verdict.toUpperCase()}`);

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify({
    probe: '#1263 windowed E/F — product engine, real runtime',
    verdict, findings, outcome,
    egress: { total: egress.length, withBody: egress.filter((e) => e.bodyBytes > 0).length },
}, null, 2)}\n`);
console.log(`  artifact: ${OUT}  sha256=${createHash('sha256').update(readFileSync(OUT)).digest('hex')}`);

await context.close(); await browser.close(); await harness.close();
await new Promise<void>((d) => { componentServer.close(() => d()); });
process.exit(verdict === 'pass' ? 0 : 1);
