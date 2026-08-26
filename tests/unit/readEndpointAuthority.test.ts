// #1306 / #1352 — BEHAVIOURAL tests for read authority.
//
// HISTORY WORTH KEEPING. Two earlier designs failed here first, which is the point of this file:
//   1. a hostname DENYLIST (`/pooler\.|read-replica|-replica|\.lb\./`) — proved nothing, since a
//      replica on any unlisted hostname passed it;
//   2. a REPLICA INVENTORY via `GET /v1/projects/{ref}/read-replicas` — an endpoint that does not
//      exist; the published spec has only `POST .../setup` and `POST .../remove`.
// Authority is now established POSITIVELY from the endpoint shape plus the project's own `ref`.
import { describe, it, expect } from 'vitest';
import {
    classifyFromProjectProbe, resolveReadAuthority, probeProject, probeFromResponse,
    projectRefFromUrl, isLoadBalancerHost, MANAGEMENT_API_TIMEOUT_MS,
} from '../helpers/readEndpointAuthority';

const REF = 'abcdefghijklmnopqrst';
const CANONICAL = `https://${REF}.supabase.co`;
const LOAD_BALANCER = `https://${REF}-all.supabase.co`;

describe('endpoint shape', () => {
    it('extracts the ref from the canonical host only', () => {
        expect(projectRefFromUrl(CANONICAL)).toBe(REF);
        expect(projectRefFromUrl(LOAD_BALANCER)).toBeNull();
        expect(projectRefFromUrl('https://db.mycompany.com')).toBeNull();
        expect(projectRefFromUrl('not a url')).toBeNull();
    });

    it('recognises the DOCUMENTED load-balancer host by name', () => {
        // `<ref>-all.supabase.co` routes to primary OR replica, so it can never prove primary. It gets
        // its own reason rather than being lumped in with malformed input.
        expect(isLoadBalancerHost(LOAD_BALANCER)).toBe(true);
        expect(isLoadBalancerHost(CANONICAL)).toBe(false);
    });
});

describe('classification', () => {
    it('PRIMARY-PROVEN requires canonical host AND a matching project ref', () => {
        const v = classifyFromProjectProbe(CANONICAL, { ok: true, ref: REF });
        expect(v.authority).toBe('primary-proven');
        expect(v.reason).toBe('canonical_project_endpoint');
        expect(v.maxClaim).toBe('persistence-defect');
    });

    it('the LOAD BALANCER is rejected with its own reason, even on a matching ref', () => {
        const v = classifyFromProjectProbe(LOAD_BALANCER, { ok: true, ref: REF });
        expect(v.authority).toBe('unknown');
        expect(v.reason).toBe('load_balancer_endpoint');
    });

    it('a REF MISMATCH is unknown — the URL does not belong to this project', () => {
        const v = classifyFromProjectProbe(CANONICAL, { ok: true, ref: 'zzzzzzzzzzzzzzzzzzzz' });
        expect(v.authority).toBe('unknown');
        expect(v.reason).toBe('ref_mismatch');
    });

    it('custom domains and malformed URLs are non_canonical_endpoint', () => {
        const urls = ['https://db.mycompany.com', 'https://api.supabase.co', 'not a url', ''];
        const got = urls.map((u) => `${u} -> ${classifyFromProjectProbe(u, { ok: true, ref: REF }).reason}`);
        expect(got).toEqual(urls.map((u) => `${u} -> non_canonical_endpoint`));
    });

    it('API error and malformed response fail closed', () => {
        expect(classifyFromProjectProbe(CANONICAL, { ok: false, failure: 'api_error' }).reason).toBe('api_error');
        expect(classifyFromProjectProbe(CANONICAL, { ok: false, failure: 'malformed_response' }).reason)
            .toBe('malformed_response');
    });

    it('NO path other than canonical-host-plus-matching-ref reaches primary-proven', () => {
        const cases = [
            classifyFromProjectProbe(LOAD_BALANCER, { ok: true, ref: REF }),
            classifyFromProjectProbe(CANONICAL, { ok: true, ref: 'other' }),
            classifyFromProjectProbe(CANONICAL, { ok: false, failure: 'api_error' }),
            classifyFromProjectProbe(CANONICAL, { ok: false, failure: 'malformed_response' }),
            classifyFromProjectProbe('https://x.example.com', { ok: true, ref: REF }),
        ];
        for (const v of cases) expect(v.maxClaim).toBe('read-path-disagreement-authority-unknown');
    });
});

