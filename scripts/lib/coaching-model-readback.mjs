const MODEL = /^gemini-[a-z0-9][a-z0-9.-]{0,58}$/;
const READINESS = new Set(['not_checked', 'checking', 'verified', 'backoff', 'unavailable']);

export async function readDeployedCoachingModel({ url, projectRef, serviceKey, fetchImpl = globalThis.fetch }) {
  if (typeof projectRef !== 'string' || !/^[a-z0-9]{20}$/.test(projectRef)
    || typeof serviceKey !== 'string' || !serviceKey.trim()) return null;
  const expectedOrigin = 'https://' + projectRef + '.supabase.co';
  try {
    const endpoint = new URL(url);
    if (endpoint.origin !== expectedOrigin || endpoint.pathname !== '/' || endpoint.search || endpoint.hash
      || endpoint.username || endpoint.password) return null;
    const response = await fetchImpl(expectedOrigin + '/functions/v1/get-ai-suggestions', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(3000),
      headers: { 'Content-Type': 'application/json', apikey: serviceKey, Authorization: 'Bearer ' + serviceKey },
      body: JSON.stringify({ operation: 'active_model_readback' }),
    });
    if (!response.ok) return null;
    const state = await response.json();
    if (typeof state?.model !== 'string' || !MODEL.test(state.model) || !READINESS.has(state.readiness)) return null;
    return { model: state.model, readiness: state.readiness };
  } catch { return null; }
}
