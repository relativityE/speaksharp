// #1306 — BEHAVIOURAL tests for the read-authority classifier.
//
// The previous guard was an `[advisory]` source scan: it checked that a denylist regex appeared in the
// spec. That proved the text existed, not that the classification was correct — and the denylist was
// wrong anyway, since a replica on an unlisted hostname passed it. These EXECUTE the classifier.
import { describe, it, expect } from 'vitest';
import { classifyFromReplicaProbe, resolveReadAuthority } from '../helpers/readEndpointAuthority';

const CANONICAL = 'https://abcdefghijklmnopqrst.supabase.co';

describe('replica-inventory probe -> authority', () => {
    it('EMPTY replicas on a canonical endpoint is the ONLY primary-proven case', () => {
        const v = classifyFromReplicaProbe(CANONICAL, { ok: true, replicaCount: 0 });
        expect(v.authority).toBe('primary-proven');
        expect(v.reason).toBe('no_read_replicas');
        expect(v.maxClaim).toBe('persistence-defect');
    });

    it('REPLICAS PRESENT is unknown — an inventory cannot say which endpoint served a read', () => {
        // Supabase exposes dedicated replica endpoints AND a separate load balancer, and replicas lag
        // asynchronously. Knowing replicas exist is not knowing where the read went.
        for (const n of [1, 3]) {
            const v = classifyFromReplicaProbe(CANONICAL, { ok: true, replicaCount: n });
            expect(v.authority).toBe('unknown');
            expect(v.reason).toBe('replicas_present');
        }
    });

    it('API FAILURE fails closed to unknown', () => {
        const v = classifyFromReplicaProbe(CANONICAL, { ok: false, failure: 'api_error' });
        expect(v.authority).toBe('unknown');
        expect(v.reason).toBe('api_error');
    });

    it('MALFORMED response fails closed to unknown', () => {
        expect(classifyFromReplicaProbe(CANONICAL, { ok: false, failure: 'malformed_response' }).reason)
            .toBe('malformed_response');
        // A non-integer or negative count is malformed, never "no replicas".
        for (const bad of [1.5, -1, Number.NaN]) {
            const v = classifyFromReplicaProbe(CANONICAL, { ok: true, replicaCount: bad });
            expect(v.authority, `count=${bad}`).toBe('unknown');
            expect(v.reason).toBe('malformed_response');
        }
    });

    it('a NON-CANONICAL endpoint is unknown even with zero replicas', () => {
        // Context travels in the asserted VALUE so a failure names the offending URL without the
        // two-argument `expect` form this repo's lint config disallows.
        const urls = ['https://db-ro-eu-west-1.example.com', 'https://pooler.supabase.com', 'not a url'];
        const verdicts = urls.map((u) => `${u} -> ${classifyFromReplicaProbe(u, { ok: true, replicaCount: 0 }).reason}`);
        expect(verdicts).toEqual(urls.map((u) => `${u} -> non_canonical_endpoint`));
    });

    it('NO PATH other than empty-replicas-on-canonical can reach primary-proven', () => {
        const cases = [
            classifyFromReplicaProbe(CANONICAL, { ok: true, replicaCount: 1 }),
            classifyFromReplicaProbe(CANONICAL, { ok: false, failure: 'api_error' }),
            classifyFromReplicaProbe(CANONICAL, { ok: false, failure: 'malformed_response' }),
            classifyFromReplicaProbe('https://x.example.com', { ok: true, replicaCount: 0 }),
        ];
        for (const v of cases) expect(v.maxClaim).toBe('read-path-disagreement-authority-unknown');
    });
});

describe('resolving the preflight verdict from the environment', () => {
    it('accepts only the exact proven pair', () => {
        const v = resolveReadAuthority({
            PROOF_READ_AUTHORITY: 'primary-proven', PROOF_READ_AUTHORITY_REASON: 'no_read_replicas',
        });
        expect(v.authority).toBe('primary-proven');
    });

    it('REMOVED SECRET WIRING: an unprobed environment resolves to unknown/not_probed', () => {
        // Exactly what happens if the preflight step or its token wiring is deleted.
        const v = resolveReadAuthority({});
        expect(v.authority).toBe('unknown');
        expect(v.reason).toBe('not_probed');
    });

    it('a proven claim with a mismatched or forged reason is rejected', () => {
        for (const reason of ['replicas_present', 'api_error', 'totally-made-up', undefined]) {
            const v = resolveReadAuthority({
                PROOF_READ_AUTHORITY: 'primary-proven', PROOF_READ_AUTHORITY_REASON: reason,
            });
            expect(v.authority, `reason=${reason}`).toBe('unknown');
        }
    });

    it('an unrecognized authority value cannot pass', () => {
        expect(resolveReadAuthority({ PROOF_READ_AUTHORITY: 'trust-me' }).authority).toBe('unknown');
    });
});
