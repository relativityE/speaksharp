// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createAccountClosureAttestationTransport } from '../../scripts/lib/accountClosureAttestationTransport.mjs';
import { fixture } from '../helpers/accountClosureAttestationFixture.mjs';

const id = '11111111-1111-4111-8111-111111111111';
const config = { url: 'https://project-test.supabase.co', projectId: 'project-test', environment: 'disposable', serviceKey: 'test-service-key' };
const invalidate = (generation = '7') => ({ expectedGeneration: generation, reason: 'deployment_changed', evidenceDigest: 'f'.repeat(64) });
function setup(response = () => new Response(JSON.stringify(id))) {
    const f = fixture();
    const collect = vi.fn(async () => structuredClone(f.current));
    const fetcher = vi.fn(response);
    return { ...f, collect, fetcher, transport: createAccountClosureAttestationTransport(config, collect, fetcher) };
}

describe('private exact-target registration transport — mocked HTTP, not live drain proof', () => {
    it('registers through exactly one fixed-target RPC after two independent target-bound reads', async () => {
        const s = setup();
        expect(await s.transport.register(s.request)).toMatchObject({ status: 'REGISTERED', attestationId: id, activationAuthorized: false });
        expect(s.collect).toHaveBeenCalledTimes(2);
        for (const [target, signal] of s.collect.mock.calls) {
            expect(target).toEqual({ url: config.url, projectId: config.projectId, environment: config.environment });
            expect(Object.isFrozen(target)).toBe(true); expect(signal).toBeInstanceOf(AbortSignal);
            expect(target).not.toHaveProperty('serviceKey');
        }
        expect(s.fetcher).toHaveBeenCalledTimes(1);
        const [url, options] = s.fetcher.mock.calls[0];
        expect(url).toBe(`${config.url}/rest/v1/rpc/record_account_closure_drain_attestation`);
        expect(options).toMatchObject({ method: 'POST', redirect: 'error', headers: { Authorization: `Bearer ${config.serviceKey}` } });
        expect(JSON.parse(options.body)).toMatchObject({ p_attestation_id: id, p_expected_generation: '7' });
    });
    it.each(['http://project-test.supabase.co', 'https://evil.test', 'https://project-test.supabase.co.evil.test',
        'https://user:pass@project-test.supabase.co', 'https://project-test.supabase.co/rpc',
        'https://project-test.supabase.co?target=x', 'https://project-test.supabase.co#fragment'])('rejects unsafe target %s before any callback', (url) => {
        const collect = vi.fn(); const fetcher = vi.fn();
        expect(() => createAccountClosureAttestationTransport({ ...config, url }, collect, fetcher)).toThrow();
        expect(collect).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
    });
    it.each(['projectId', 'environment'])('refuses different %s on either fact read, without forwarding credentials', async (key) => {
        for (const changedRead of [1, 2]) {
            const s = setup(); let reads = 0;
            s.collect.mockImplementation(async () => {
                const facts = structuredClone(s.current);
                if (++reads === changedRead) facts.context.target[key] = 'different';
                return facts;
            });
            expect(await s.transport.register(s.request)).toMatchObject({ status: 'HOLD', mutationOutcome: 'not_attempted' });
            expect(s.fetcher).not.toHaveBeenCalled();
        }
    });
    it.each([
        ['lost response', () => { throw new Error('network'); }],
        ['malformed success', () => new Response('not-json')],
        ['wrong receipt', () => new Response(JSON.stringify('wrong'))],
        ['empty response', () => new Response(null, { status: 204 })],
        ['oversize response', () => new Response('x'.repeat(16_385))],
        ['proxy error', () => new Response('<html>private upstream details</html>', { status: 502 })],
    ])('holds uncertain %s without replay or leaking response text', async (_name, response) => {
        const s = setup(response);
        const result = await s.transport.register(s.request);
        expect(result).toMatchObject({ status: 'HOLD', mutationOutcome: 'unknown', activationAuthorized: false });
        expect(JSON.stringify(result)).not.toMatch(/test-service-key|upstream|network|wrong/);
        expect(s.fetcher).toHaveBeenCalledTimes(1);
    });
    it('reports explicit database refusal without exposing its raw message', async () => {
        const s = setup(() => new Response(JSON.stringify({ code: '42501', message: 'private value' }), { status: 403 }));
        expect(await s.transport.register(s.request)).toEqual({ status: 'HOLD', reason: 'RPC_REJECTED', mutationOutcome: 'rejected', activationAuthorized: false });
        expect(s.fetcher).toHaveBeenCalledTimes(1);
    });
    it('preserves an invalidation generation above the safe integer limit exactly', async () => {
        const s = setup(() => new Response('9007199254740994')); s.current.generation = '9007199254740993';
        expect(await s.transport.invalidate(invalidate(s.current.generation))).toEqual({ status: 'INVALIDATED', generation: '9007199254740994', activationAuthorized: false });
        expect(JSON.parse(s.fetcher.mock.calls[0][1].body).p_expected_generation).toBe('9007199254740993');
        expect(s.fetcher).toHaveBeenCalledTimes(1);
    });
    it.each(['8.0', '8e0', '9223372036854775808', '9'])('holds malformed/wrong invalidation receipt %s without retry', async (body) => {
        const s = setup(() => new Response(body));
        expect(await s.transport.invalidate(invalidate())).toMatchObject({ status: 'HOLD', mutationOutcome: 'unknown' });
        expect(s.fetcher).toHaveBeenCalledTimes(1);
    });
    it('aborts an unavailable trusted collector within its bound without making a mutation', async () => {
        let observedSignal;
        const collect = vi.fn((_target, signal) => { observedSignal = signal; return new Promise(() => {}); });
        const fetcher = vi.fn();
        const transport = createAccountClosureAttestationTransport(config, collect, fetcher);
        expect(await transport.invalidate(invalidate())).toMatchObject({ status: 'HOLD', mutationOutcome: 'not_attempted' });
        expect(observedSignal.aborted).toBe(true); expect(fetcher).not.toHaveBeenCalled();
    }, 15_000);
});
