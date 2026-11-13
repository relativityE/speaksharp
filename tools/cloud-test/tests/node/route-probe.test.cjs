'use strict';
// Consultant P0-2: the route probe uses the real production policy, the real environment and the guard's own upstreamSocket(). Exercised
// here on loopback only: no proxy configured, a proxy that refuses, a test-only policy refused, and a closed result per host.
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const path = require('node:path');
const { probe } = require(path.join(__dirname, '..', '..', 'harness', 'bundle', 'harness', 'route-probe.cjs'));

const SHA = 'a'.repeat(40);
const policy = (over = {}) => ({
  version: 1, sourceSha: SHA, logPaths: false,
  hosts: { 'app.example.test': { port: 443, rules: [{ id: 'r', methods: ['GET'], path: '^/$', cap: 'public', reviewedSourceSha: SHA }] },
           'api.example.test': { port: 443, rules: [{ id: 'r2', methods: ['GET'], path: '^/$', cap: 'public', reviewedSourceSha: SHA }] } },
  caps: { total: 10, navigations: 10, public: 10 }, maxInFlight: 2, queueWaitMs: 1000, requestTimeoutMs: 1000,
  deadlineAt: new Date(Date.now() + 600000).toISOString(), upstream: { mode: 'env-proxy' }, ...over,
});

function withEnv(env, fn) {
  const keys = ['HTTPS_PROXY', 'https_proxy', 'NO_PROXY', 'no_proxy'];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const k of keys) delete process.env[k];
  Object.assign(process.env, env);
  return fn().finally(() => { for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });
}

test('no HTTPS proxy configured: every host is proxy-not-configured and the probe blocks', () => withEnv({}, async () => {
  const out = await probe(policy(), { timeoutMs: 2000 });
  assert.deepEqual(out, { schema: 'speaksharp.cloud-test.route-probe.v1', result: 'BLOCKED',
    hosts: [{ host: 'api.example.test', result: 'proxy-not-configured' }, { host: 'app.example.test', result: 'proxy-not-configured' }] });
}));

test('a proxy that refuses the connection blocks with a closed reason, and nothing hangs', async () => {
  const server = net.createServer(); await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port; await new Promise((r) => server.close(r));   // a now-closed loopback port
  await withEnv({ HTTPS_PROXY: 'http://127.0.0.1:' + port }, async () => {
    const out = await probe(policy(), { timeoutMs: 3000 });
    assert.equal(out.result, 'BLOCKED');
    for (const h of out.hosts) assert.match(h.result, /^(connect-refused|proxy-connect-status|reset|other)$/);
  });
});

test('a proxy that accepts but never answers ends as timeout, within the bound', async () => {
  const sockets = new Set();
  const server = net.createServer((s) => { sockets.add(s); s.on('error', () => {}); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    await withEnv({ HTTPS_PROXY: 'http://127.0.0.1:' + server.address().port }, async () => {
      const t0 = Date.now();
      const out = await probe(policy(), { timeoutMs: 500 });
      assert.deepEqual(out.hosts.map((h) => h.result), ['timeout', 'timeout']);
      assert.ok(Date.now() - t0 < 5000);
    });
  } finally { for (const s of sockets) s.destroy(); server.close(); }
});

test('a test-only policy is refused: the probe proves only the production route', async () => {
  await assert.rejects(probe(policy({ testOnly: true })), /production policy/);
});
