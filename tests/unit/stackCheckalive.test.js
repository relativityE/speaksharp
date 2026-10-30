// @vitest-environment node
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { collectStackStatus, COMPONENTS, writeStackStatus } from '../../scripts/human-test/stackCheckalive.mjs';

const NOW = '2026-10-29T23:00:00.000Z';
const RELEASE = 'a'.repeat(40);
const SOURCE = 'b'.repeat(40);
const directories = [];
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'stack-status-'));
  directories.push(root);
  const profile = { schema: 'speaksharp.stack-profile.v1', runId: 'run-1', releaseSha: RELEASE,
    sourceSha: SOURCE, components: COMPONENTS.map((component) => ({ component, required: true,
      maxAgeSeconds: 600, cases: ['AHT-01'] })) };
  async function receipt(component, producer, data, overrides = {}) {
    const row = profile.components.find((c) => c.component === component);
    const body = { schema: 'speaksharp.bound-stack-receipt.v1', runId: profile.runId,
      releaseSha: RELEASE, sourceSha: SOURCE, observedUtc: NOW, producer, data, ...overrides };
    const bytes = JSON.stringify(body);
    await writeFile(join(root, `${component}.json`), bytes);
    row.evidence = { path: `${component}.json`, sha256: createHash('sha256').update(bytes).digest('hex') };
    return row;
  }
  const collect = () => collectStackStatus(profile, { root, now: NOW });
  const component = async (name) => (await collect()).components.find((c) => c.component === name);
  return { root, profile, receipt, collect, component };
}
afterEach(async () => { await Promise.all(directories.splice(0).map((p) => rm(p, { recursive: true, force: true }))); });

const ops = (status = 'pass', checkedAt = NOW) => ({ generatedAt: NOW,
  checks: [{ name: 'Sentry API', status, checkedAt }, { name: 'PostHog API', status, checkedAt }] });
const readback = () => ({ gate: 'TELEMETRY-READBACK-COMPLETENESS', release_sha: RELEASE,
  boot_id: 'boot-1', journey_id: 'journey-1', identity_bound: true, traffic_type: 'canary',
  required_families: ['telemetry_positive_control', 'account_identified', 'session_saved'],
  observed_families: ['telemetry_positive_control', 'account_identified', 'session_saved'],
  attempts_declared: ['attempt-1'], verdict: 'QUALIFIED', missing: [], unrecognised: [],
  reasons: [], duplicate_families: [], delivery_failures: [],
  // The actual qualifier counts only singleton families, with attempt-scoped key suffixes.
  received_counts: { telemetry_positive_control: 1, 'session_saved@attempt-1': 1 },
});
const binding = { bootId: 'boot-1', journeyId: 'journey-1', attemptIds: ['attempt-1'] };

