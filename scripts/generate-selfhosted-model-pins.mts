/**
 * #1304 — pin the product's SELF-HOSTED model assets.
 *
 * `frontend/public/models/**` is served to the browser as the product's own weights, and no pin registry
 * covered it: the HF registry covers the mirror, the lib registry covers node_modules. The incumbent
 * `v2:base.en` therefore could not pass committed-pin verification at all — a real qualification gap,
 * not a matcher artifact.
 *
 * Regenerate deliberately: `npx tsx scripts/generate-selfhosted-model-pins.mts`
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const ROOT = resolve('frontend/public/models');
const out: Record<string, { sha256: string; bytes: number; source: string }> = {};

let entries: string[] = [];
try { entries = readdirSync(ROOT, { recursive: true, encoding: 'utf8' }); } catch { entries = []; }
for (const rel of entries) {
    const abs = join(ROOT, rel);
    try { if (!statSync(abs).isFile()) continue; } catch { continue; }
    const bytes = readFileSync(abs);
    out[relative(ROOT, abs)] = {
        sha256: createHash('sha256').update(bytes).digest('hex'),
        bytes: bytes.length,
        source: 'product-self-hosted:frontend/public/models',
    };
}
const sorted = Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
writeFileSync('tests/fixtures/selfhosted-model-pins.json', `${JSON.stringify({
    note: 'Product self-hosted model assets served from /models/. Keys are paths relative to '
        + 'frontend/public/models. These are the bytes the shipping product loads.',
    assets: sorted,
}, null, 2)}\n`);
console.log(`wrote ${Object.keys(sorted).length} self-hosted model pins`);
