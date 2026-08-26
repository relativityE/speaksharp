// #1306 — BEHAVIOURAL tests for the read-authority classifier.
//
// The previous guard was an `[advisory]` source scan: it checked that a denylist regex appeared in the
// spec. That proved the text existed, not that the classification was correct — and the denylist was
// wrong anyway, since a replica on an unlisted hostname passed it. These EXECUTE the classifier.
import { describe, it, expect } from 'vitest';
import {
    classifyFromReplicaProbe, resolveReadAuthority, probeReplicas, MANAGEMENT_API_TIMEOUT_MS,
} from '../helpers/readEndpointAuthority';

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


describe('the Management API request is BOUNDED and fails closed', () => {
    const args = { ref: 'abcdefghijklmnopqrst', token: 'unused-in-tests' };

    it('TIMEOUT: a request that never settles resolves to api_error, not a hang', async () => {
        // The defect this closes: an unbounded fetch inside a "bounded" preflight. A credential,
        // network or API stall would hang the step rather than produce a verdict — the same shape as a
        // harness waiting forty minutes for a control that never renders.
        const hangingFetch = (_u: string, init: { signal: AbortSignal }) =>
            new Promise<never>((_resolve, reject) => {
                init.signal.addEventListener('abort', () => reject(new Error('AbortError')));
            });
        const started = Date.now();
        const probe = await probeReplicas({ ...args, fetchImpl: hangingFetch as never, timeoutMs: 40 });
        expect(probe).toEqual({ ok: false, failure: 'api_error' });
        // It really terminated on the bound rather than resolving some other way.
        expect(Date.now() - started).toBeLessThan(2_000);
    });

    it('TIMEOUT feeds through to authority=unknown/api_error', async () => {
        const hangingFetch = (_u: string, init: { signal: AbortSignal }) =>
            new Promise<never>((_r, reject) => { init.signal.addEventListener('abort', () => reject(new Error('AbortError'))); });
        const probe = await probeReplicas({ ...args, fetchImpl: hangingFetch as never, timeoutMs: 40 });
        const v = classifyFromReplicaProbe('https://abcdefghijklmnopqrst.supabase.co', probe);
        expect(v.authority).toBe('unknown');
        expect(v.reason).toBe('api_error');
        expect(v.maxClaim).toBe('read-path-disagreement-authority-unknown');
    });

    it('a NETWORK rejection also resolves to api_error', async () => {
        const failing = () => Promise.reject(new Error('ENOTFOUND'));
        expect(await probeReplicas({ ...args, fetchImpl: failing as never })).toEqual({ ok: false, failure: 'api_error' });
    });

    it('a non-2xx response resolves to api_error', async () => {
        const notFound = () => Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
        expect(await probeReplicas({ ...args, fetchImpl: notFound as never })).toEqual({ ok: false, failure: 'api_error' });
    });

    it('an unparseable body resolves to malformed_response', async () => {
        const badJson = () => Promise.resolve({ ok: true, status: 200, json: () => Promise.reject(new Error('bad json')) });
        expect(await probeReplicas({ ...args, fetchImpl: badJson as never })).toEqual({ ok: false, failure: 'malformed_response' });
    });

    it('a non-array body resolves to malformed_response, never "no replicas"', async () => {
        const obj = () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ replicas: [] }) });
        expect(await probeReplicas({ ...args, fetchImpl: obj as never })).toEqual({ ok: false, failure: 'malformed_response' });
    });

    it('an empty array is the only ok/zero result', async () => {
        const empty = () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) });
        expect(await probeReplicas({ ...args, fetchImpl: empty as never })).toEqual({ ok: true, replicaCount: 0 });
    });

    it('replicas are counted from the array length', async () => {
        const two = () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([{}, {}]) });
        expect(await probeReplicas({ ...args, fetchImpl: two as never })).toEqual({ ok: true, replicaCount: 2 });
    });

    it('the default bound is finite and small', () => {
        expect(Number.isFinite(MANAGEMENT_API_TIMEOUT_MS)).toBe(true);
        expect(MANAGEMENT_API_TIMEOUT_MS).toBeGreaterThan(0);
        expect(MANAGEMENT_API_TIMEOUT_MS).toBeLessThanOrEqual(30_000);
    });

    it('the abort signal is actually passed to fetch — the bound is not decorative', async () => {
        let sawSignal = false;
        const check = (_u: string, init: { signal: AbortSignal }) => {
            sawSignal = init.signal instanceof AbortSignal;
            return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) });
        };
        await probeReplicas({ ...args, fetchImpl: check as never });
        expect(sawSignal).toBe(true);
    });
});
