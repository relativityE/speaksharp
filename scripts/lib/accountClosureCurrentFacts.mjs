import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { accountClosureEnforcementStages } from './accountClosureEnforcementGate.mjs';
import { ACCOUNT_CLOSURE_RUNTIME_SCHEMA_SHA256 } from './accountClosureEnforcementIdentity.mjs';

const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const uuid = (v) => typeof v === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
const sha = (v) => typeof v === 'string' && /^[a-f0-9]{40}$/.test(v);
const missing = ['AUTHORITATIVE_LEGACY_WORKER_DRAIN_EVIDENCE', 'PROTECTED_EFFECTIVE_RUNTIME_CONFIG_READBACK'];
class AcquisitionError extends Error { constructor(code) { super(code); this.code = code; } }
const stop = (code) => { throw new AcquisitionError(code); };
async function bodyJson(response, signal) {
  const reader = response.body?.getReader(); if (!reader) stop('UNREADABLE_RESPONSE');
  const decoder = new TextDecoder(); let bytes = 0; let text = '';
  try {
    while (true) {
      signal.throwIfAborted();
      const part = await reader.read(); if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > 262144) { await reader.cancel(); stop('RESPONSE_BOUND_EXCEEDED'); }
      text += decoder.decode(part.value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally { reader.releaseLock(); }
}

/**
 * Available read-only acquisition behind collectCurrentFacts; no registration,
 * deployment, config change or provider mutation. Management database/query is
 * invoked ONLY with fixed SELECT/catalog queries and read_only:true:
 * https://supabase.com/docs/reference/api/v1-run-a-query
 * Metadata: /v1-get-a-function and /v1-list-all-secrets. Config metadata hashes
 * do NOT prove effective runtime values. Function metadata does NOT enumerate
 * regional workers or prove termination. This implementation deliberately cannot
 * produce a complete drain grant until those external capabilities are supplied
 * through a separately reviewed provenance-verification implementation.
 */
export function createAccountClosureCurrentFacts(configuration, fetcher = fetch) {
  const { url, projectId, environment, managementToken, serviceKey, stripeKey, stripeAccountId,
    candidateSha, artifacts } = configuration ?? {};
  if (typeof projectId !== 'string' || !/^[a-z0-9-]{1,63}$/.test(projectId)
    || !['production', 'disposable'].includes(environment) || !sha(candidateSha)
    || ![managementToken, serviceKey].every((v) => typeof v === 'string' && v.length > 0)
    || typeof fetcher !== 'function') throw new Error('invalid acquisition target');
  const parsed = new URL(url);
  if (parsed.origin !== `https://${projectId}.supabase.co` || parsed.pathname !== '/'
    || parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error('invalid acquisition target');
  const pinned = structuredClone(artifacts);
  if (!Array.isArray(pinned) || pinned.length !== 2 || !['stripe-checkout', 'account-closure'].every((name) =>
    pinned.filter((p) => p.function === name).length === 1) || pinned.some((p) => !uuid(p.id)
      || !Number.isSafeInteger(p.version) || p.version <= 0 || p.candidateSha !== candidateSha
      || typeof p.bundleDigest !== 'string' || !/^[a-f0-9]{64}$/.test(p.bundleDigest))) throw new Error('invalid protected artifact pins');
  const target = Object.freeze({ url: parsed.origin, projectId, environment });
  const management = `https://api.supabase.com/v1/projects/${projectId}`;
  const source = (name) => readFileSync(new URL(`../../backend/supabase/migrations/${name}`, import.meta.url), 'utf8');
  // scripts/lib is two directories below the repository root.
  const stages = accountClosureEnforcementStages('verify', {
    closure: source('20261013180000_account_closure_tokens.sql'),
    baseline: source('20260812041600_trial_commercial_grant_on_conflict_1294.sql'),
    drain: source('20261016090000_account_closure_drain_persistence.sql'),
    enforcement: source('20261016180000_account_closure_drain_enforcement.sql'),
  });
  async function acquire(requestTarget, externalSignal) {
    if (requestTarget?.projectId !== projectId || requestTarget?.environment !== environment || requestTarget?.url !== target.url) stop('WRONG_TARGET');
    const signal = externalSignal ? AbortSignal.any([externalSignal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000);
    async function request(endpoint, credential, method = 'GET', payload) {
      signal.throwIfAborted();
      const response = await fetcher(endpoint, { method, redirect: 'error', signal,
        headers: { Authorization: `Bearer ${credential}`, ...(endpoint.startsWith(target.url) ? { apikey: serviceKey } : {}),
          ...(payload ? { 'Content-Type': 'application/json' } : {}) }, ...(payload ? { body: JSON.stringify(payload) } : {}) });
      if (![200, 201].includes(response.status)) { await response.body?.cancel(); stop('READ_REFUSED'); }
      return bodyJson(response, signal);
    }
    const sql = (query, parameters = []) => request(`${management}/database/query`, managementToken, 'POST', { query, parameters, read_only: true });
    async function snapshot() {
      const [generation, functions, secrets] = await Promise.all([
        request(`${target.url}/rest/v1/rpc/inspect_account_closure_drain_generation`, serviceKey, 'POST', {}),
        Promise.all(pinned.map(async (pin) => {
          const value = await request(`${management}/functions/${pin.function}`, managementToken);
          if (value?.slug !== pin.function || value.status !== 'ACTIVE' || value.id !== pin.id
            || value.version !== pin.version || value.ezbr_sha256 !== pin.bundleDigest) stop('DEPLOYMENT_ARTIFACT_MISMATCH');
          return { function: pin.function, id: value.id, version: value.version,
            deploymentId: `${projectId}_${value.id}_${value.version}`, bundleDigest: value.ezbr_sha256, candidateSha };
        })),
        request(`${management}/secrets`, managementToken),
      ]);
      if (typeof generation !== 'string' || !/^(0|[1-9][0-9]{0,18})$/.test(generation) || BigInt(generation) > 9223372036854775807n) stop('INVALID_GENERATION');
      if (!Array.isArray(secrets) || secrets.length > 1000 || secrets.some((s) => typeof s.name !== 'string'
        || typeof s.value !== 'string') || new Set(secrets.map((s) => s.name)).size !== secrets.length) stop('CONFIG_METADATA_UNREADABLE');
      // Raw values (which may be hashes or secrets) never leave this scope.
      const configMetadataDigest = digest(secrets.map((s) => [s.name, digest(s.value)]).sort(([a], [b]) => a.localeCompare(b)));
      return { generation, functions, configMetadataDigest };
    }
    async function databaseInventory() {
      const operations = []; const pages = []; const seen = new Set(); let cursor = null;
      for (let page = 0; page < 20; page++) {
        const rows = await sql(`SELECT operation_id::text,user_id::text,session_id,phase FROM public.account_checkout_operations
          WHERE ($1::uuid IS NULL OR operation_id>$1::uuid) ORDER BY operation_id LIMIT 101`, [cursor]);
        if (!Array.isArray(rows) || rows.length > 101) stop('DB_INVENTORY_UNREADABLE');
        const selected = rows.slice(0, 100);
        let previous = cursor;
        for (const row of selected) {
          if (!uuid(row.operation_id) || !uuid(row.user_id) || seen.has(row.operation_id)
            || (previous !== null && row.operation_id <= previous) || !['issuing', 'unknown', 'open', 'settled'].includes(row.phase)
            || (row.session_id !== null && (typeof row.session_id !== 'string' || !/^cs_[a-zA-Z0-9_]+$/.test(row.session_id)))) stop('DB_INVENTORY_UNREADABLE');
          seen.add(row.operation_id); operations.push(row);
          previous = row.operation_id;
        }
        const next = rows.length > 100 ? selected.at(-1)?.operation_id : null;
        pages.push({ cursor, nextCursor: next, evidenceDigest: digest(rows) });
        if (next === null) return { pages, operations, observedPaginationExhausted: true, snapshotConsistency: 'UNVERIFIED_UNTIL_DRAIN' };
        if (!next || next === cursor) stop('DB_INVENTORY_CURSOR_STALLED'); cursor = next;
      }
      stop('DB_INVENTORY_PAGE_BOUND');
    }
    async function providerInventory() {
      if (typeof stripeKey !== 'string' || !new RegExp(`^(?:sk|rk)_${environment === 'production' ? 'live' : 'test'}_`).test(stripeKey)
        || typeof stripeAccountId !== 'string' || !/^acct_[a-zA-Z0-9]+$/.test(stripeAccountId)) stop('PROVIDER_TARGET_UNAVAILABLE');
      const account = await request('https://api.stripe.com/v1/account', stripeKey);
      if (account?.id !== stripeAccountId) stop('PROVIDER_ACCOUNT_MISMATCH');
      const sessions = []; const seen = new Set(); const pages = []; let cursor = null;
      for (let page = 0; page < 20; page++) {
        const endpoint = `https://api.stripe.com/v1/checkout/sessions?limit=100${cursor ? `&starting_after=${encodeURIComponent(cursor)}` : ''}`;
        const result = await request(endpoint, stripeKey);
        if (!Array.isArray(result?.data) || result.data.length > 100 || typeof result.has_more !== 'boolean') stop('PROVIDER_INVENTORY_UNREADABLE');
        for (const s of result.data) {
          if (typeof s.id !== 'string' || !/^cs_[a-zA-Z0-9_]+$/.test(s.id) || seen.has(s.id)
            || !['open', 'complete', 'expired'].includes(s.status)) stop('PROVIDER_INVENTORY_UNREADABLE');
          seen.add(s.id); sessions.push({ id: s.id, status: s.status, clientReferenceId: s.client_reference_id ?? null,
            metadataUserId: s.metadata?.userId ?? null });
        }
        const next = result.has_more ? result.data.at(-1)?.id : null;
        pages.push({ cursor, nextCursor: next, evidenceDigest: digest(result.data) });
        if (!result.has_more) return { accountId: stripeAccountId, pages, sessions, observedPaginationExhausted: true };
        if (!next || next === cursor) stop('PROVIDER_INVENTORY_CURSOR_STALLED'); cursor = next;
      }
      stop('PROVIDER_INVENTORY_PAGE_BOUND');
    }
    const before = await snapshot();
    const [schema, database, provider] = await Promise.all([
      Promise.all(stages.map(async ([query, verify]) => {
        const rows = await sql(query);
        if (!Array.isArray(rows) || rows.length !== 1) stop('SCHEMA_READBACK_INCOMPLETE');
        return verify(rows[0].json_build_object);
      })), databaseInventory(), providerInventory(),
    ]);
    const after = await snapshot();
    if (digest(before) !== digest(after)) stop('CONTEXT_DRIFT');
    const bySession = new Map(provider.sessions.map((s) => [s.id, s]));
    const observations = database.operations.map((operation) => {
      const session = bySession.get(operation.session_id);
      const ownershipMatches = !!session && [session.clientReferenceId, session.metadataUserId].some((id) => id === operation.user_id)
        && [session.clientReferenceId, session.metadataUserId].every((id) => id === null || id === operation.user_id);
      // Never upgrade an unknown DB operation to settled from a provider list.
      return { operationId: operation.operation_id, userId: operation.user_id, phase: operation.phase,
        providerStatus: ownershipMatches ? session.status : 'UNVERIFIED',
        disposition: ['issuing', 'unknown', 'open'].includes(operation.phase) ? 'quarantined' : 'REQUIRES_SEPARATE_SETTLEMENT_PROOF' };
    });
    return { status: 'HOLD', reason: 'MISSING_AUTHORITATIVE_DRAIN_EVIDENCE', missingCapabilities: missing,
      activationAuthorized: false, facts: { target, candidateSha, migrationDigest: ACCOUNT_CLOSURE_RUNTIME_SCHEMA_SHA256,
        ...after, schemaReceipt: { mode: 'verify', passed: true, stages: schema }, databaseInventory: { ...database, operations: observations },
        providerInventory: { accountId: provider.accountId, pages: provider.pages, sessionCount: provider.sessions.length,
          observedPaginationExhausted: provider.observedPaginationExhausted },
        regionalWorkerCoverage: 'UNVERIFIED', effectiveRuntimeValuesVerified: false } };
  }
  async function readAvailableFacts(requestTarget = target, externalSignal) {
      const controller = new AbortController();
      const signal = externalSignal ? AbortSignal.any([externalSignal, controller.signal]) : controller.signal;
      try { return await acquire(requestTarget, signal); }
      catch (error) { return { status: 'HOLD', reason: error instanceof AcquisitionError ? error.code : 'ACQUISITION_UNAVAILABLE', activationAuthorized: false }; }
      finally { controller.abort(); }
  }
  return { readAvailableFacts,
    async collectCurrentFacts(requestTarget, signal) {
      const result = await readAvailableFacts(requestTarget, signal);
      // Fail closed at the existing callback boundary. Partial facts cannot
      // accidentally satisfy registration's complete-current-context schema.
      throw new AcquisitionError(result.reason);
    },
  };
}
