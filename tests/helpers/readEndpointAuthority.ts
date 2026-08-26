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

/**
 * A read-only Management API probe of the documented project endpoint, `GET /v1/projects/{ref}`.
 *
 * WHY NOT A REPLICA INVENTORY. The previous design called `GET /v1/projects/{ref}/read-replicas`,
 * which DOES NOT EXIST — Supabase's published OpenAPI spec documents only `POST .../setup` and
 * `POST .../remove`. The standalone preflight caught it as a 404 before any production run, which is
 * exactly what that workflow is for. No documented read-only endpoint enumerates replicas, so
 * authority is established from the ENDPOINT SHAPE plus the project's own authoritative `ref`.
 */
export type ProjectProbe =
    | { ok: true; ref: string | null }
    | { ok: false; failure: 'api_error' | 'malformed_response' };

export type AuthorityReason =
    | 'canonical_project_endpoint'
    | 'load_balancer_endpoint'
    | 'non_canonical_endpoint'
    | 'ref_mismatch'
    | 'api_error'
    | 'malformed_response'
    | 'not_probed';

/**
 * The canonical per-project Data API host. Deliberately strict: exactly the 20-character project ref
 * followed by `.supabase.co`, nothing else.
 */
const CANONICAL_PROJECT_ENDPOINT = /^([a-z0-9]{20})\.supabase\.co$/;

/**
 * Supabase's documented read-replica LOAD BALANCER host, which routes to primary OR replica and is
 * therefore never a proof of primary. Named explicitly so it is rejected with its own reason rather
 * than lumped in with malformed input — a distinct failure deserves a distinct diagnosis.
 */
const LOAD_BALANCER_ENDPOINT = /^([a-z0-9]{20})-all\.supabase\.co$/;

export interface ProbeVerdict {
    authority: ReadAuthority;
    reason: AuthorityReason;
    maxClaim: ReadEndpointVerdict['maxClaim'];
}

const unknown = (reason: AuthorityReason): ProbeVerdict => ({
    authority: 'unknown', reason, maxClaim: 'read-path-disagreement-authority-unknown',
});

/**
 * Is this the EXACT canonical origin — `https://<ref>.supabase.co`, and nothing more?
 *
 * Validating `hostname` alone was insufficient and would have classified as `primary-proven` any of:
 *   http://<ref>.supabase.co            (plaintext — a downgrade, not the canonical Data API)
 *   https://user:pass@<ref>.supabase.co (embedded credentials)
 *   https://<ref>.supabase.co:8443      (a non-default port is a different listener)
 *   https://<ref>.supabase.co/rest/v1   (a path — a proxy or rewrite could route anywhere)
 *   https://<ref>.supabase.co/?x=1      (query)  and  ...#frag  (fragment)
 * Every one of those shares the canonical hostname while being a different endpoint, so the check has
 * to be on the whole URL. `pathname` of a bare origin is `/`, so `/` is the only path accepted.
 */
function canonicalParts(url: string): { hostname: string } | null {
    let u: URL;
    try { u = new URL(url); } catch { return null; }
    if (u.protocol !== 'https:') return null;
    if (u.username !== '' || u.password !== '') return null;
    if (u.port !== '') return null;
    if (u.pathname !== '/' && u.pathname !== '') return null;
    if (u.search !== '' || u.hash !== '') return null;
    return { hostname: u.hostname.toLowerCase() };
}

/** `https://<ref>.supabase.co` -> `<ref>`. Any other URL shape yields null. */
export function projectRefFromUrl(url: string): string | null {
    const parts = canonicalParts(url);
    const m = parts ? CANONICAL_PROJECT_ENDPOINT.exec(parts.hostname) : null;
    return m ? m[1] : null;
}

/** True only for the documented `<ref>-all.supabase.co` load-balancer host. */
export function isLoadBalancerHost(url: string): boolean {
    const h = host(url);
    return !!h && LOAD_BALANCER_ENDPOINT.test(h);
}

/** Turn a `GET /v1/projects/{ref}` response into a probe result. */
export function probeFromResponse(status: number, body: unknown): ProjectProbe {
    if (status < 200 || status >= 300) return { ok: false, failure: 'api_error' };
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return { ok: false, failure: 'malformed_response' };
    }
    const ref = (body as { ref?: unknown }).ref;
    if (typeof ref !== 'string' || ref.length === 0) return { ok: false, failure: 'malformed_response' };
    return { ok: true, ref };
}

/**
 * Classify read authority from the endpoint shape and the project's authoritative `ref`.
 *
 * `primary-proven` requires BOTH: the URL is the exact canonical project host, AND the Management API
 * confirms that host's ref is this project's ref. Everything else — load balancer, custom domain,
 * malformed URL, ref mismatch, API error, malformed body — is `unknown`, never a default pass.
 */
export function classifyFromProjectProbe(readUrl: string, probe: ProjectProbe): ProbeVerdict {
    if (isLoadBalancerHost(readUrl)) return unknown('load_balancer_endpoint');
    const urlRef = projectRefFromUrl(readUrl);
    if (!urlRef) return unknown('non_canonical_endpoint');
    if (!probe.ok) return unknown(probe.failure);
    if (probe.ref !== urlRef) return unknown('ref_mismatch');
    return { authority: 'primary-proven', reason: 'canonical_project_endpoint', maxClaim: 'persistence-defect' };
}

/**
 * Read the preflight's DERIVED verdict out of the environment. The preflight runs in a step that can
 * see the management token; this cannot. Anything unrecognized is `unknown`.
 */
export function resolveReadAuthority(env: Record<string, string | undefined>): ProbeVerdict {
    const a = env.PROOF_READ_AUTHORITY;
    const r = env.PROOF_READ_AUTHORITY_REASON;
    const reasons: AuthorityReason[] = [
        'canonical_project_endpoint', 'load_balancer_endpoint', 'non_canonical_endpoint',
        'ref_mismatch', 'api_error', 'malformed_response', 'not_probed',
    ];
    const reason = reasons.includes(r as AuthorityReason) ? (r as AuthorityReason) : 'not_probed';
    if (a === 'primary-proven' && reason === 'canonical_project_endpoint') {
        return { authority: 'primary-proven', reason, maxClaim: 'persistence-defect' };
    }
    return unknown(reason);
}

export const MANAGEMENT_API_TIMEOUT_MS = 15_000;

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; signal: AbortSignal })
    => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

/**
 * Fetch `GET /v1/projects/{ref}`, bounded and fail-closed. `fetchImpl` is injected so the timeout,
 * abort, network-failure and malformed-body paths are covered by executed tests.
 */
export async function probeProject(args: {
    fetchImpl: FetchLike;
    ref: string;
    token: string;
    timeoutMs?: number;
    endpoint?: string;
}): Promise<ProjectProbe> {
    const { fetchImpl, ref, token } = args;
    const timeoutMs = args.timeoutMs ?? MANAGEMENT_API_TIMEOUT_MS;
    const endpoint = args.endpoint ?? 'https://api.supabase.com/v1/projects';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetchImpl(`${endpoint}/${ref}`, {
            method: 'GET',
            headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
            signal: controller.signal,
        });
        if (!res.ok) return { ok: false, failure: 'api_error' };
        let body: unknown = null;
        try { body = await res.json(); } catch { return { ok: false, failure: 'malformed_response' }; }
        return probeFromResponse(res.status, body);
    } catch {
        // Abort (timeout), DNS/TLS/network failure — all equally non-evidence.
        return { ok: false, failure: 'api_error' };
    } finally {
        clearTimeout(timer);
    }
}
