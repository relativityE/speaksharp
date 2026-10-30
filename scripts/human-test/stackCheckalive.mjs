import { createHash } from 'node:crypto';
import { readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// This collects existing receipts. It never probes a service or turns API health into ingestion.
export const COMPONENTS = Object.freeze([
  'frontend-release', 'auth-effective-access', 'schema-and-edge-binding',
  'mic-and-stt-acquisition', 'recording-stop-save', 'coaching-provider',
  'feedback-readback', 'sentry-api', 'sentry-ingestion', 'posthog-api',
  'posthog-ingestion', 'guard-and-ownership',
]);
const SHA = /^[a-f0-9]{40}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const ID = /^[a-zA-Z0-9_-]{1,100}$/;
const CASE = /^AHT-(?:0[1-9]|1[0-5])$/;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const EXCLUSIONS = ['NO_RECORDING_IN_PROFILE', 'NO_COACHING_IN_PROFILE', 'NO_FEEDBACK_IN_PROFILE'];
const EXCLUDABLE = {
  'mic-and-stt-acquisition': 'NO_RECORDING_IN_PROFILE',
  'recording-stop-save': 'NO_RECORDING_IN_PROFILE',
  'coaching-provider': 'NO_COACHING_IN_PROFILE',
  'feedback-readback': 'NO_FEEDBACK_IN_PROFILE',
};
const MAX_BYTES = 1024 * 1024;
const matches = (pattern, value) => typeof value === 'string' && pattern.test(value);
const validAttemptIds = (ids) => Array.isArray(ids) && ids.length > 0
  && ids.every((id) => matches(ID, id)) && new Set(ids).size === ids.length;
const timestamp = (s) => typeof s === 'string' && UTC.test(s) && Number.isFinite(Date.parse(s));
const safeRef = (s) => typeof s === 'string' && /^[a-zA-Z0-9_./-]{1,200}$/.test(s)
  && !isAbsolute(s) && !s.split('/').some((part) => !part || part === '.' || part === '..');

function observedOperation(component, producer, data, expectedBinding) {
  if (producer === 'ops-health' && ['sentry-api', 'posthog-api'].includes(component)) {
    const name = component === 'sentry-api' ? 'Sentry API' : 'PostHog API';
    const checks = data?.checks?.filter((c) => c.name === name);
    if (checks?.length !== 1) return { reason: 'MISSING_COMPONENT_RECEIPT' };
    const row = checks[0];
    return {
      status: row.status === 'pass' ? 'PASS' : row.status === 'fail' ? 'FAIL' : 'BLOCKED',
      operation: 'API_HEALTH', observedUtc: row.checkedAt,
    };
  }
  if (producer === 'telemetry-readback' && component === 'posthog-ingestion') {
    if (data?.gate !== 'TELEMETRY-READBACK-COMPLETENESS') return { reason: 'WRONG_RECEIPT_KIND' };
    // A positive transport response, an empty read, or a client capture never meets this contract.
    if (!['canary', 'internal_test'].includes(data.traffic_type) || data.identity_bound !== true
      || !matches(ID, data.boot_id) || !matches(ID, data.journey_id)
      || !matches(ID, expectedBinding?.bootId) || !matches(ID, expectedBinding?.journeyId)
      || !expectedBinding || data.boot_id !== expectedBinding.bootId
      || data.journey_id !== expectedBinding.journeyId
      || !validAttemptIds(expectedBinding.attemptIds) || !validAttemptIds(data.attempts_declared)
      || data.attempts_declared.length !== expectedBinding.attemptIds.length
      || !expectedBinding.attemptIds.every((id) => data.attempts_declared.includes(id))
      || !Array.isArray(data.required_families) || data.required_families.length === 0
      || new Set(data.required_families).size !== data.required_families.length) {
      return { reason: 'UNBOUND_RECEIVED_EVIDENCE' };
    }
    if (data.verdict === 'FAIL') return { status: 'FAIL', operation: 'RECEIVED_EVENT' };
    if (data.verdict !== 'QUALIFIED' || !Array.isArray(data.missing) || data.missing.length
      || !Array.isArray(data.unrecognised) || data.unrecognised.length
      || !Array.isArray(data.reasons) || data.reasons.length
      || !Array.isArray(data.duplicate_families) || data.duplicate_families.length
      || !Array.isArray(data.delivery_failures) || data.delivery_failures.length
      || !Array.isArray(data.observed_families)
      || !data.required_families.every((family) => typeof family === 'string' && data.observed_families.includes(family))
      || !data.received_counts || Object.keys(data.received_counts).length === 0
      || !Object.values(data.received_counts).every((count) => count === 1)) {
      return { reason: 'INGESTION_NOT_QUALIFIED' };
    }
    return { status: 'PASS', operation: 'RECEIVED_EVENT' };
  }
  if (producer === 'canary' && component === 'recording-stop-save') {
    // Snapshot of canary.yml's existing terminal inputs, not the workflow's aggregate badge.
    if (data?.bindingResult !== 'success' || data?.readinessResult !== 'success'
      || data?.migrationReady !== true || data?.targetReleaseSha == null) {
      return { reason: 'CANARY_PREREQUISITE_HELD' };
    }
    if (data.productLanesResult === 'failure') return { status: 'FAIL', operation: 'PRODUCT_CANARY' };
    if (data.productLanesResult !== 'success') return { reason: 'PRODUCT_CANARY_NOT_RUN' };
    return { status: 'PASS', operation: 'PRODUCT_CANARY' };
  }
  // No received-Sentry or other product proof adapter exists yet. Do not invent one.
  return { reason: 'PRODUCER_NOT_SUPPORTED' };
}

/** A bound wrapper must come from the owning runner/reader. This collector does not mint authority. */
export async function collectStackStatus(profile, { root, now = new Date().toISOString() }) {
  const validProfile = profile?.schema === 'speaksharp.stack-profile.v1'
    && matches(ID, profile.runId) && matches(SHA, profile.releaseSha)
    && matches(SHA, profile.sourceSha) && timestamp(now) && Array.isArray(profile.components)
    && profile.components.length === COMPONENTS.length
    && new Set(profile.components.map((c) => c?.component)).size === COMPONENTS.length
    && profile.components.every((c) => COMPONENTS.includes(c?.component)
      && Array.isArray(c.cases) && c.cases.length > 0 && c.cases.every((s) => matches(CASE, s))
      && Number.isInteger(c.maxAgeSeconds) && c.maxAgeSeconds > 0 && c.maxAgeSeconds <= 86400
      && (c.required === true || (c.required === false && EXCLUSIONS.includes(c.exclusionReason)
        && EXCLUDABLE[c.component] === c.exclusionReason)));
  const result = {
    schema: 'speaksharp.stack-checkalive.v1',
    runId: validProfile ? profile.runId : null,
    releaseSha: validProfile ? profile.releaseSha : null,
    sourceSha: validProfile ? profile.sourceSha : null,
    observedUtc: timestamp(now) ? now : null,
    status: 'BLOCKED', reason: validProfile ? null : 'INVALID_PROFILE', components: [],
  };
  if (!validProfile) return result;
  for (const item of profile.components) {
    const row = { component: item.component, cases: [...item.cases], status: 'BLOCKED',
      operation: 'NOT_MEASURED', observedUtc: null, receiptRef: null, receiptSha256: null,
      reason: 'MISSING_RECEIPT' };
    result.components.push(row);
    if (!item.required) {
      Object.assign(row, { status: 'EXCLUDED', reason: item.exclusionReason });
      continue;
    }
    const evidence = item.evidence;
    if (!evidence) continue;
    if (!safeRef(evidence.path) || !matches(DIGEST, evidence.sha256)) {
      row.reason = 'INVALID_REFERENCE';
      continue;
    }
    try {
      const base = await realpath(root);
      const file = await realpath(resolve(base, evidence.path));
      const rel = relative(base, file);
      if (isAbsolute(rel) || rel === '..' || rel.startsWith('../')) throw new Error('outside root');
      const bytes = await readFile(file);
      if (bytes.length > MAX_BYTES) throw new Error('oversize');
      const digest = createHash('sha256').update(bytes).digest('hex');
      if (digest !== evidence.sha256) { row.reason = 'DIGEST_MISMATCH'; continue; }
      const receipt = JSON.parse(bytes.toString('utf8'));
      row.receiptRef = evidence.path;
      row.receiptSha256 = digest;
      if (receipt.schema !== 'speaksharp.bound-stack-receipt.v1'
        || receipt.runId !== profile.runId || receipt.releaseSha !== profile.releaseSha
        || receipt.sourceSha !== profile.sourceSha) { row.reason = 'BINDING_MISMATCH'; continue; }
      const age = Date.parse(now) - Date.parse(receipt.observedUtc);
      if (!timestamp(receipt.observedUtc) || age < 0 || age > item.maxAgeSeconds * 1000) {
        row.reason = 'STALE_RECEIPT'; continue;
      }
      const operation = observedOperation(item.component, receipt.producer, receipt.data, item.binding);
      if (operation.reason) { row.reason = operation.reason; continue; }
      if (receipt.producer === 'telemetry-readback' && receipt.data.release_sha !== profile.releaseSha
        || receipt.producer === 'canary' && receipt.data.targetReleaseSha !== profile.releaseSha) {
        row.reason = 'BINDING_MISMATCH'; continue;
      }
      const observedUtc = operation.observedUtc ?? receipt.observedUtc;
      const operationAge = Date.parse(now) - Date.parse(observedUtc);
      if (!timestamp(observedUtc) || operationAge < 0 || operationAge > item.maxAgeSeconds * 1000) {
        row.reason = 'STALE_RECEIPT'; continue;
      }
      Object.assign(row, { status: operation.status, operation: operation.operation, observedUtc,
        reason: operation.status === 'PASS' ? null : 'PRODUCER_NON_SUCCESS' });
    } catch {
      // Never retain raw parse, path or vendor errors; they may contain customer content or tokens.
      row.reason = 'UNREADABLE_RECEIPT';
    }
  }
  result.status = result.components.some((c) => c.status === 'FAIL') ? 'FAIL'
    : result.components.some((c) => c.status === 'BLOCKED') ? 'BLOCKED' : 'PASS';
  return result;
}

export async function writeStackStatus(profilePath, outputPath, { now } = {}) {
  let profile;
  try { profile = JSON.parse(await readFile(profilePath, 'utf8')); } catch { profile = null; }
  const report = await collectStackStatus(profile, { root: dirname(resolve(profilePath)), now });
  // Persist a refusal too; missing input must not leave an older green receipt in place.
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [, , profilePath, outputPath] = process.argv;
  if (!profilePath || !outputPath) {
    console.error('Usage: node scripts/human-test/stackCheckalive.mjs <profile.json> <new-result.json>');
    process.exitCode = 2;
  } else {
    try {
      const result = await writeStackStatus(profilePath, outputPath);
      console.log(`STACK_CHECKALIVE ${result.status}`);
      process.exitCode = result.status === 'PASS' ? 0 : 1;
    } catch {
      console.error('STACK_CHECKALIVE BLOCKED: result could not be persisted');
      process.exitCode = 2;
    }
  }
}
