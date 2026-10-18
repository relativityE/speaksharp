import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { accountClosureEnforcementStages } from './accountClosureEnforcementGate.mjs';
import { ACCOUNT_CLOSURE_RUNTIME_SCHEMA_SHA256 } from './accountClosureEnforcementIdentity.mjs';

const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const uuid = (v) => typeof v === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
const sha = (v) => typeof v === 'string' && /^[a-f0-9]{40}$/.test(v);
const missing = ['AUTHORITATIVE_LEGACY_WORKER_DRAIN_EVIDENCE', 'PROTECTED_EFFECTIVE_RUNTIME_CONFIG_READBACK',
  'INDEPENDENT_PROVIDER_SETTLEMENT_VERIFICATION'];
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
 * Metadata: /v1-get-a-function only. No secret-store listing, values or hashes
 * are acquired. Allowed config facts come from separately authenticated runtime
 * probes; they cannot detect every out-of-band secret change or establish key
 * identity from its mode. Supported context changes must invalidate generation
 * BEFORE mutation. Function metadata does NOT enumerate
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
    const probeObservations = [];
    async function effectiveConfig(pin) {
      const nonce = randomBytes(32).toString('hex'); const startedAt = Date.now();
      const deploymentId = `${projectId}_${pin.id}_${pin.version}`;
      const value = await request(`${target.url}/functions/v1/${pin.function}?__operator_config=1`, serviceKey, 'POST',
        { nonce, expectedDeploymentId: deploymentId });
      const keys = ['version', 'function', 'nonce', 'projectId', 'deploymentId', 'region', 'executionId', 'observedAt', 'configuration'];
      const configKeys = ['paymentsEnabled', 'configuredStripeMode', 'capturedStripeMode', 'stripeModeMatches', 'siteOrigin', 'proPriceId', 'anonConfigured'];
      const c = value?.configuration;
      if (!value || Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))
        || value.version !== 1 || value.function !== pin.function || value.projectId !== projectId
        || value.deploymentId !== deploymentId || value.nonce !== nonce || !uuid(value.executionId)
        || typeof value.region !== 'string' || !/^[a-z0-9-]{1,40}$/.test(value.region)
        || !Number.isFinite(value.observedAt) || value.observedAt < startedAt - 5000 || value.observedAt > Date.now() + 5000
        || !c || Object.keys(c).length !== configKeys.length || configKeys.some((key) => !Object.hasOwn(c, key))
        || typeof c.paymentsEnabled !== 'boolean' || typeof c.anonConfigured !== 'boolean' || c.stripeModeMatches !== true
        || !['live', 'test', 'missing'].includes(c.capturedStripeMode) || c.capturedStripeMode !== c.configuredStripeMode
        || (c.proPriceId !== null && (typeof c.proPriceId !== 'string' || !/^price_[a-zA-Z0-9]+$/.test(c.proPriceId)))
        || (c.siteOrigin !== null && (typeof c.siteOrigin !== 'string' || !/^https:\/\/[a-zA-Z0-9.-]+(?::[0-9]+)?$/.test(c.siteOrigin)))) stop('EFFECTIVE_CONFIG_UNVERIFIED');
      probeObservations.push(value);
      return { function: pin.function, deploymentId, configuration: c };
    }
    async function snapshot() {
      const [generation, functions] = await Promise.all([
        request(`${target.url}/rest/v1/rpc/inspect_account_closure_drain_generation`, serviceKey, 'POST', {}),
        Promise.all(pinned.map(async (pin) => {
          const value = await request(`${management}/functions/${pin.function}`, managementToken);
          if (value?.slug !== pin.function || value.status !== 'ACTIVE' || value.id !== pin.id
            || value.version !== pin.version || value.ezbr_sha256 !== pin.bundleDigest) stop('DEPLOYMENT_ARTIFACT_MISMATCH');
          return { function: pin.function, id: value.id, version: value.version,
            deploymentId: `${projectId}_${value.id}_${value.version}`, bundleDigest: value.ezbr_sha256, candidateSha };
        })),
      ]);
      if (typeof generation !== 'string' || !/^(0|[1-9][0-9]{0,18})$/.test(generation) || BigInt(generation) > 9223372036854775807n) stop('INVALID_GENERATION');
      const configs = await Promise.all(pinned.map(effectiveConfig));
      // Nonces/timestamps/isolate IDs are retained as observations, not hashed
      // into the stable configuration binding. The later grant is excluded.
      return { generation, functions, configDigest: digest(configs) };
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
    async function providerReadbacks(database, provider) {
      // A paginated listing is not an independent settlement readback. Retrieve
      // exact objects with the already account-verified credential, retaining
      // provider-only and DB-linked-but-unlisted IDs. Keep both observations.
      const listed = new Map(provider.sessions.map((session) => [session.id, session]));
      const ids = [...new Set([...database.operations.map((row) => row.session_id).filter(Boolean), ...listed.keys()])];
      const sessions = [];
      for (const sessionId of ids.slice(0, 32)) {
        const value = await request(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, stripeKey);
        if (value?.object !== 'checkout.session' || value.id !== sessionId
          || value.livemode !== (environment === 'production')
          || !['open', 'complete', 'expired'].includes(value.status)
          || !['paid', 'unpaid', 'no_payment_required'].includes(value.payment_status)
          || ![value.customer, value.subscription].every((id, index) => id === null
            || (typeof id === 'string' && new RegExp(`^${index === 0 ? 'cus' : 'sub'}_[a-zA-Z0-9]+$`).test(id)))) {
          stop('PROVIDER_READBACK_UNVERIFIED');
        }
        const linked = database.operations.filter((row) => row.session_id === sessionId);
        const references = [value.client_reference_id ?? null, value.metadata?.userId ?? null];
        const ownershipMatchedOperationIds = linked.filter((row) => references.some((id) => id === row.user_id)
          && references.every((id) => id === null || id === row.user_id)).map((row) => row.operation_id);
        const observation = { sessionId, providerStatus: value.status, listedStatus: listed.get(sessionId)?.status ?? null,
          listStatusMatches: listed.get(sessionId)?.status === value.status,
          paymentStatus: value.payment_status, customerId: value.customer, subscriptionId: value.subscription,
          recoveryEnabled: value.after_expiration === null ? false
            : typeof value.after_expiration?.recovery?.enabled === 'boolean' ? value.after_expiration.recovery.enabled : null,
          ownershipMatchedOperationIds,
          // Stripe's contract explicitly says COMPLETE may still be processing:
          // https://docs.stripe.com/api/checkout/sessions/object#checkout_session_object-status
          // Even EXPIRED proves only that session's state, not global no-future-
          // charge, customer/subscription ownership, or accepted-call settlement.
          processing: value.status === 'expired' ? 'EXPIRED_SESSION_ONLY' : 'UNVERIFIED',
          disposition: linked.length === 0 ? 'REQUIRES_PROVIDER_ONLY_RECONCILIATION'
            : linked.some((row) => row.phase !== 'settled') ? 'quarantined' : 'REQUIRES_SEPARATE_SETTLEMENT_PROOF' };
        sessions.push({ ...observation, evidenceDigest: digest(observation), observedAt: new Date().toISOString() });
      }
      return { complete: ids.length <= 32, requestedSessionCount: ids.length, sessions,
        unreadSessionIds: ids.slice(32), providerSettlementVerified: false };
    }
    const before = await snapshot();
    const [schema, database, provider] = await Promise.all([
      Promise.all(stages.map(async ([query, verify]) => {
        const rows = await sql(query);
        if (!Array.isArray(rows) || rows.length !== 1) stop('SCHEMA_READBACK_INCOMPLETE');
        return verify(rows[0].json_build_object);
      })), databaseInventory(), providerInventory(),
    ]);
    const readbacks = await providerReadbacks(database, provider);
    const after = await snapshot();
    if (digest(before) !== digest(after)) stop('CONTEXT_DRIFT');
    const bySession = new Map(provider.sessions.map((s) => [s.id, s]));
    const operationsBySession = new Map();
    for (const operation of database.operations) {
      if (operation.session_id === null) continue;
      const linked = operationsBySession.get(operation.session_id) ?? [];
      linked.push(operation); operationsBySession.set(operation.session_id, linked);
    }
    const observations = database.operations.map((operation) => {
      const session = bySession.get(operation.session_id);
      const ownershipMatches = !!session && [session.clientReferenceId, session.metadataUserId].some((id) => id === operation.user_id)
        && [session.clientReferenceId, session.metadataUserId].every((id) => id === null || id === operation.user_id);
      // Never upgrade an unknown DB operation to settled from a provider list.
      return { operationId: operation.operation_id, userId: operation.user_id, sessionId: operation.session_id, phase: operation.phase,
        providerStatus: ownershipMatches ? session.status : 'UNVERIFIED',
        disposition: ['issuing', 'unknown', 'open'].includes(operation.phase) ? 'quarantined' : 'REQUIRES_SEPARATE_SETTLEMENT_PROOF' };
    });
    // Counts/page hashes cannot identify a provider-only checkout for later
    // reconciliation. Retain every opaque session ID, including unmatched and
    // closed sessions. A session-ID join is not ownership or settlement proof.
    const providerObservations = provider.sessions.map((session) => {
      const linked = operationsBySession.get(session.id) ?? [];
      return { sessionId: session.id, providerStatus: session.status, databaseOperationIds: linked.map((row) => row.operation_id),
        linkage: 'SESSION_ID_MATCH_ONLY', disposition: linked.length > 0 && linked.every((row) => row.phase === 'settled')
          ? 'REQUIRES_SEPARATE_SETTLEMENT_PROOF' : 'quarantined' };
    });
    return { status: 'HOLD', reason: 'MISSING_AUTHORITATIVE_DRAIN_EVIDENCE', missingCapabilities: missing,
      activationAuthorized: false, facts: { target, candidateSha, migrationDigest: ACCOUNT_CLOSURE_RUNTIME_SCHEMA_SHA256,
        ...after, schemaReceipt: { mode: 'verify', passed: true, stages: schema }, databaseInventory: { ...database, operations: observations },
        providerReadbacks: readbacks,
        providerInventory: { accountId: provider.accountId, pages: provider.pages, sessionCount: provider.sessions.length,
          sessions: providerObservations, observedPaginationExhausted: provider.observedPaginationExhausted },
        effectiveRuntimeObservations: probeObservations, respondingInstanceConfigVerified: true,
        secretStoreMetadataRead: false, configurationCoverage: 'RESPONDING_INSTANCES_ONLY',
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
