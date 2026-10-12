import assert from 'node:assert/strict';
import { it as test } from 'vitest';
import { spawnSync } from 'node:child_process';
import { evaluateVercelRow, probeVercelAccess } from '../../scripts/lib/vercel-ops-row.mjs';

const config = { token: 'fake-secret', projectId: 'fake-project', teamId: 'fake-team' };
const forbidden = { error: { code: 'forbidden', message: 'Not authorized' } };
function scripted(outcomes) {
  const calls = [];
  const http = async (url, init) => {
    calls.push({ url, init });
    assert.ok(outcomes.length, 'unexpected extra request');
    const [status, body] = outcomes.shift();
    return { status, ok: status >= 200 && status < 300, text: async () => JSON.stringify(body) };
  };
  return { http, calls };
}

test('collector preserves scoped 403 and unscoped 200 plus initial safe evidence', async () => {
  const { http, calls } = scripted([[403, forbidden], [200, { deployments: [{ state: 'READY', url: 'example.vercel.app' }] }]]);
  const row = await evaluateVercelRow(config, http);
  assert.equal(row.status, 'warn');
  assert.match(row.detail, /scopeSupplied=false; http=200/);
  assert.match(row.detail, /initial=\{scopeSupplied=true; http=403; apiCode=forbidden; apiMessage=not_authorized\}/);
  assert.equal(calls.length, 2);
  assert.equal(new URL(calls[0].url).searchParams.get('teamId'), config.teamId);
  assert.equal(new URL(calls[1].url).searchParams.has('teamId'), false);
});

test('collector preserves both 403 statuses and their different safe codes', async () => {
  const { http } = scripted([[403, forbidden], [403, { error: { code: 'invalid_token', message: 'Invalid token' } }]]);
  const row = await evaluateVercelRow(config, http);
  assert.equal(row.status, 'fail');
  assert.match(row.detail, /scopeSupplied=false; http=403; apiCode=invalid_token/);
  assert.match(row.detail, /initial=\{scopeSupplied=true; http=403; apiCode=forbidden/);
});

test('absent team scope is explicit and never triggers collector fallback', async () => {
  const { http, calls } = scripted([[403, forbidden]]);
  const row = await evaluateVercelRow({ ...config, teamId: null }, http);
  assert.match(row.detail, /scopeSupplied=false; http=403/);
  assert.equal(calls.length, 1);
});

for (const teamId of [config.teamId, null]) {
  test(`diagnostic makes exactly one request on 403, scope=${Boolean(teamId)}`, async () => {
    const { http, calls } = scripted([[403, forbidden]]);
    const result = await probeVercelAccess({ ...config, teamId }, http);
    assert.deepEqual(result, { endpoint: 'GET /v6/deployments', scopeSupplied: Boolean(teamId), httpStatus: 403,
      errorEvidence: 'apiCode=forbidden; apiMessage=not_authorized', requestCount: 1 });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].init.method, 'GET');
    assert.equal(calls[0].init.headers.Authorization, `Bearer ${config.token}`);
    const output = JSON.stringify(result);
    for (const value of Object.values(config)) assert.ok(!output.includes(value));
  });
}

test('actual diagnostic command stops after one request with redirects disabled', () => {
  const preload = `
    let calls = 0;
    globalThis.fetch = async (url, init) => {
      if (++calls !== 1 || init.redirect !== 'error' || init.method !== 'GET' || !init.signal) throw new Error('bad request contract');
      return new Response(JSON.stringify({ error: { code: 'forbidden', message: 'Not authorized' } }), { status: 403 });
    };
    process.on('exit', () => { if (calls !== 1) process.exitCode = 2; });
  `;
  const result = spawnSync(process.execPath, ['--import', `data:text/javascript,${encodeURIComponent(preload)}`, 'scripts/probe-vercel-access.mjs'], {
    encoding: 'utf8',
    env: { ...process.env, VERCEL_ACCESS_TOKEN: config.token, VERCEL_PROJECT_ID: config.projectId, VERCEL_TEAM_ID: config.teamId },
  });
  assert.equal(result.status, 1);
  assert.equal(result.stderr, '');
  assert.deepEqual(JSON.parse(result.stdout), { endpoint: 'GET /v6/deployments', scopeSupplied: true, httpStatus: 403,
    errorEvidence: 'apiCode=forbidden; apiMessage=not_authorized', requestCount: 1 });
});
