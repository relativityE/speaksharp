// @vitest-environment node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import { performance } from 'node:perf_hooks';
import { summarize, renderMarkdown, renderPublicSummary, exitCodeForRows } from '../../scripts/lib/ops-health-report.mjs';

// Participate in the regular Vitest lane and allow dependency-free offline reproduction.
const { test } = process.env.NODE_TEST_CONTEXT ? await import('node:test') : await import('vitest');
const source = readFileSync(new URL('../../scripts/ops-health.mjs', import.meta.url), 'utf8');
const appUrl = 'https://app.example.invalid';
const supabaseUrl = 'https://supabase.example.invalid';
const authUrl = `${supabaseUrl}/auth/v1/settings`;
const usageUrl = `${supabaseUrl}/functions/v1/check-usage-limit`;

async function runMonitor({ statuses = {}, rejects = [], environment = {} } = {}) {
  const requests = [];
  const writes = new Map();
  const unexpected = [];
  const processMock = {
    env: {
      BASE_URL: appUrl,
      SUPABASE_URL: supabaseUrl,
      SUPABASE_ANON_KEY: 'offline-anon-key',
      OPS_HEALTH_OUTPUT_DIR: 'offline-output',
      ...environment,
    },
  };
  // All imports are replaced by explicit dependencies. No real process, filesystem,
  // provider evaluator, or network implementation is reachable from this execution.
  const body = source.replace(/^#!.*\n/, '').replace(/^import .*;\n/gm, '');
  await runInNewContext(`(async () => {\n${body}\n})()`, {
    process: processMock,
    fs: {
      mkdir: async () => {},
      writeFile: async (file, contents) => { writes.set(file, contents); },
    },
    path, performance, AbortController, setTimeout, clearTimeout,
    console: { log: () => {} },
    summarize, renderMarkdown, renderPublicSummary, exitCodeForRows,
    evaluateGithubRow: async () => { throw new Error('Unexpected GitHub evaluation'); },
    evaluateVercelRow: async () => { throw new Error('Unexpected Vercel evaluation'); },
    fetch: async (url, init) => {
      requests.push({ url, method: init.method || 'GET', headers: { ...init.headers } });
      if (![appUrl, authUrl, usageUrl].includes(url)) unexpected.push(url);
      if (rejects.includes(url)) throw new Error('offline transport failure');
      const status = statuses[url] ?? ([appUrl, authUrl, usageUrl].includes(url) ? 200 : 404);
      return { status, ok: status >= 200 && status < 300 };
    },
  });
  return {
    requests, unexpected, exitCode: processMock.exitCode,
    payload: JSON.parse(writes.get(path.join('offline-output', 'ops-health.json'))),
  };
}

function supabaseRow(result) {
  return result.payload.checks.find(row => row.name === 'Supabase API');
}

test('healthy active checks make only App, Auth and usage preflight requests, with no legacy dependency', async () => {
  const result = await runMonitor();
  assert.deepEqual(result.requests.map(({ url, method }) => ({ url, method })), [
    { url: appUrl, method: 'GET' },
    { url: authUrl, method: 'GET' },
    { url: usageUrl, method: 'OPTIONS' },
  ]);
  assert.deepEqual(result.requests[1].headers, { apikey: 'offline-anon-key', Authorization: 'Bearer offline-anon-key' });
  assert.equal(result.requests[2].headers.Origin, appUrl);
  assert.equal(result.requests[2].headers['Access-Control-Request-Method'], 'POST');
  assert.equal(supabaseRow(result).status, 'pass');
  assert.equal(supabaseRow(result).detail, 'auth=200; check-usage-limit=200');
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.payload.summary, { pass: 2, warn: 0, fail: 0, skip: 6 });
});

for (const [label, url] of [['Auth', authUrl], ['usage preflight', usageUrl]]) {
  test(`${label} HTTP failure remains a hard failure and nonzero exit`, async () => {
    const result = await runMonitor({ statuses: { [url]: 503 } });
    assert.deepEqual(result.unexpected, []);
    assert.equal(supabaseRow(result).status, 'fail');
    assert.match(supabaseRow(result).detail, /503/);
    assert.equal(result.exitCode, 1);
  });

  test(`${label} transport failure remains a hard failure and later rows are still reported`, async () => {
    const result = await runMonitor({ rejects: [url] });
    assert.equal(supabaseRow(result).status, 'fail');
    assert.match(supabaseRow(result).detail, /offline transport failure/);
    assert.equal(result.exitCode, 1);
    assert.equal(result.payload.checks.length, 8);
    assert.equal(result.payload.checks.at(-1).name, 'GitHub API');
  });
}

test('missing Supabase configuration retains skip semantics and makes no Supabase request', async () => {
  const result = await runMonitor({ environment: { SUPABASE_ANON_KEY: '' } });
  assert.equal(supabaseRow(result).status, 'skip');
  assert.equal(supabaseRow(result).detail, 'missing=SUPABASE_ANON_KEY|VITE_SUPABASE_ANON_KEY');
  assert.deepEqual(result.requests.map(request => request.url), [appUrl]);
  assert.equal(result.exitCode, 0);
});

test('an unrelated active App failure still makes the monitor exit nonzero', async () => {
  const result = await runMonitor({ statuses: { [appUrl]: 503 } });
  assert.equal(supabaseRow(result).status, 'pass');
  assert.equal(result.payload.checks.find(row => row.name === 'App').status, 'fail');
  assert.equal(result.exitCode, 1);
});
