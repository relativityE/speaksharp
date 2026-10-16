// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createAccountClosureCurrentFacts } from '../../scripts/lib/accountClosureCurrentFacts.mjs';
import { createAccountClosureAttestationTransport } from '../../scripts/lib/accountClosureAttestationTransport.mjs';
import { enforcedClosureReceipt } from '../helpers/accountClosureEnforcementReceipt.mjs';

const user = '11111111-1111-4111-8111-111111111111';
const operation = '22222222-2222-4222-8222-222222222222';
const configuration = () => ({ url: 'https://project-test.supabase.co', projectId: 'project-test', environment: 'disposable',
  managementToken: 'private-management', serviceKey: 'private-service', stripeKey: 'sk_test_fixture', stripeAccountId: 'acct_fixture',
  candidateSha: 'a'.repeat(40), artifacts: ['stripe-checkout', 'account-closure'].map((name, index) => ({
    function: name, id: `33333333-3333-4333-8333-33333333333${index}`, version: 2, bundleDigest: `${index + 1}`.repeat(64), candidateSha: 'a'.repeat(40) })) });
const target = { url: 'https://project-test.supabase.co', projectId: 'project-test', environment: 'disposable' };
const json = (value, status = 200) => new Response(JSON.stringify(value), { status });
function setup(mutate = () => {}) {
  const config = configuration();
  const state = { generation: '7', generations: [], metadata: [{ name: 'PAYMENTS_ENABLED', value: 'private-value' }],
    dbPages: [[{ operation_id: operation, user_id: user, session_id: 'cs_fixture', phase: 'unknown' }]],
    providerPages: [{ data: [{ id: 'cs_fixture', status: 'complete', client_reference_id: user, metadata: { userId: user } }], has_more: false }],
    schema: enforcedClosureReceipt(), artifactMismatch: false, denied: false };
  mutate(state, config);
  let databasePage = 0; let providerPage = 0; let generationRead = 0;
  const fetcher = vi.fn(async (url, options) => {
    if (state.denied) return new Response('secret provider error private-service', { status: 403 });
    if (url.endsWith('/inspect_account_closure_drain_generation')) return json(state.generations[generationRead++] ?? state.generation);
    if (url.includes('/functions/')) {
      const pin = config.artifacts.find((p) => url.endsWith(`/${p.function}`));
      return json({ slug: pin.function, id: pin.id, status: 'ACTIVE', version: state.artifactMismatch ? 3 : pin.version, ezbr_sha256: pin.bundleDigest });
    }
    if (url.endsWith('/secrets')) return json(state.metadata);
    if (url.endsWith('/database/query')) {
      const body = JSON.parse(options.body);
      if (body.query.includes('operation_id::text')) {
        if (body.parameters[0] === null) databasePage = 0;
        return json(state.dbPages[databasePage++], 201);
      }
      const mode = body.query.match(/'mode'\s*,\s*'([^']+)'/)?.[1];
      const stage = state.schema.stages.find((s) => s.mode === mode);
      if (!stage) throw new Error('unrecognized catalog query');
      return json([{ json_build_object: stage }], 201);
    }
    if (url === 'https://api.stripe.com/v1/account') return json({ id: config.stripeAccountId });
    if (url.startsWith('https://api.stripe.com/v1/checkout/sessions?')) {
      if (!url.includes('starting_after=')) providerPage = 0;
      return json(state.providerPages[providerPage++]);
    }
    throw new Error('unexpected endpoint');
  });
  return { config, state, fetcher, collector: createAccountClosureCurrentFacts(config, fetcher) };
}

