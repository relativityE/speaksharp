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
 * `configuredPrimary` must come from a SEPARATE configuration value naming the authoritative primary
 * (URL or bare host). Comparing the read URL to itself would prove nothing, so an absent or unusable
 * value yields `unknown` rather than a default pass.
 */
export function classifyReadEndpoint(readUrl: string, configuredPrimary?: string | null): ReadEndpointVerdict {
    const readHost = host(readUrl);
    if (!readHost) {
        return {
            authority: 'unknown',
            reason: 'read URL is not parseable',
            maxClaim: 'read-path-disagreement-authority-unknown',
        };
    }
    const trimmed = (configuredPrimary ?? '').trim();
    if (!trimmed) {
        return {
            authority: 'unknown',
            reason: 'no authoritative primary endpoint configured; a read cannot vouch for itself',
            maxClaim: 'read-path-disagreement-authority-unknown',
        };
    }
    const primaryHost = trimmed.includes('://') ? host(trimmed) : trimmed.toLowerCase();
    if (!primaryHost) {
        return {
            authority: 'unknown',
            reason: 'configured primary endpoint is not parseable',
            maxClaim: 'read-path-disagreement-authority-unknown',
        };
    }
    if (primaryHost !== readHost) {
        return {
            authority: 'unknown',
            reason: 'read host does not match the configured primary host',
            maxClaim: 'read-path-disagreement-authority-unknown',
        };
    }
    return {
        authority: 'primary-proven',
        reason: 'read host matches the separately configured authoritative primary',
        maxClaim: 'persistence-defect',
    };
}
