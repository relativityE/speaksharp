import { vercelErrorEvidence } from './vercel-ops-error.mjs';

async function readAttempt({ projectId, token, teamId }, http) {
  const params = new URLSearchParams({ projectId, target: 'production', limit: '1' });
  if (teamId) params.set('teamId', teamId);
  const response = await http(`https://api.vercel.com/v6/deployments?${params}`, {
    method: 'GET', headers: { Authorization: `Bearer ${token}` },
  });
  const rawBody = await response.text();
  let body = null;
  try { body = JSON.parse(rawBody); } catch { /* Shape is reported through safe evidence. */ }
  return {
    body,
    ok: response.ok,
    endpoint: 'GET /v6/deployments',
    scopeSupplied: Boolean(teamId),
    httpStatus: response.status,
    errorEvidence: response.ok ? null : vercelErrorEvidence(rawBody),
  };
}

// Exactly one request. No collector fallback and no body/config values in the result.
export async function probeVercelAccess(config, http) {
  const { endpoint, scopeSupplied, httpStatus, errorEvidence } = await readAttempt(config, http);
  return { endpoint, scopeSupplied, httpStatus, errorEvidence, requestCount: 1 };
}

export async function evaluateVercelRow(config, http) {
  const first = await readAttempt(config, http);
  const teamScopeRejected = first.scopeSupplied && first.httpStatus === 403;
  const final = teamScopeRejected ? await readAttempt({ ...config, teamId: null }, http) : first;
  const deployment = final.body?.deployments?.[0];
  const ready = final.ok && deployment?.state === 'READY';
  const inProgress = final.ok && ['BUILDING', 'QUEUED', 'INITIALIZING'].includes(deployment?.state);
  const evidence = (attempt) => `scopeSupplied=${attempt.scopeSupplied}; http=${attempt.httpStatus}${attempt.errorEvidence ? `; ${attempt.errorEvidence}` : ''}`;
  return {
    status: ready ? (teamScopeRejected ? 'warn' : 'pass') : inProgress ? 'warn' : 'fail',
    detail: `${deployment?.state ? `latest=${deployment.state}; url=${deployment.url ?? 'unknown'}; ` : ''}${evidence(final)}${teamScopeRejected ? `; initial={${evidence(first)}}; used=unscoped` : ''}`,
    drilldownUrl: 'https://vercel.com/dashboard',
  };
}
