// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { runAccountClosureCurrentFactsCommand } from '../../scripts/account-closure-current-facts.mjs';
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
    if (url.includes('/functions/v1/')) {
      const pin = config.artifacts.find((p) => url.includes(`/${p.function}?`));
      const body = JSON.parse(options.body);
      const value = { version: 1, function: pin.function, nonce: body.nonce, projectId: target.projectId,
        deploymentId: body.expectedDeploymentId, region: 'us-east-1', executionId: '44444444-4444-4444-8444-444444444444',
        observedAt: Date.now(), configuration: { paymentsEnabled: false, configuredStripeMode: 'test', capturedStripeMode: 'test',
          stripeModeMatches: true, siteOrigin: 'https://example.test', proPriceId: null, anonConfigured: true } };
      state.probeMutation?.(value);
      return json(value);
    }
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
      const post = url.endsWith('/database/query') || url.endsWith('/inspect_account_closure_drain_generation') || url.includes('/functions/v1/');
      expect(options.method).toBe(post ? 'POST' : 'GET');
      const credential = url.startsWith('https://api.stripe.com/') ? 'sk_test_fixture'
        : url.startsWith(target.url) ? 'private-service' : 'private-management';
      expect(options.headers.Authorization).toBe(`Bearer ${credential}`);
    }
    expect(s.fetcher.mock.calls.filter(([url]) => url.endsWith('/database/query')).every(([, options]) => JSON.parse(options.body).read_only === true)).toBe(true);
    expect(s.fetcher.mock.calls.filter(([url]) => url.includes('/inspect_account_closure_drain_generation'))).toHaveLength(2);
    expect(result.facts.effectiveRuntimeObservations).toHaveLength(4);
    expect(result.facts.respondingInstanceConfigVerified).toBe(true);
  });
  it.each(['nonce', 'deploymentId', 'projectId', 'observedAt', 'configuration'])('rejects stale/replayed/mismatched probe %s', async (field) => {
    const s = setup((state) => { state.probeMutation = (value) => {
      if (field === 'observedAt') value.observedAt = Date.now() - 60000;
      else if (field === 'configuration') value.configuration.secret = 'must-not-leak';
      else value[field] = 'mismatch';
    }; });
    const result = await s.collector.readAvailableFacts();
    expect(result).toMatchObject({ status: 'HOLD', reason: 'EFFECTIVE_CONFIG_UNVERIFIED', activationAuthorized: false });
    expect(JSON.stringify(result)).not.toContain('must-not-leak');
  });
  it('rejects responding configuration drift across the two snapshots', async () => {
    let calls = 0;
    const s = setup((state) => { state.probeMutation = (value) => { value.configuration.paymentsEnabled = ++calls > 2; }; });
    expect(await s.collector.readAvailableFacts()).toMatchObject({ reason: 'CONTEXT_DRIFT' });
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
  it.each(['open', 'complete', 'expired'])('retains an unmatched provider %s session as quarantined evidence, without exposing owner metadata', async (status) => {
    const s = setup((state) => { state.providerPages[0].data.push({ id: 'cs_unmatched', status,
      client_reference_id: 'private-owner@example.test', metadata: { userId: 'private-owner@example.test' } }); });
    const result = await s.collector.readAvailableFacts();
    expect(result).toMatchObject({ status: 'HOLD', activationAuthorized: false });
    expect(result.facts.providerInventory.sessions).toHaveLength(2);
    expect(result.facts.providerInventory.sessions).toContainEqual({ sessionId: 'cs_unmatched', providerStatus: status,
      databaseOperationIds: [], linkage: 'SESSION_ID_MATCH_ONLY', disposition: 'quarantined' });
    expect(JSON.stringify(result)).not.toContain('private-owner@example.test');
  });
  it('retains exact provider-to-database correlation without treating a settled row as settlement proof', async () => {
    const s = setup((state) => { state.dbPages[0][0].phase = 'settled'; });
    const result = await s.collector.readAvailableFacts();
    expect(result.facts.databaseInventory.operations[0]).toMatchObject({ sessionId: 'cs_fixture' });
    expect(result.facts.providerInventory.sessions).toEqual([{ sessionId: 'cs_fixture', providerStatus: 'complete',
      databaseOperationIds: [operation], linkage: 'SESSION_ID_MATCH_ONLY', disposition: 'REQUIRES_SEPARATE_SETTLEMENT_PROOF' }]);
    expect(result.activationAuthorized).toBe(false);
  });
  function databaseRows() {
    return Array.from({ length: 101 }, (_, index) => ({ operation_id: `44444444-4444-4444-8444-${String(index + 1).padStart(12, '0')}`,
      user_id: user, session_id: null, phase: 'issuing' }));
  }
  it('exhausts database keyset pages across the 101-row lookahead without dropping or duplicating operations', async () => {
    const rows = databaseRows();
    const s = setup((state) => { state.dbPages = [rows, [rows[100]]]; });
    const result = await s.collector.readAvailableFacts();
    expect(result.facts.databaseInventory.operations).toHaveLength(101);
    expect(result.facts.databaseInventory.operations.at(-1).operationId).toBe(rows[100].operation_id);
    expect(result.facts.databaseInventory.pages.map((page) => [page.cursor, page.nextCursor]))
      .toEqual([[null, rows[99].operation_id], [rows[99].operation_id, null]]);
    const queries = s.fetcher.mock.calls.filter(([url, options]) => url.endsWith('/database/query')
      && JSON.parse(options.body).query.includes('operation_id::text'));
    expect(queries.map(([, options]) => JSON.parse(options.body).parameters)).toEqual([[null], [rows[99].operation_id]]);
    expect(result.facts.databaseInventory.snapshotConsistency).toBe('UNVERIFIED_UNTIL_DRAIN');
  });
  it('refuses a repeated operation at a database page boundary rather than claiming inventory exhaustion', async () => {
    const rows = databaseRows();
    const s = setup((state) => { state.dbPages = [rows, [rows[99]]]; });
    expect(await s.collector.readAvailableFacts()).toMatchObject({ status: 'HOLD', reason: 'DB_INVENTORY_UNREADABLE' });
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

const ownedDirectories = [];
afterEach(() => { for (const path of ownedDirectories.splice(0)) rmSync(path, { recursive: true, force: true }); });
function commandFixture() {
  const s = setup(); const directory = mkdtempSync(join(tmpdir(), 'closure-facts-')); ownedDirectories.push(directory);
  const manifest = join(directory, 'target.json'); const output = join(directory, 'receipt.json');
  const { managementToken, serviceKey, stripeKey, ...pins } = s.config;
  writeFileSync(manifest, JSON.stringify(pins));
  const environment = { SUPABASE_ACCESS_TOKEN: managementToken, SUPABASE_SERVICE_ROLE_KEY: serviceKey, STRIPE_SECRET_KEY: stripeKey };
  let stdout = ''; let stderr = '';
  const run = (args = ['--manifest', manifest, '--output', output]) => runAccountClosureCurrentFactsCommand(args, {
    environment, fetcher: s.fetcher, stdout: (text) => { stdout += text; }, stderr: (text) => { stderr += text; },
  });
  return { ...s, directory, manifest, output, pins, environment, run, stdout: () => stdout, stderr: () => stderr };
}

describe('read-only operator acquisition command — real collector and private filesystem boundary', () => {
  it('preserves acquired facts privately, emits only a sanitized HOLD summary, and never mutates registration', async () => {
    const s = commandFixture(); const before = readFileSync(s.manifest, 'utf8'); const started = Date.now();
    expect(await s.run()).toBe(3);
    const receipt = JSON.parse(readFileSync(s.output, 'utf8'));
    expect(statSync(s.output).mode & 0o777).toBe(0o600);
    expect(receipt).toMatchObject({ version: 1, status: 'HOLD', reason: 'MISSING_AUTHORITATIVE_DRAIN_EVIDENCE',
      activationAuthorized: false, facts: { respondingInstanceConfigVerified: true, regionalWorkerCoverage: 'UNVERIFIED' } });
    expect(receipt.facts.databaseInventory.operations[0].userId).toBe(user);
    expect(Date.parse(receipt.checkedAt)).toBeGreaterThanOrEqual(started);
    expect(JSON.parse(s.stdout())).toEqual({ status: 'HOLD', reason: 'MISSING_AUTHORITATIVE_DRAIN_EVIDENCE',
      activationAuthorized: false, factsCaptured: true, checkedAt: receipt.checkedAt });
    expect(s.stdout()).not.toMatch(/private-|sk_test_|cs_fixture|11111111|22222222/);
    expect(JSON.stringify(receipt)).not.toMatch(/private-management|private-service|private-value|sk_test_fixture/);
    expect(s.stderr()).toBe(''); expect(readFileSync(s.manifest, 'utf8')).toBe(before);
    expect(s.fetcher.mock.calls.some(([url]) => /\/rpc\/(record_|invalidate_)/.test(url))).toBe(false);
  });
  it('preserves a sanitized acquisition refusal without exposing provider error text', async () => {
    const s = commandFixture(); s.state.denied = true;
    expect(await s.run()).toBe(3);
    expect(JSON.parse(s.stdout())).toMatchObject({ status: 'HOLD', reason: 'READ_REFUSED', factsCaptured: false });
    expect(JSON.parse(readFileSync(s.output, 'utf8'))).toMatchObject({ status: 'HOLD', reason: 'READ_REFUSED' });
    expect(s.stdout() + s.stderr() + readFileSync(s.output, 'utf8')).not.toContain('secret provider error');
  });
  it.each(['SUPABASE_ACCESS_TOKEN', 'SUPABASE_SERVICE_ROLE_KEY', 'STRIPE_SECRET_KEY'])('rejects missing %s before any network/output', async (key) => {
    const s = commandFixture(); delete s.environment[key];
    expect(await s.run()).toBe(2); expect(s.stderr()).toContain('INVALID_CONFIGURATION');
    expect(s.fetcher).not.toHaveBeenCalled(); expect(readdirSync(s.directory)).toEqual(['target.json']);
  });
  it('refuses a production key against disposable target before any request', async () => {
    const s = commandFixture(); s.environment.STRIPE_SECRET_KEY = 'sk_live_must_not_echo';
    expect(await s.run()).toBe(2); expect(s.fetcher).not.toHaveBeenCalled();
    expect(s.stdout() + s.stderr()).not.toContain('must_not_echo');
  });
  it.each(['url', 'environment', 'candidateSha', 'artifacts', 'stripeAccountId', 'secret', 'now'])('refuses invalid or caller-added manifest %s', async (field) => {
    const s = commandFixture(); const pins = structuredClone(s.pins); pins[field] = 'DO_NOT_ECHO_PRIVATE_INPUT';
    writeFileSync(s.manifest, JSON.stringify(pins));
    expect(await s.run()).toBe(2); expect(s.fetcher).not.toHaveBeenCalled();
    expect(s.stdout() + s.stderr()).not.toContain('DO_NOT_ECHO');
    expect(readdirSync(s.directory)).toEqual(['target.json']);
  });
  it.each(['malformed', 'oversized', 'symlink', 'directory'])('refuses %s manifest without requests', async (mode) => {
    const s = commandFixture(); let input = s.manifest;
    if (mode === 'malformed') writeFileSync(input, 'DO_NOT_ECHO');
    else if (mode === 'oversized') writeFileSync(input, 'x'.repeat(65537));
    else if (mode === 'symlink') { input = join(s.directory, 'link.json'); symlinkSync(s.manifest, input); }
    else input = s.directory;
    expect(await s.run(['--manifest', input, '--output', s.output])).toBe(2);
    expect(s.fetcher).not.toHaveBeenCalled(); expect(s.stderr()).toContain('INVALID_MANIFEST');
  });
  it.each(['existing', 'symlink', 'missing-parent', 'same-as-manifest'])('refuses %s output before requests and preserves existing files', async (mode) => {
    const s = commandFixture(); let output = s.output; const before = readFileSync(s.manifest, 'utf8');
    if (mode === 'existing') writeFileSync(output, 'owned-existing-receipt');
    else if (mode === 'symlink') symlinkSync(s.manifest, output);
    else if (mode === 'missing-parent') output = join(s.directory, 'absent', 'receipt.json');
    else output = s.manifest;
    const witness = mode === 'existing' ? output : s.manifest; const prior = readFileSync(witness, 'utf8');
    expect(await s.run(['--manifest', s.manifest, '--output', output])).toBe(2);
    expect(s.fetcher).not.toHaveBeenCalled(); expect(s.stderr()).toContain('OUTPUT_UNAVAILABLE');
    expect(readFileSync(s.manifest, 'utf8')).toBe(before);
    expect(readFileSync(witness, 'utf8')).toBe(prior);
  });
  it.each([[], ['--register', 'yes'], ['--manifest', 'x', '--activate', 'yes'],
    ['--manifest', 'x', '--manifest', 'y'], ['--manifest', '--output', '--output', 'x']])('rejects unsupported or ambiguous arguments %j', async (...args) => {
    const s = commandFixture(); expect(await s.run(args)).toBe(2);
    expect(s.fetcher).not.toHaveBeenCalled(); expect(s.stderr()).toContain('INVALID_ARGUMENTS');
  });
  it('actual process help explains private output and HOLD exit semantics without credentials', () => {
    const result = spawnSync(process.execPath, [resolve('scripts/account-closure-current-facts.mjs'), '--help'], { encoding: 'utf8', timeout: 5000 });
    expect(result.status).toBe(0); expect(result.stderr).toBe('');
    expect(result.stdout).toContain('NEW_PRIVATE_FILE'); expect(result.stdout).toContain('Exit 3 = HOLD');
  });
});
