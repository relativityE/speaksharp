#!/usr/bin/env node
import { probeVercelAccess } from './lib/vercel-ops-row.mjs';

const token = process.env.VERCEL_ACCESS_TOKEN;
const projectId = process.env.VERCEL_PROJECT_ID;
const teamId = process.env.VERCEL_TEAM_ID || process.env.VERCEL_ORG_ID || null;

if (!token || !projectId) {
  console.log(JSON.stringify({ endpoint: 'GET /v6/deployments', scopeSupplied: Boolean(teamId), requestCount: 0, errorEvidence: 'missing-config' }));
  process.exitCode = 1;
} else {
  try {
    const result = await probeVercelAccess({ token, projectId, teamId }, (url, init) => fetch(url, {
      ...init, redirect: 'error', signal: AbortSignal.timeout(15_000),
    }));
    console.log(JSON.stringify(result));
    process.exitCode = result.httpStatus >= 200 && result.httpStatus < 300 ? 0 : 1;
  } catch {
    // Never print exceptions that may include credentials, URLs or response text.
    console.log(JSON.stringify({ endpoint: 'GET /v6/deployments', scopeSupplied: Boolean(teamId), requestCount: 1, errorEvidence: 'transport-error', httpStatus: null }));
    process.exitCode = 1;
  }
}