describe('available live-fact acquisition — mocked providers, missing global drain stays explicit', () => {
  it('reads real-shaped metadata/schema/generation/inventory twice-bound without creating an attestation', async () => {
    const s = setup(); const result = await s.collector.readAvailableFacts();
    expect(result).toMatchObject({ status: 'HOLD', reason: 'MISSING_AUTHORITATIVE_DRAIN_EVIDENCE', activationAuthorized: false,
      facts: { generation: '7', schemaReceipt: { passed: true, mode: 'verify' }, regionalWorkerCoverage: 'UNVERIFIED', effectiveRuntimeValuesVerified: false } });
    expect(result.facts.functions).toHaveLength(2);
    expect(result.facts.databaseInventory.operations[0]).toMatchObject({ phase: 'unknown', providerStatus: 'complete', disposition: 'quarantined' });
    expect(JSON.stringify(result)).not.toMatch(/private-management|private-service|private-value|sk_test_fixture/);
    for (const [url, options] of s.fetcher.mock.calls) {
      expect(options.redirect).toBe('error'); expect(options.signal).toBeInstanceOf(AbortSignal);
      const post = url.endsWith('/database/query') || url.endsWith('/inspect_account_closure_drain_generation');
      expect(options.method).toBe(post ? 'POST' : 'GET');
      const credential = url.startsWith('https://api.stripe.com/') ? 'sk_test_fixture'
        : url.startsWith(target.url) ? 'private-service' : 'private-management';
      expect(options.headers.Authorization).toBe(`Bearer ${credential}`);
    }
    expect(s.fetcher.mock.calls.filter(([url]) => url.endsWith('/database/query')).every(([, options]) => JSON.parse(options.body).read_only === true)).toBe(true);
    expect(s.fetcher.mock.calls.filter(([url]) => url.includes('/inspect_account_closure_drain_generation'))).toHaveLength(2);
  });
  it.each(['deploymentSuccess', 'elapsed400Seconds', 'zeroLogs', 'terminationVerified'])('never accepts %s as authoritative termination evidence', async (hint) => {
    const s = setup((_state, config) => { config[hint] = true; });
    expect(await s.collector.readAvailableFacts()).toMatchObject({ status: 'HOLD', reason: 'MISSING_AUTHORITATIVE_DRAIN_EVIDENCE' });
    const callback = s.collector.collectCurrentFacts;
    await expect(callback(target)).rejects.toMatchObject({ code: 'MISSING_AUTHORITATIVE_DRAIN_EVIDENCE' });
  });
  it.each(['http://project-test.supabase.co', 'https://foreign.test', 'https://project-test.supabase.co/path'])('refuses invalid target %s before requests', (url) => {
    const fetcher = vi.fn();
    expect(() => createAccountClosureCurrentFacts({ ...configuration(), url }, fetcher)).toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('refuses a different callback project with no network', async () => {
    const s = setup();
    expect(await s.collector.readAvailableFacts({ ...target, projectId: 'wrong' })).toMatchObject({ reason: 'WRONG_TARGET' });
    expect(s.fetcher).not.toHaveBeenCalled();
  });
  it('refuses a deployed function version outside protected artifact pins', async () => {
    const s = setup((state) => { state.artifactMismatch = true; });
    expect(await s.collector.readAvailableFacts()).toMatchObject({ status: 'HOLD', reason: 'DEPLOYMENT_ARTIFACT_MISMATCH' });
  });
  it('refuses generation drift across acquisition', async () => {
    const s = setup((state) => { state.generations = ['7', '8']; });
    expect(await s.collector.readAvailableFacts()).toMatchObject({ reason: 'CONTEXT_DRIFT' });
  });
  it('keeps bigint generation decimal bytes and refuses unsafe numeric values', async () => {
    const s = setup((state) => { state.generation = '9007199254740993'; });
    expect((await s.collector.readAvailableFacts()).facts.generation).toBe('9007199254740993');
    const invalid = setup((state) => { state.generation = 7; });
    expect(await invalid.collector.readAvailableFacts()).toMatchObject({ reason: 'INVALID_GENERATION' });
  });
  it('refuses failed schema evidence', async () => {
    const s = setup((state) => { state.schema.stages[4].checks.rollout_disabled = false; });
    expect(await s.collector.readAvailableFacts()).toMatchObject({ status: 'HOLD', reason: 'ACQUISITION_UNAVAILABLE' });
  });
  it('exhausts all provider pages with continuity and no open-only filter', async () => {
    const s = setup((state) => { state.providerPages = [state.providerPages[0], { data: [{ id: 'cs_second', status: 'expired' }], has_more: false }]; state.providerPages[0].has_more = true; });
    const result = await s.collector.readAvailableFacts();
    expect(result.facts.providerInventory).toMatchObject({ sessionCount: 2, observedPaginationExhausted: true });
    expect(s.fetcher.mock.calls.some(([url]) => url.endsWith('&starting_after=cs_fixture'))).toBe(true);
    expect(s.fetcher.mock.calls.some(([url]) => url.includes('status=open'))).toBe(false);
  });
  it('refuses incomplete provider pagination and duplicate sessions', async () => {
    for (const empty of [true, false]) {
      const s = setup((state) => {
        const original = structuredClone(state.providerPages[0]);
        state.providerPages = [{ data: empty ? [] : original.data, has_more: true }, original];
      });
      expect(await s.collector.readAvailableFacts()).toMatchObject({ status: 'HOLD', reason: empty ? 'PROVIDER_INVENTORY_CURSOR_STALLED' : 'PROVIDER_INVENTORY_UNREADABLE' });
    }
  });
  it('does not invent a settled disposition or accept wrong-user provider evidence', async () => {
    const s = setup((state) => { state.dbPages[0][0].phase = 'settled'; state.providerPages[0].data[0].metadata.userId = operation; });
    expect((await s.collector.readAvailableFacts()).facts.databaseInventory.operations[0])
      .toMatchObject({ providerStatus: 'UNVERIFIED', disposition: 'REQUIRES_SEPARATE_SETTLEMENT_PROOF' });
  });
  it('refuses unknown database phases rather than upgrading them to settled', async () => {
    const s = setup((state) => { state.dbPages[0][0].phase = 'complete'; });
    expect(await s.collector.readAvailableFacts()).toMatchObject({ reason: 'DB_INVENTORY_UNREADABLE' });
  });
  it('returns a sanitized denial and cancels outstanding requests on refusal', async () => {
    const s = setup((state) => { state.denied = true; });
    const result = await s.collector.readAvailableFacts();
    expect(result).toEqual({ status: 'HOLD', reason: 'READ_REFUSED', activationAuthorized: false });
    expect(s.fetcher.mock.calls.every(([, options]) => options.signal.aborted)).toBe(true);
  });
  it('preserves the specific missing-capability HOLD at the actual registration callback without any mutation', async () => {
    const s = setup();
    const transport = createAccountClosureAttestationTransport(s.config, s.collector.collectCurrentFacts, s.fetcher);
    expect(await transport.invalidate({ expectedGeneration: '7', reason: 'deployment_changed', evidenceDigest: 'f'.repeat(64) }))
      .toEqual({ status: 'HOLD', reason: 'MISSING_AUTHORITATIVE_DRAIN_EVIDENCE', mutationOutcome: 'not_attempted', activationAuthorized: false });
    expect(s.fetcher.mock.calls.some(([url]) => /\/rpc\/(record_|invalidate_)/.test(url))).toBe(false);
  });
});
