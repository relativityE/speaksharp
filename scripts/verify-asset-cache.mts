#!/usr/bin/env tsx
/**
 * #1304 — verify, and optionally repair, every locally cached benchmark asset.
 *
 * A pinned run fails closed on a corrupt cache entry, which is correct but leaves an operator with a
 * refused arm and no obvious next step. Cache corruption is not hypothetical: two entries were found
 * bad on one machine while the same pins verified cleanly on another, so this must be a routine check
 * rather than a diagnosis someone performs after a run dies.
 *
 * Repair RE-FETCHES only entries that fail their committed digest, and re-verifies after writing. It
 * never edits a pin to match a file — that would be curing the symptom by destroying the evidence.
 *
 *   usage: npx tsx scripts/verify-asset-cache.mts [--repair]
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const repair = process.argv.includes('--repair');

interface Manifest {
    label: string;
    file: string;
    cacheRoot: string;
    /** How to turn a manifest key back into a download URL. */
    url: (key: string) => string;
    read: (raw: string) => Record<string, string>;
}

const MANIFESTS: Manifest[] = [
    {
        label: 'huggingface',
        file: 'tests/fixtures/hf-asset-pins.json',
        cacheRoot: '.hf-cache',
        url: (key) => `https://huggingface.co/${key}`,
        read: (raw) => (JSON.parse(raw) as { assets: Record<string, string> }).assets,
    },
    {
        label: 'moonshine',
        file: 'tests/fixtures/moonshine-asset-pins.json',
        cacheRoot: join('.hf-cache', 'external'),
        url: (key) => `https://${key}`,
        read: (raw) => Object.fromEntries(
            Object.entries((JSON.parse(raw) as { assets: Record<string, { sha256: string }> }).assets)
                .map(([k, v]) => [k, v.sha256]),
        ),
    },
];

let totalValid = 0;
let totalPins = 0;
const failures: { manifest: string; key: string; reason: string }[] = [];

for (const manifest of MANIFESTS) {
    if (!existsSync(manifest.file)) {
        console.log(`  ${manifest.label}: no pin manifest at ${manifest.file}`);
        continue;
    }
    const pins = manifest.read(readFileSync(manifest.file, 'utf8'));
    totalPins += Object.keys(pins).length;
    let valid = 0;

    for (const [key, expected] of Object.entries(pins)) {
        const path = join(manifest.cacheRoot, key);
        const digestOf = () => createHash('sha256').update(readFileSync(path)).digest('hex');

        if (existsSync(path) && digestOf() === expected) { valid += 1; continue; }

        const reason = existsSync(path) ? 'digest_mismatch' : 'missing';
        if (!repair) { failures.push({ manifest: manifest.label, key, reason }); continue; }

        process.stdout.write(`  repairing (${reason}) ${key} … `);
        try {
            const response = await fetch(manifest.url(key));
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const body = Buffer.from(await response.arrayBuffer());
            mkdirSync(dirname(path), { recursive: true });
            writeFileSync(path, body);
            // Re-verify AFTER writing: a re-fetch that still mismatches means the pin and upstream
            // disagree, which is a much more serious finding than a corrupt local copy.
            if (digestOf() !== expected) {
                console.log('STILL MISMATCHED after re-fetch');
                failures.push({ manifest: manifest.label, key, reason: 'upstream_disagrees_with_pin' });
                continue;
            }
            console.log('repaired');
            valid += 1;
        } catch (error) {
            console.log(`FAILED (${(error as Error).message})`);
            failures.push({ manifest: manifest.label, key, reason: `refetch_failed: ${(error as Error).message}` });
        }
    }

    console.log(`  ${manifest.label}: ${valid}/${Object.keys(pins).length} valid`);
    totalValid += valid;
}

console.log(`\n${totalValid}/${totalPins} cache digests valid`);
if (failures.length > 0) {
    console.log('\nFAILURES — a pinned run will refuse these:');
    for (const f of failures) console.log(`  ${f.reason}  ${f.manifest}/${f.key}`);
    console.log(repair ? '\nRe-run after resolving the above.' : '\nRe-run with --repair to re-fetch.');
    process.exit(1);
}
console.log('Every pinned asset is present and matches its committed digest.');
