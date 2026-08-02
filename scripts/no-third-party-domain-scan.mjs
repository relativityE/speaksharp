#!/usr/bin/env node
// #1148 — zero-reference scanner for the third-party, unaffiliated domain the Product Owner determined
// is NOT owned by or affiliated with SpeakSharp. Fails CI if any tracked text file reintroduces it.
//
// DENY/ALLOW authority model (generic — NOT competitor-specific business logic):
//   - DENY: the SpeakSharp brand token immediately followed by a dot-then-TLD, in any case, including
//     `www`/sub-domain prefixes and common URL/HTML encodings of the dot. The forbidden host is the brand
//     directly joined to the TLD.
//   - ALLOW: the approved release-proof authority `speaksharp-public.vercel.app` (brand + `-public.vercel.`
//     + TLD) never matches, because DENY requires the brand IMMEDIATELY followed by the dot+TLD.
//
// This file is itself scanned. It deliberately NEVER contains the forbidden contiguous string: the pattern
// is assembled from fragments at runtime, so the scanner cannot flag itself.

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const BRAND = 'speak' + 'sharp';   // SpeakSharp brand token (also present, legitimately, in the approved host)
const TLD = 'a' + 'pp';            // the third-party TLD
// The dot between brand and TLD: a plain dot, a regex-source ESCAPED dot (`\.` — how the domain hid inside a
// RegExp literal and evaded the naive audit), or common URL/HTML encodings (%2e, &#46;, &#x2e;).
const DOT = '(?:\\\\?\\.|%2e|&#46;|&#x2e;)';
// DENY = brand immediately followed by dot+TLD. `www.`/`alpha.` prefixes still contain this substring, so
// they are caught; the approved `-public.vercel.` host does not (brand is not immediately followed by the dot).
export const FORBIDDEN = new RegExp(BRAND + DOT + TLD, 'i');
export const FORBIDDEN_GLOBAL = new RegExp(BRAND + DOT + TLD, 'ig');

/** Return every matching substring in `text` (empty array = clean). */
export function scanText(text) {
    const m = text.match(FORBIDDEN_GLOBAL);
    return m ? [...m] : [];
}

// --- Binary / non-text exclusions: we scan tracked TEXT only. ---
const BINARY_EXT = new Set([
    'wav', 'mp3', 'ogg', 'flac', 'm4a', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'pdf', 'zip', 'gz',
    'tgz', 'br', 'woff', 'woff2', 'ttf', 'eot', 'onnx', 'bin', 'wasm', 'node', 'mp4', 'webm', 'avif',
]);
function looksBinary(buf) {
    const n = Math.min(buf.length, 8000);
    for (let i = 0; i < n; i++) if (buf[i] === 0) return true; // NUL byte → treat as binary
    return false;
}

function trackedFiles() {
    return execSync('git ls-files -z', { encoding: 'buffer' })
        .toString('utf8').split('\0').filter(Boolean);
}

function main() {
    const offenders = [];
    for (const file of trackedFiles()) {
        const ext = (file.split('.').pop() || '').toLowerCase();
        if (BINARY_EXT.has(ext)) continue;
        let buf;
        try { buf = readFileSync(file); } catch { continue; }
        if (looksBinary(buf)) continue;
        const text = buf.toString('utf8');
        const hits = scanText(text);
        if (hits.length) {
            text.split('\n').forEach((line, i) => {
                if (FORBIDDEN.test(line)) offenders.push(`${file}:${i + 1}`);
            });
        }
    }
    if (offenders.length) {
        console.error(`[no-third-party-domain] FAIL — ${offenders.length} reintroduced reference(s) to the forbidden third-party domain (#1148):`);
        for (const o of offenders) console.error(`  - ${o}`);
        console.error('Remove them; route support to the in-app Report issue action and use the approved Vercel host / injected test identities.');
        process.exit(1);
    }
    console.log('[no-third-party-domain] OK — zero references in tracked text.');
}

// Run as CLI only (so the contract test can import the matcher without scanning).
if (process.argv[1] && process.argv[1].endsWith('no-third-party-domain-scan.mjs')) main();
