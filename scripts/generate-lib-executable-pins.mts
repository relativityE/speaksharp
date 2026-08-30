/**
 * #1304 — pin the EXECUTABLE modules the harness serves from `/lib/`.
 *
 * `/runtime/` has always been pin-enforcing. `/lib/` was not, so a `.mjs` or `.wasm` served from
 * node_modules executed inside a measured arm with nothing binding WHICH bytes ran. The first preflight
 * caught them as `observed_not_declared`; declaring them is necessary but not sufficient, because a
 * declared-but-unpinned executable can still change under the same recorded identity.
 *
 * Each pin binds the file to its PACKAGE and LOCKED VERSION as well as its SHA-256, so a dependency bump
 * that swaps the bytes cannot pass as the same asset.
 *
 * Regenerate deliberately: `npx tsx scripts/generate-lib-executable-pins.mts`
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/** Packages whose executable modules the harness serves. */
const PACKAGES = [
    'onnxruntime-web/dist',
    // onnxruntime-common is pulled in as INDIVIDUAL ESM modules by the CPU/int8 route — 19 of them
    // executed in the first int8 preflight while none was pinned, because only onnxruntime-web was
    // covered here. The q4 arm never loads them, so the gap was invisible until int8 ran.
    'onnxruntime-common/dist',
    '@xenova/transformers/dist',
    '@huggingface/transformers/dist',
    '@moonshine-ai/moonshine-wasm',
];
const EXECUTABLE = /\.(mjs|js|wasm)$/;
const root = resolve('.');
const out: Record<string, { sha256: string; bytes: number; package: string; version: string }> = {};

const versionOf = (pkgDir: string): string => {
    // Walk up to the package root — `dist` is not the package.
    let dir = pkgDir;
    for (let i = 0; i < 4; i++) {
        try {
            const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { name?: string; version?: string };
            if (pkg.version) return `${pkg.name ?? 'unknown'}@${pkg.version}`;
        } catch { /* keep walking */ }
        dir = resolve(dir, '..');
    }
    return 'unknown';
};

for (const p of PACKAGES) {
    const dir = join(root, 'node_modules', p);
    let entries: string[];
    try { entries = readdirSync(dir, { recursive: true, encoding: 'utf8' }); } catch { continue; }
    const version = versionOf(dir);
    for (const rel of entries) {
        if (!EXECUTABLE.test(rel)) continue;
        const abs = join(dir, rel);
        try { if (!statSync(abs).isFile()) continue; } catch { continue; }
        const bytes = readFileSync(abs);
        // The key is the path AS SERVED: `/lib/` is mounted at node_modules.
        const key = `lib/${relative(join(root, 'node_modules'), abs)}`;
        out[key] = {
            sha256: createHash('sha256').update(bytes).digest('hex'),
            bytes: bytes.length,
            package: p,
            version,
        };
    }
}

const sorted = Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
writeFileSync('tests/fixtures/lib-executable-pins.json', `${JSON.stringify({
    note: 'Executable modules served from /lib/. Each binds package + locked version + SHA-256. '
        + 'An unpinned or mismatched executable makes the arm INELIGIBLE — cache-sourced is not an exemption.',
    assets: sorted,
}, null, 2)}\n`);
console.log(`wrote ${Object.keys(sorted).length} lib executable pins`);