describe('per-run stack status from retained evidence, without probes', () => {
  it('keeps every missing required component BLOCKED and names affected cases', async () => {
    const f = await fixture();
    const result = await f.collect();
    expect(result.status).toBe('BLOCKED');
    expect(result.components).toHaveLength(12);
    expect(result.components.every((c) => c.reason === 'MISSING_RECEIPT' && c.cases[0] === 'AHT-01')).toBe(true);
  });

  it('reports existing ops API health but cannot promote it to received ingestion or whole-stack PASS', async () => {
    const f = await fixture();
    await f.receipt('posthog-api', 'ops-health', ops());
    await f.receipt('posthog-ingestion', 'ops-health', ops());
    expect(await f.component('posthog-api')).toMatchObject({ status: 'PASS', operation: 'API_HEALTH', observedUtc: NOW });
    expect(await f.component('posthog-ingestion')).toMatchObject({ status: 'BLOCKED', reason: 'PRODUCER_NOT_SUPPORTED' });
    expect((await f.collect()).status).toBe('BLOCKED');
  });

  it.each(['warn', 'skip', 'unknown'])('does not turn ops status %s into PASS', async (status) => {
    const f = await fixture();
    await f.receipt('sentry-api', 'ops-health', ops(status));
    expect(await f.component('sentry-api')).toMatchObject({ status: 'BLOCKED' });
  });

  it('preserves a concrete producer failure even when other components are missing', async () => {
    const f = await fixture();
    await f.receipt('sentry-api', 'ops-health', ops('fail'));
    expect((await f.collect()).status).toBe('FAIL');
    expect(await f.component('sentry-api')).toMatchObject({ status: 'FAIL', operation: 'API_HEALTH' });
  });

  it('holds an undated API failure as BLOCKED, while the same failure dated in-window surfaces as FAIL', async () => {
    const undated = await fixture();
    const data = ops('fail'); delete data.checks[0].checkedAt;
    await undated.receipt('sentry-api', 'ops-health', data);
    expect(await undated.component('sentry-api')).toMatchObject({ status: 'BLOCKED', reason: 'INVALID_OPERATION_TIMESTAMP' });
    expect((await undated.collect()).status).toBe('BLOCKED');
    const dated = await fixture();
    await dated.receipt('sentry-api', 'ops-health', ops('fail', '2026-10-29T22:55:00Z'));
    expect(await dated.component('sentry-api')).toMatchObject({ status: 'FAIL', operation: 'API_HEALTH',
      observedUtc: '2026-10-29T22:55:00Z', reason: 'PRODUCER_NON_SUCCESS' });
    expect((await dated.collect()).status).toBe('FAIL');
  });

  it('accepts the existing bound readback shape without demanding counts for repeatable families', async () => {
    const f = await fixture();
    const row = await f.receipt('posthog-ingestion', 'telemetry-readback', readback());
    row.binding = binding;
    expect(await f.component('posthog-ingestion')).toMatchObject({ status: 'PASS', operation: 'RECEIVED_EVENT' });
  });

  it.each([
    ['duplicate expected IDs', ['attempt-1', 'attempt-1'], ['attempt-1', 'attempt-2']],
    ['duplicate received IDs', ['attempt-1', 'attempt-2'], ['attempt-1', 'attempt-1']],
    ['duplicates on both sides', ['attempt-1', 'attempt-1'], ['attempt-1', 'attempt-1']],
    ['empty attempt sets', [], []],
    ['malformed received ID', ['attempt-1'], [{ toString: null }]],
  ])('rejects %s instead of treating list length/includes as exact identity', async (_, expected, received) => {
    const f = await fixture();
    const row = await f.receipt('posthog-ingestion', 'telemetry-readback', { ...readback(), attempts_declared: received });
    row.binding = { ...binding, attemptIds: expected };
    expect(await f.component('posthog-ingestion')).toMatchObject({ status: 'BLOCKED', reason: 'UNBOUND_RECEIVED_EVIDENCE' });
  });

  it('accepts two unique matching attempt sets in a different order', async () => {
    const f = await fixture();
    const row = await f.receipt('posthog-ingestion', 'telemetry-readback', { ...readback(),
      attempts_declared: ['attempt-2', 'attempt-1'],
      received_counts: { telemetry_positive_control: 1, 'session_saved@attempt-1': 1, 'session_saved@attempt-2': 1 } });
    row.binding = { ...binding, attemptIds: ['attempt-1', 'attempt-2'] };
    expect(await f.component('posthog-ingestion')).toMatchObject({ status: 'PASS', operation: 'RECEIVED_EVENT' });
  });

  it.each([
    ['empty received data', { received_counts: {} }],
    ['missing family', { observed_families: ['telemetry_positive_control'] }],
    ['HOLD is not zero events', { verdict: 'HOLD' }],
    ['duplicate delivery', { duplicate_families: ['session_saved'] }],
    ['guard-refused capture only', { identity_bound: false }],
    ['wrong boot', { boot_id: 'another-boot' }],
    ['wrong journey', { journey_id: 'another-journey' }],
    ['wrong attempt', { attempts_declared: ['another-attempt'] }],
    ['not controlled traffic', { traffic_type: 'user' }],
    ['wrong release', { release_sha: 'c'.repeat(40) }],
  ])('blocks %s', async (_, delta) => {
    const f = await fixture();
    const row = await f.receipt('posthog-ingestion', 'telemetry-readback', { ...readback(), ...delta });
    row.binding = binding;
    expect(await f.component('posthog-ingestion')).toMatchObject({ status: 'BLOCKED' });
  });

  it.each([
    ['wrong run', { runId: 'run-2' }, 'BINDING_MISMATCH'],
    ['wrong release', { releaseSha: 'c'.repeat(40) }, 'BINDING_MISMATCH'],
    ['wrong source', { sourceSha: 'c'.repeat(40) }, 'BINDING_MISMATCH'],
    ['stale wrapper', { observedUtc: '2026-10-29T22:00:00Z' }, 'STALE_RECEIPT'],
    ['future wrapper', { observedUtc: '2026-10-29T23:01:00Z' }, 'STALE_RECEIPT'],
  ])('rejects %s', async (_, delta, reason) => {
    const f = await fixture();
    await f.receipt('sentry-api', 'ops-health', ops(), delta);
    expect(await f.component('sentry-api')).toMatchObject({ status: 'BLOCKED', reason });
  });

  it('rejects stale actual health hidden inside a fresh wrapper', async () => {
    const f = await fixture();
    await f.receipt('sentry-api', 'ops-health', ops('pass', '2026-10-29T22:00:00Z'));
    expect(await f.component('sentry-api')).toMatchObject({ reason: 'STALE_RECEIPT' });
  });

  // F1: the wrapper is fresh in every case below; only the API row's own checkedAt may date the operation.
  it.each([
    ['omitted', (row) => { delete row.checkedAt; }],
    ['null', (row) => { row.checkedAt = null; }],
    ['empty', (row) => { row.checkedAt = ''; }],
    ['numeric epoch', (row) => { row.checkedAt = Date.parse(NOW); }],
    ['non-UTC offset', (row) => { row.checkedAt = '2026-10-29T23:00:00+00:00'; }],
    ['impossible hour', (row) => { row.checkedAt = '2026-10-29T25:00:00Z'; }],
    ['free text', (row) => { row.checkedAt = 'just now'; }],
  ])('does not let a %s API checkedAt inherit wrapper freshness', async (_, change) => {
    for (const component of ['sentry-api', 'posthog-api']) {
      const f = await fixture();
      const data = ops();
      for (const row of data.checks) change(row);
      await f.receipt(component, 'ops-health', data);
      expect(await f.component(component)).toMatchObject({ status: 'BLOCKED', operation: 'NOT_MEASURED',
        observedUtc: null, reason: 'INVALID_OPERATION_TIMESTAMP' });
    }
  });

  it('keeps future and stale row controls distinct from a valid row', async () => {
    for (const [checkedAt, expected] of [
      ['2026-10-29T23:01:00Z', { status: 'BLOCKED', reason: 'STALE_RECEIPT' }],
      ['2026-10-29T22:49:59Z', { status: 'BLOCKED', reason: 'STALE_RECEIPT' }],
      ['2026-10-29T22:50:00Z', { status: 'PASS', reason: null, observedUtc: '2026-10-29T22:50:00Z' }],
    ]) {
      const f = await fixture();
      await f.receipt('sentry-api', 'ops-health', ops('pass', checkedAt));
      expect(await f.component('sentry-api')).toMatchObject(expected);
    }
  });

  it('rejects duplicate API rows rather than picking the green one', async () => {
    const f = await fixture();
    const data = ops(); data.checks.push({ name: 'Sentry API', status: 'fail', checkedAt: NOW });
    await f.receipt('sentry-api', 'ops-health', data);
    expect(await f.component('sentry-api')).toMatchObject({ reason: 'MISSING_COMPONENT_RECEIPT' });
  });

  it.each(['skipped', 'cancelled', undefined])('holds a canary that did not run: %s', async (state) => {
    const f = await fixture();
    await f.receipt('recording-stop-save', 'canary', { targetReleaseSha: RELEASE,
      bindingResult: 'success', readinessResult: 'success', migrationReady: true, productLanesResult: state });
    expect(await f.component('recording-stop-save')).toMatchObject({ reason: 'PRODUCT_CANARY_NOT_RUN' });
  });

  it('does not let an aggregate green badge hide the migration HOLD', async () => {
    const f = await fixture();
    await f.receipt('recording-stop-save', 'canary', { targetReleaseSha: RELEASE,
      bindingResult: 'success', readinessResult: 'success', migrationReady: false, productLanesResult: 'success' });
    expect(await f.component('recording-stop-save')).toMatchObject({ reason: 'CANARY_PREREQUISITE_HELD' });
  });

  it('accepts a genuine terminal canary, but labels only its proven operation', async () => {
    const f = await fixture();
    await f.receipt('recording-stop-save', 'canary', { targetReleaseSha: RELEASE,
      bindingResult: 'success', readinessResult: 'success', migrationReady: true, productLanesResult: 'success' });
    expect(await f.component('recording-stop-save')).toMatchObject({ status: 'PASS', operation: 'PRODUCT_CANARY' });
    expect((await f.collect()).status).toBe('BLOCKED');
  });

  it('permits only an explicit applicable optional exclusion, never silent required removal', async () => {
    const f = await fixture();
    const row = f.profile.components.find((c) => c.component === 'coaching-provider');
    row.required = false;
    expect((await f.collect()).reason).toBe('INVALID_PROFILE');
    row.exclusionReason = 'NO_COACHING_IN_PROFILE';
    expect(await f.component(row.component)).toMatchObject({ status: 'EXCLUDED', reason: row.exclusionReason });
    row.component = 'sentry-ingestion';
    expect((await f.collect()).status).toBe('BLOCKED');
  });

  it('rejects missing and duplicate component entries', async () => {
    const f = await fixture();
    f.profile.components[0] = f.profile.components[1];
    expect((await f.collect()).reason).toBe('INVALID_PROFILE');
    f.profile.components.pop();
    expect((await f.collect()).reason).toBe('INVALID_PROFILE');
  });

  it('checks receipt bytes and cannot reuse a changed receipt', async () => {
    const f = await fixture();
    const row = await f.receipt('sentry-api', 'ops-health', ops());
    await writeFile(join(f.root, row.evidence.path), '{}');
    expect(await f.component('sentry-api')).toMatchObject({ reason: 'DIGEST_MISMATCH' });
  });

  it.each(['../outside.json', '/tmp/private.json', 'receipt.json?token=secret'])('refuses unsafe reference %s', async (path) => {
    const f = await fixture();
    f.profile.components[0].evidence = { path, sha256: 'a'.repeat(64) };
    expect((await f.collect()).components[0].reason).toBe('INVALID_REFERENCE');
  });

  it('refuses a symlink outside the receipt root and does not echo its error', async () => {
    const f = await fixture();
    const other = await fixture();
    await writeFile(join(other.root, 'private.json'), '{"token":"secret"}');
    await symlink(join(other.root, 'private.json'), join(f.root, 'receipt.json'));
    f.profile.components[0].evidence = { path: 'receipt.json', sha256: 'a'.repeat(64) };
    const result = await f.collect();
    expect(result.components[0].reason).toBe('UNREADABLE_RECEIPT');
    expect(JSON.stringify(result)).not.toMatch(/secret|private\.json/);
  });

  it('drops raw vendor content, URLs and errors from output', async () => {
    const f = await fixture();
    const data = ops(); data.checks[0].detail = 'transcript secret https://example.test/?token=secret';
    await f.receipt('sentry-api', 'ops-health', data);
    expect(JSON.stringify(await f.collect())).not.toMatch(/transcript|secret|example/);
  });

  it('persists missing-input BLOCKED and never overwrites retained result bytes', async () => {
    const f = await fixture();
    const output = join(f.root, 'result.json');
    await writeStackStatus(join(f.root, 'missing-profile.json'), output, { now: NOW });
    const original = await readFile(output, 'utf8');
    expect(JSON.parse(original)).toMatchObject({ status: 'BLOCKED', reason: 'INVALID_PROFILE' });
    await expect(writeStackStatus(join(f.root, 'missing-profile.json'), output, { now: NOW })).rejects.toThrow();
    expect(await readFile(output, 'utf8')).toBe(original);
  });

  it.each(['runId', 'releaseSha', 'sourceSha', 'caseId', 'receiptDigest', 'bootId'])('persists BLOCKED for malformed JSON %s without coercing it or leaking it', async (field) => {
    const f = await fixture();
    const malformed = { toString: null, content: 'private-sentinel' };
    if (field === 'caseId') f.profile.components[0].cases = [malformed];
    else if (field === 'receiptDigest') f.profile.components[0].evidence = { path: 'receipt.json', sha256: malformed };
    else if (field === 'bootId') {
      const row = await f.receipt('posthog-ingestion', 'telemetry-readback', { ...readback(), boot_id: malformed });
      row.binding = binding;
    } else f.profile[field] = malformed;
    const input = join(f.root, 'profile.json');
    const output = join(f.root, 'malformed-result.json');
    await writeFile(input, JSON.stringify(f.profile));
    await expect(writeStackStatus(input, output, { now: NOW })).resolves.toMatchObject({ status: 'BLOCKED' });
    const bytes = await readFile(output, 'utf8');
    expect(JSON.parse(bytes).status).toBe('BLOCKED');
    expect(bytes).not.toMatch(/private-sentinel|toString/);
  });
});
