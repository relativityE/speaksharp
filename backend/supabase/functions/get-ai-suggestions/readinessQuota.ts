/** Classify only the known per-model quota schema; do not return or retain raw Google error payloads. */
const ALLOWED_MODEL_QUOTAS = new Set([
  'GenerateRequestsPerDayPerProjectPerModel-FreeTier',
  'GenerateRequestsPerMinutePerProjectPerModel-FreeTier',
  'GenerateContentInputTokensPerModelPerMinute-FreeTier',
]);
const QUOTA_FAILURE = 'type.googleapis.com/google.rpc.QuotaFailure';
const RETRY_INFO = 'type.googleapis.com/google.rpc.RetryInfo';
export function readGeminiReadinessQuota(body: string | null, requestedModel: string) {
  let details: Array<Record<string, unknown>>;
  try {
    const error = JSON.parse(body ?? '').error;
    if (error.status !== 'RESOURCE_EXHAUSTED' || !Array.isArray(error.details) || error.details.length > 12) return null;
    details = error.details;
  } catch { return null; }
  let retryAfterMs: number | undefined;
  let identified = false;
  let allModelScoped = true;
  for (const detail of details) {
    if (!detail || typeof detail !== 'object') continue;
    if (detail['@type'] === RETRY_INFO) {
      const raw = typeof detail.retryDelay === 'string' ? detail.retryDelay : '';
      if (!/^\d{1,7}(?:\.\d{1,9})?s$/.test(raw)) allModelScoped = false;
      else retryAfterMs = Math.max(retryAfterMs ?? 0, Math.min(Math.ceil(Number(raw.slice(0, -1)) * 1000), 86_400_000));
    }
    if (detail['@type'] === QUOTA_FAILURE) {
      if (!Array.isArray(detail.violations) || detail.violations.length === 0 || detail.violations.length > 12) {
        allModelScoped = false;
        continue;
      }
      identified = true;
      for (const violation of detail.violations) {
        if (!violation || !ALLOWED_MODEL_QUOTAS.has(violation.quotaId)
          || violation.quotaDimensions?.model !== requestedModel
          || typeof violation.quotaMetric !== 'string'
          || !violation.quotaMetric.startsWith('generativelanguage.googleapis.com/')) allModelScoped = false;
      }
    }
  }
  return { scope: identified && allModelScoped ? 'model' as const : 'unknown' as const, retryAfterMs };
}
