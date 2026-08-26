#!/usr/bin/env node
// #1306 — READ-ONLY Management API preflight: does this project have read replicas?
//
// WHY. The #1306 proof compares a v2 completion envelope against a subsequent row read. If those
// disagree, the verdict depends on whether the read could have been served by an asynchronously
// replicated replica. Guessing from a hostname denylist proved nothing, and copying SUPABASE_URL into
// a second variable would prove only that two variables hold the same value. This asks the source.
//
// DELIBERATELY NARROW. `primary-proven` requires BOTH the exact canonical `<ref>.supabase.co` host
// AND the Management API confirming that host's ref is this project's ref. The documented
// `<ref>-all.supabase.co` load balancer routes to primary OR replica and is rejected by name; custom
// domains, mismatched refs and malformed URLs are all `unknown`.
//
// An earlier design called `GET /v1/projects/{ref}/read-replicas`, which DOES NOT EXIST — the
// published spec has only `POST .../setup` and `POST .../remove`. The standalone preflight caught that
// as a 404 before any production run, which is what that workflow exists for.
//
// SECURITY. GET only. The token, the project reference, the URL and the response body are NEVER
// printed. Output is two derived tokens and nothing else. Every failure path is `unknown`.
import { appendFileSync } from 'node:fs';
// SINGLE IMPLEMENTATION. URL parsing, response validation and authority selection all come from the
// TypeScript helper the unit tests execute. This script previously re-implemented all three, so the
// tested classifier and the one that actually runs in production could drift apart silently while
// every classifier test stayed green. Run with `node --experimental-strip-types` — Node is pinned to
// 22.12.0 by .nvmrc, which supports it.
import { projectRefFromUrl, isLoadBalancerHost, probeProject, classifyFromProjectProbe }
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
// The documented load balancer is rejected BY NAME, with its own reason, before anything else.
if (isLoadBalancerHost(url)) emit('unknown', 'load_balancer_endpoint');

const ref = projectRefFromUrl(url);
if (!ref) emit('unknown', 'non_canonical_endpoint');
if (!token) emit('unknown', 'not_probed');

// The request is BOUNDED and fail-closed inside the tested helper: abort, network failure, non-2xx
// and malformed bodies all resolve to a probe the classifier reads as `unknown`.
const probe = await probeProject({ fetchImpl: fetch, ref, token });
const verdict = classifyFromProjectProbe(url, probe);
emit(verdict.authority, verdict.reason);
