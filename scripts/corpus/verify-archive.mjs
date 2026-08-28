#!/usr/bin/env node
/**
 * #1304 — layered integrity verification for a corpus archive, run BEFORE extraction.
 *
 * WHY LAYERED, AND WHY IN THIS ORDER.
 *
 *   1. BYTE COUNT  — cheapest, and catches a truncated or resumed-wrong download immediately.
 *                    On its own it is NOT integrity: a corrupted file of the correct length passes.
 *   2. OFFICIAL MD5 — the value OpenSLR publishes (`md5sum.txt`). This is the only hash whose
 *                    expectation comes from the corpus's own publisher rather than from us, so it is
 *                    what establishes that we downloaded THEIR artifact. MD5 is weak against a
 *                    deliberate collision but entirely adequate against corruption, and using the
 *                    published value is the point.
 *   3. SHA-256      — our own stronger reproducibility pin, computed ONLY AFTER the official MD5
 *                    passes. Computing it first would pin whatever we happened to receive: a hash
 *                    recorded after download is transcription, not verification. That was the defect
 *                    in the first version of the fetch script, which wrote `sha256sum` of the
 *                    downloaded file into CHECKSUMS and called it a pin.
 *
 * Extraction happens only if every declared layer passes. A failure returns a NAMED reason.
 */
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';

/** OpenSLR SLR12 official MD5s, from https://www.openslr.org/resources/12/md5sum.txt (read 2026-08-27). */
export const OFFICIAL_MD5 = {
    'test-clean.tar.gz': '32fa31d27d2e1cad72775fee3f4849a9',
    'test-other.tar.gz': 'fb5a50374b501bb3bac4815ee91d3135',
};

/** Byte counts read from the server's Content-Length (2026-08-27). */
export const EXPECTED_BYTES = {
    'test-clean.tar.gz': 346663984,
    'test-other.tar.gz': 328757843,
};

/**
 * SpeakSharp's SHA-256 pins. EMPTY until an operator runs a verified fetch and commits the values
 * this tool prints — deliberately not pre-filled, because a pin nobody computed from a verified
 * artifact is a guess wearing a hash's clothes.
 */
export const PINNED_SHA256 = {};

export async function hashFile(path, algorithm) {
    return new Promise((resolve, reject) => {
        const h = createHash(algorithm);
        createReadStream(path)
            .on('data', (chunk) => h.update(chunk))
            .on('error', reject)
            .on('end', () => resolve(h.digest('hex')));
    });
}

/**
 * Verify one archive. Returns `{ ok: true, sha256 }` or `{ ok: false, reason, detail }`.
 *
 * `pinnedSha256` is optional ONLY for the first verified fetch, which is what produces it. Once a pin
 * exists it must be supplied, and a mismatch fails — otherwise the pin is decorative.
 */
export async function verifyArchive({ path, name, expectedBytes, expectedMd5, pinnedSha256 }) {
    let size;
    try {
        size = (await stat(path)).size;
    } catch {
        return { ok: false, reason: 'missing_file', detail: path };
    }

    if (expectedBytes !== undefined && size !== expectedBytes) {
        return { ok: false, reason: 'byte_count_mismatch', detail: `${size} != ${expectedBytes}` };
    }

    // The official hash decides whether this is the publisher's artifact. A correct byte count with a
    // wrong MD5 is precisely the corrupted-download case a size check cannot see.
    const md5 = await hashFile(path, 'md5');
    if (expectedMd5 !== undefined && md5 !== expectedMd5) {
        return { ok: false, reason: 'official_md5_mismatch', detail: `${md5} != ${expectedMd5}` };
    }

    // Only now is our own pin computed or checked.
    const sha256 = await hashFile(path, 'sha256');
    if (pinnedSha256 !== undefined && sha256 !== pinnedSha256) {
        return { ok: false, reason: 'pinned_sha256_mismatch', detail: `${sha256} != ${pinnedSha256}` };
    }

    return { ok: true, name, bytes: size, md5, sha256, pinnedSha256Checked: pinnedSha256 !== undefined };
}

async function main() {
    const [path, name] = process.argv.slice(2);
    if (!path || !name) {
        console.error('usage: verify-archive.mjs <path> <archive-name>');
        process.exit(2);
    }
    const result = await verifyArchive({
        path, name,
        expectedBytes: EXPECTED_BYTES[name],
        expectedMd5: OFFICIAL_MD5[name],
        pinnedSha256: PINNED_SHA256[name],
    });
    if (!result.ok) {
        console.error(`FAIL ${name}: ${result.reason} (${result.detail})`);
        console.error('Refusing to extract. The archive is not the published artifact.');
        process.exit(1);
    }
    console.log(`OK   ${name}  bytes=${result.bytes}  md5=${result.md5}`);
    console.log(`     sha256=${result.sha256}${result.pinnedSha256Checked ? ' (matched pin)' : ' (NO PIN YET — commit this value)'}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
