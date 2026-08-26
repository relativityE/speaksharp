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
// SINGLE IMPLEMENTATION. URL parsing, response validation and authority selection all come from the
// TypeScript helper the unit tests execute. This script previously re-implemented all three, so the
// tested classifier and the one that actually runs in production could drift apart silently while
// every classifier test stayed green. Run with `node --experimental-strip-types` — Node is pinned to
// 22.12.0 by .nvmrc, which supports it.
import { projectRefFromUrl, probeReplicas, classifyFromReplicaProbe }
    from '../tests/helpers/readEndpointAuthority.ts';

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
const ref = projectRefFromUrl(url);

if (!ref) emit('unknown', 'non_canonical_endpoint');
if (!token) emit('unknown', 'not_probed');

// The request is BOUNDED and fail-closed inside the tested helper: abort, network failure, non-2xx,
// unparseable or non-array body all resolve to a probe the classifier reads as `unknown`.
const probe = await probeReplicas({ fetchImpl: fetch, ref, token });
const verdict = classifyFromReplicaProbe(url, probe);
emit(verdict.authority, verdict.reason);