describe('response validation', () => {
    it('a 2xx body carrying a string ref is ok', () => {
        expect(probeFromResponse(200, { ref: REF, name: 'x' })).toEqual({ ok: true, ref: REF });
    });

    it('non-2xx is api_error', () => {
        for (const s of [301, 401, 403, 404, 500]) {
            expect(probeFromResponse(s, { ref: REF }).ok, `status=${s}`).toBe(false);
        }
    });

    it('a body without a usable ref is malformed, never assumed to match', () => {
        for (const b of [null, undefined, [], 'str', 42, {}, { ref: 123 }, { ref: '' }]) {
            const p = probeFromResponse(200, b);
            expect(p.ok, `body=${JSON.stringify(b)}`).toBe(false);
            expect(p.ok === false && p.failure).toBe('malformed_response');
        }
    });
});

describe('the request is BOUNDED and fails closed', () => {
    const args = { ref: REF, token: 'unused-in-tests' };
    const hanging = (_u: string, init: { signal: AbortSignal }) =>
        new Promise<never>((_r, reject) => { init.signal.addEventListener('abort', () => reject(new Error('AbortError'))); });

    it('TIMEOUT resolves to api_error and actually terminates on the bound', async () => {
        const started = Date.now();
        expect(await probeProject({ ...args, fetchImpl: hanging as never, timeoutMs: 40 }))
            .toEqual({ ok: false, failure: 'api_error' });
        expect(Date.now() - started).toBeLessThan(2_000);
    });

    it('TIMEOUT feeds through to unknown/api_error', async () => {
        const probe = await probeProject({ ...args, fetchImpl: hanging as never, timeoutMs: 40 });
        const v = classifyFromProjectProbe(CANONICAL, probe);
        expect(v.authority).toBe('unknown');
        expect(v.reason).toBe('api_error');
    });

    it('network rejection, non-2xx and bad JSON all fail closed', async () => {
        const net = () => Promise.reject(new Error('ENOTFOUND'));
        const notFound = () => Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
        const badJson = () => Promise.resolve({ ok: true, status: 200, json: () => Promise.reject(new Error('bad')) });
        expect(await probeProject({ ...args, fetchImpl: net as never })).toEqual({ ok: false, failure: 'api_error' });
        expect(await probeProject({ ...args, fetchImpl: notFound as never })).toEqual({ ok: false, failure: 'api_error' });
        expect(await probeProject({ ...args, fetchImpl: badJson as never })).toEqual({ ok: false, failure: 'malformed_response' });
    });

    it('a good response yields the project ref', async () => {
        const ok = () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ref: REF }) });
        expect(await probeProject({ ...args, fetchImpl: ok as never })).toEqual({ ok: true, ref: REF });
    });

    it('calls the documented PROJECT endpoint, not the nonexistent replica list', async () => {
        // The exact defect the standalone preflight caught: `/read-replicas` is not a GET endpoint.
        let calledUrl = '';
        const spy = (u: string) => {
            calledUrl = u;
            return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ref: REF }) });
        };
        await probeProject({ ...args, fetchImpl: spy as never });
        expect(calledUrl).toBe(`https://api.supabase.com/v1/projects/${REF}`);
        expect(calledUrl).not.toContain('read-replicas');
    });

    it('the abort signal really reaches fetch — the bound is not decorative', async () => {
        let sawSignal = false;
        const check = (_u: string, init: { signal: AbortSignal }) => {
            sawSignal = init.signal instanceof AbortSignal;
            return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ref: REF }) });
        };
        await probeProject({ ...args, fetchImpl: check as never });
        expect(sawSignal).toBe(true);
    });

    it('the default bound is finite and small', () => {
        expect(Number.isFinite(MANAGEMENT_API_TIMEOUT_MS)).toBe(true);
        expect(MANAGEMENT_API_TIMEOUT_MS).toBeGreaterThan(0);
        expect(MANAGEMENT_API_TIMEOUT_MS).toBeLessThanOrEqual(30_000);
    });
});

describe('resolving the preflight verdict from the environment', () => {
    it('accepts only the exact proven pair', () => {
        expect(resolveReadAuthority({
            PROOF_READ_AUTHORITY: 'primary-proven', PROOF_READ_AUTHORITY_REASON: 'canonical_project_endpoint',
        }).authority).toBe('primary-proven');
    });

    it('an unprobed environment resolves to unknown/not_probed', () => {
        const v = resolveReadAuthority({});
        expect(v.authority).toBe('unknown');
        expect(v.reason).toBe('not_probed');
    });

    it('a proven claim with a mismatched or forged reason is rejected', () => {
        for (const reason of ['load_balancer_endpoint', 'ref_mismatch', 'api_error', 'made-up', undefined]) {
            expect(resolveReadAuthority({
                PROOF_READ_AUTHORITY: 'primary-proven', PROOF_READ_AUTHORITY_REASON: reason,
            }).authority, `reason=${reason}`).toBe('unknown');
        }
    });
});
