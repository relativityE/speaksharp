#!/usr/bin/env node
// #1306 — READ-ONLY Management API preflight: does this project have read replicas?
//
// WHY. The #1306 proof compares a v2 completion envelope against a subsequent row read. If those
// disagree, the verdict depends on whether the read could have been served by an asynchronously
// replicated replica. Guessing from a hostname denylist proved nothing, and copying SUPABASE_URL into
// a second variable would prove only that two variables hold the same value. This asks the source.
//
// DELIBERATELY NARROW. An empty replica list is the only positive result. When replicas exist,
// Supabase exposes dedicated replica endpoints AND a separate load-balancer endpoint, so an inventory
// cannot say which one served a given read — that reports `unknown`, not a guess.
//
// SECURITY. GET only. The token, the project reference, the URL and the response body are NEVER
// printed. Output is two derived tokens and nothing else. Every failure path is `unknown`.
import { appendFileSync } from 'node:fs';

const AUTHORITY_ENDPOINT = 'https://api.supabase.com/v1/projects';

/** `https://<ref>.supabase.co` -> `<ref>`; anything else -> null. */
function projectRef(url) {
    try {
        const h = new URL(url).hostname;
        const m = /^([a-z0-9]{20})\.supabase\.co$/.exec(h);
        return m ? m[1] : null;
    } catch { return null; }
}

function emit(authority, reason) {
    // The ONLY output. No token, no ref, no URL, no body.
    console.log(`authority=${authority}`);
    console.log(`reason=${reason}`);
    if (process.env.GITHUB_ENV) {
        appendFileSync(process.env.GITHUB_ENV,
            `PROOF_READ_AUTHORITY=${authority}\nPROOF_READ_AUTHORITY_REASON=${reason}\n`);
    }
    // Exit 0 always: an unresolved authority CAPS the proof's verdict, it does not fail the run.
    process.exit(0);
}

const url = process.env.SUPABASE_URL ?? '';
const token = process.env.SUPABASE_ACCESS_TOKEN ?? '';
const ref = projectRef(url);

if (!ref) emit('unknown', 'non_canonical_endpoint');
if (!token) emit('unknown', 'not_probed');

let res;
try {
    res = await fetch(`${AUTHORITY_ENDPOINT}/${ref}/read-replicas`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
} catch {
    emit('unknown', 'api_error');
}

if (!res.ok) emit('unknown', 'api_error');

let body;
try { body = await res.json(); } catch { emit('unknown', 'malformed_response'); }

// A replica inventory must be a list. Anything else is malformed — never assumed empty.
if (!Array.isArray(body)) emit('unknown', 'malformed_response');
if (body.length > 0) emit('unknown', 'replicas_present');
emit('primary-proven', 'no_read_replicas');
