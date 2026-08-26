// #1306 — is a read PROVABLY from the primary, or merely not-obviously-a-replica?
//
// WHY THIS EXISTS. The first version tested the hostname against a denylist
// (`/pooler\.|read-replica|-replica|\.lb\./`). That is not proof of anything: a load-balanced or
// replica endpoint on any other hostname passes it, and the proof would then label a possibly-stale
// read "primary". Supabase states plainly that load-balanced GETs may reach asynchronously
// replicated replicas, so a read routed there can legitimately lag the primary.
//
// A denylist can only ever say "not one of the names I thought of". Authority has to be POSITIVELY
// established, and when it cannot be, the honest answer is `unknown` — which then WEAKENS the verdict
// a disagreement can support, rather than silently strengthening it.

export type ReadAuthority = 'primary-proven' | 'unknown';

export interface ReadEndpointVerdict {
    authority: ReadAuthority;
    reason: string;
    /** The strongest claim a row/envelope disagreement may be reported as under this authority. */
    maxClaim: 'persistence-defect' | 'read-path-disagreement-authority-unknown';
}

const host = (u: string): string | null => {
    try { return new URL(u).hostname.toLowerCase(); } catch { return null; }
};

/** A read-only Management API probe of the project's replica inventory. */
export type ReplicaProbe =
    | { ok: true; replicaCount: number }
    | { ok: false; failure: 'api_error' | 'malformed_response' };

export type AuthorityReason =
    | 'no_read_replicas'
    | 'replicas_present'
    | 'api_error'
    | 'malformed_response'
    | 'non_canonical_endpoint'
    | 'not_probed';

/** `https://<ref>.supabase.co` — the canonical per-project Data API endpoint. */
const CANONICAL_PROJECT_ENDPOINT = /^[a-z0-9]{20}\.supabase\.co$/;

export interface ProbeVerdict {
    authority: ReadAuthority;
    reason: AuthorityReason;
    maxClaim: ReadEndpointVerdict['maxClaim'];
}

const unknown = (reason: AuthorityReason): ProbeVerdict => ({
    authority: 'unknown', reason, maxClaim: 'read-path-disagreement-authority-unknown',
});

/**
 * Classify read authority from a replica inventory.
 *
 * DELIBERATELY NARROW. An empty replica list plus a canonical project endpoint is the only case that
 * yields `primary-proven`, because it is the only case where "there is nowhere else the read could
 * have gone" actually follows. When replicas EXIST, Supabase exposes dedicated replica endpoints and a
 * separate load-balancer endpoint, and replicas lag asynchronously — an inventory alone cannot then
 * establish which endpoint served a given read, so this reports `unknown` rather than guessing.
 *
 * Everything else fails closed: an API error, a malformed body, or a non-canonical endpoint is
 * `unknown`, never a default pass.
 */
export function classifyFromReplicaProbe(readUrl: string, probe: ReplicaProbe): ProbeVerdict {
    const h = host(readUrl);
    if (!h || !CANONICAL_PROJECT_ENDPOINT.test(h)) return unknown('non_canonical_endpoint');
    if (!probe.ok) return unknown(probe.failure);
    if (!Number.isInteger(probe.replicaCount) || probe.replicaCount < 0) return unknown('malformed_response');
    if (probe.replicaCount > 0) return unknown('replicas_present');
    return { authority: 'primary-proven', reason: 'no_read_replicas', maxClaim: 'persistence-defect' };
}

/**
 * Read the preflight's DERIVED verdict out of the environment. The preflight runs in a step that can
 * see the management token; this cannot. Anything unrecognized is `unknown`.
 */
export function resolveReadAuthority(env: Record<string, string | undefined>): ProbeVerdict {
    const a = env.PROOF_READ_AUTHORITY;
    const r = env.PROOF_READ_AUTHORITY_REASON;
    const reasons: AuthorityReason[] = [
        'no_read_replicas', 'replicas_present', 'api_error', 'malformed_response',
        'non_canonical_endpoint', 'not_probed',
    ];
    const reason = reasons.includes(r as AuthorityReason) ? (r as AuthorityReason) : 'not_probed';
    if (a === 'primary-proven' && reason === 'no_read_replicas') {
        return { authority: 'primary-proven', reason, maxClaim: 'persistence-defect' };
    }
    return unknown(reason);
}

/**
 * `https://<ref>.supabase.co` -> `<ref>`; anything else -> null.
 *
 * Lives here, not in the preflight script, because the script previously RE-IMPLEMENTED this and the
 * response validation below. Two implementations mean the tested one can stay green while the one
 * that actually runs in production drifts — the tests would be measuring the wrong code.
 */
export function projectRefFromUrl(url: string): string | null {
    const h = host(url);
    const m = h ? /^([a-z0-9]{20})\.supabase\.co$/.exec(h) : null;
    return m ? m[1] : null;
}

/**
 * Turn a Management API response into a probe result. A replica inventory MUST be a list; anything
 * else is malformed and is never assumed to mean "no replicas".
 */
export function probeFromResponse(status: number, body: unknown): ReplicaProbe {
    if (status < 200 || status >= 300) return { ok: false, failure: 'api_error' };
    if (!Array.isArray(body)) return { ok: false, failure: 'malformed_response' };
    return { ok: true, replicaCount: body.length };
}

/**
 * Hard bound on the Management API request.
 *
 * An unbounded `fetch` inside a "bounded" preflight is the same failure shape as a harness waiting
 * forty minutes for a control that never renders: a credential, network or API stall would hang the
 * step rather than resolve to a verdict. The probe must always terminate, and it must terminate as
 * `unknown` — never as a pass.
 */
export const MANAGEMENT_API_TIMEOUT_MS = 15_000;

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; signal: AbortSignal })
    => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

/**
 * Ask the Management API for the replica inventory, bounded and fail-closed.
 *
 * `fetchImpl` is injected so the timeout, abort, network-failure and malformed-body paths are covered
 * by real executed tests rather than by hoping the script behaves. Every failure — abort, rejection,
 * non-2xx, unparseable body, non-array body — resolves to a probe the classifier treats as `unknown`.
 */
export async function probeReplicas(args: {
    fetchImpl: FetchLike;
    ref: string;
    token: string;
    timeoutMs?: number;
    endpoint?: string;
}): Promise<ReplicaProbe> {
    const { fetchImpl, ref, token } = args;
    const timeoutMs = args.timeoutMs ?? MANAGEMENT_API_TIMEOUT_MS;
    const endpoint = args.endpoint ?? 'https://api.supabase.com/v1/projects';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetchImpl(`${endpoint}/${ref}/read-replicas`, {
            method: 'GET',
            headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
            signal: controller.signal,
        });
        if (!res.ok) return { ok: false, failure: 'api_error' };
        let body: unknown = null;
        try { body = await res.json(); } catch { return { ok: false, failure: 'malformed_response' }; }
        return probeFromResponse(res.status, body);
    } catch {
        // Abort (timeout), DNS/TLS/network failure — all indistinguishable from the caller's point of
        // view and all equally non-evidence. `api_error`, never a pass.
        return { ok: false, failure: 'api_error' };
    } finally {
        clearTimeout(timer);
    }
}
