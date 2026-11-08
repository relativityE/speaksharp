'use strict';
// The PO-approved restrictive CONNECT service (scripts/egress_connect_proxy.cjs). Loopback-only fixtures: the resolver and the upstream
// connector are injected so the production address checks run on public-looking answers while bytes go to a local test server. No
// production host, credential or network is used. The compatibility test drives the REAL guard upstreamSocket through the service.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const tls = require('node:tls');
const { spawnSync, spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const P = require(path.join(ROOT, 'scripts', 'egress_connect_proxy.cjs'));
const BUNDLE = path.join(ROOT, 'harness', 'bundle');
const HOST = 'app.example.com';
const PUBLIC = [{ address: '93.184.216.34', family: 4 }];

function echoServer(t) {
  return new Promise((resolve) => {
    const s = net.createServer((c) => c.pipe(c));
    s.listen(0, '127.0.0.1', () => { t.after(() => s.close()); resolve(s.address().port); });
  });
}

async function proxyWith(t, { lookup = async () => PUBLIC, port, limits } = {}) {
  const connect = (opts) => { assert.equal(opts.port, 443); assert.equal(net.isIP(opts.host) > 0, true, 'connects to the checked address'); return net.connect({ host: '127.0.0.1', port }); };
  const proxy = P.createProxy({ hosts: [HOST, 'api.example.com'], lookup, connect, ...(limits ? { limits } : {}) });
  const listen = await proxy.listen();
  t.after(() => proxy.close());
  return { proxy, port: listen };
}

function rawRequest(port, text, { keep = false } = {}) {
  return new Promise((resolve, reject) => {
    const s = net.connect({ host: '127.0.0.1', port }, () => s.write(text));
    let buf = '';
    s.on('data', (d) => {
      buf += d.toString('latin1');
      if (buf.includes('\r\n\r\n')) { if (keep) resolve({ head: buf, socket: s }); else { s.destroy(); resolve({ head: buf }); } }
    });
    s.on('error', reject);
    s.on('close', () => resolve({ head: buf }));
  });
}

test('the forbidden-address table: loopback, private, link-local, CGNAT, metadata, multicast, unparsable all refuse; public passes', () => {
  for (const a of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1',
    '::1', '::', 'fe80::1', 'fd00::1', 'fc00::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', 'not-an-ip', '', undefined]) {
    assert.equal(P.forbiddenAddress(a), true, String(a));
  }
  for (const a of ['93.184.216.34', '76.76.21.21', '104.18.1.1', '172.64.1.1', '2606:4700::6810:1', '::ffff:93.184.216.34']) assert.equal(P.forbiddenAddress(a), false, a);
});

test('canonical classification: every textual form of a forbidden address refuses, on bytes, not text prefixes', () => {
  const forbidden = ['::ffff:7f00:1', '::FFFF:7F00:0001', '0:0:0:0:0:ffff:7f00:1', '::ffff:a00:1', '::ffff:a9fe:a9fe', '::127.0.0.1', '::7f00:1',
    '0:0:0:0:0:0:0:1', '0000:0000:0000:0000:0000:0000:0000:0001', '::0', '64:ff9b::808:808', '64:ff9b:1::1', '2002:7f00:1::', '2002:5db8:d822::1',
    '2001:0:1::', '2001:db8::1', '2001:0DB8::1', '100::1', 'FE80::1', 'febf::1', 'fec0::1', 'FC00::1', 'fdff::1', 'ff02::1', 'FF0E::1',
    '::ffff:192.168.0.1', '::ffff:100.64.0.1', '::ffff:198.18.0.1', '1:2:3', 'gggg::1', '1::2::3', '::ffff:256.1.1.1',
    // Sam 1794169935: reserved / non-public inside or outside 2000::/3
    '2001:2::1', '2001:10::1', '2001:20::1', '3fff::1', '4000::1', '2001:1ff:ffff::1', '3fff:fff::1', '1000::1', '8000::1', 'e000::1'];
  for (const a of forbidden) assert.equal(P.forbiddenAddress(a), true, a);
  for (const a of ['2606:4700::6810:1', '2600:1f18::1', '::ffff:5db8:d822', '::ffff:93.184.216.34', '2a06:98c1:3120::3', '2001:200::1',
    '2001:4860:4860::8888', '3fff:1000::1', '3ff0::1']) assert.equal(P.forbiddenAddress(a), false, a);
  assert.deepEqual(P.v6Bytes('::ffff:7f00:1'), P.v6Bytes('::ffff:127.0.0.1'));
  assert.deepEqual(P.v6Bytes('0:0:0:0:0:0:0:1'), P.v6Bytes('::1'));
});

test('a late DNS answer never connects: past the bound, after the client closed, or after shutdown began', async (t) => {
  const echo = await echoServer(t);
  let connects = 0;
  const connect = () => { connects += 1; return net.connect({ host: '127.0.0.1', port: echo }); };
  // (1) the lookup outlives its bound: a closed dns-failed refusal, no connect
  {
    const proxy = P.createProxy({ hosts: [HOST], lookup: () => new Promise((r) => setTimeout(() => r(PUBLIC), 400)), connect, limits: { ...P.LIMITS, dnsTimeoutMs: 50 } });
    const port = await proxy.listen(); t.after(() => proxy.close());
    const { head } = await rawRequest(port, `CONNECT ${HOST}:443 HTTP/1.1\r\nHost: x\r\n\r\n`);
    assert.match(head, /^HTTP\/1\.1 502 [\s\S]*dns-failed/);
    await new Promise((r) => setTimeout(r, 500));
    assert.equal(connects, 0);
  }
  // (2) the client goes away while DNS is pending: the late answer is dropped
  {
    let release; const pending = new Promise((r) => { release = r; });
    const proxy = P.createProxy({ hosts: [HOST], lookup: () => pending.then(() => PUBLIC), connect });
    const port = await proxy.listen(); t.after(() => proxy.close());
    const s = net.connect({ host: '127.0.0.1', port }, () => s.write(`CONNECT ${HOST}:443 HTTP/1.1\r\nHost: x\r\n\r\n`));
    await new Promise((r) => setTimeout(r, 100)); s.destroy(); await new Promise((r) => setTimeout(r, 50));
    release(); await new Promise((r) => setTimeout(r, 100));
    assert.equal(connects, 0);
    assert.equal(proxy.counters.denied['client-gone'], 1);
  }
  // (3) shutdown begins while DNS is pending: nothing connects afterwards
  {
    let release; const pending = new Promise((r) => { release = r; });
    const proxy = P.createProxy({ hosts: [HOST], lookup: () => pending.then(() => PUBLIC), connect });
    const port = await proxy.listen();
    const s = net.connect({ host: '127.0.0.1', port }, () => s.write(`CONNECT ${HOST}:443 HTTP/1.1\r\nHost: x\r\n\r\n`));
    s.on('error', () => {});
    await new Promise((r) => setTimeout(r, 100));
    const closed = proxy.close();
    release(); await closed; await new Promise((r) => setTimeout(r, 100));
    assert.equal(connects, 0);
  }
});

test('only the CODE-pinned production policy is served, and its hosts are exactly the policy hosts', () => {
  const { hosts, policySha256 } = P.reviewedPolicy(BUNDLE);
  const policy = JSON.parse(fs.readFileSync(path.join(BUNDLE, 'config', 'policy.production.TEMPLATE.json'), 'utf8'));
  assert.deepEqual(hosts, Object.keys(policy.hosts).map((h) => h.toLowerCase()));
  assert.match(fs.readFileSync(path.join(BUNDLE, 'CODE.sha256'), 'utf8'), new RegExp(`^${policySha256}\\s+config/policy\\.production\\.TEMPLATE\\.json$`, 'm'));
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'egress-proxy-')); t_cleanup(d);
  fs.mkdirSync(path.join(d, 'config'));
  fs.copyFileSync(path.join(BUNDLE, 'CODE.sha256'), path.join(d, 'CODE.sha256'));
  fs.writeFileSync(path.join(d, 'config', 'policy.production.TEMPLATE.json'), JSON.stringify({ ...policy, hosts: { ...policy.hosts, 'evil.example.net': {} } }));
  assert.throws(() => P.reviewedPolicy(d), /policy-not-reviewed/);
});
function t_cleanup(d) { process.on('exit', () => fs.rmSync(d, { recursive: true, force: true })); }

test('every refusal is closed, counted and never reaches the upstream connector', async (t) => {
  const echo = await echoServer(t);
  const cases = [
    ['CONNECT 93.184.216.34:443 HTTP/1.1\r\nHost: x\r\n\r\n', 'ip-literal', 403],
    ['CONNECT [2606:4700::1]:443 HTTP/1.1\r\nHost: x\r\n\r\n', 'ip-literal', 403],
    [`CONNECT ${HOST}:80 HTTP/1.1\r\nHost: x\r\n\r\n`, 'port-not-443', 403],
    [`CONNECT ${HOST}:8443 HTTP/1.1\r\nHost: x\r\n\r\n`, 'port-not-443', 403],
    ['CONNECT other.example.com:443 HTTP/1.1\r\nHost: x\r\n\r\n', 'host-not-in-policy', 403],
    [`CONNECT sub.${HOST}:443 HTTP/1.1\r\nHost: x\r\n\r\n`, 'host-not-in-policy', 403],
    [`CONNECT ${HOST} HTTP/1.1\r\nHost: x\r\n\r\n`, 'malformed-target', 400],
    [`GET http://${HOST}/ HTTP/1.1\r\nHost: ${HOST}\r\n\r\n`, 'not-connect', 405],
    ['GET / HTTP/1.1\r\nHost: x\r\n\r\n', 'not-connect', 405],
  ];
  let connected = 0;
  const proxy = P.createProxy({ hosts: [HOST], lookup: async () => PUBLIC, connect: () => { connected += 1; return net.connect({ host: '127.0.0.1', port: echo }); } });
  const port = await proxy.listen(); t.after(() => proxy.close());
  for (const [req, reason, status] of cases) {
    const { head } = await rawRequest(port, req);
    assert.match(head, new RegExp(`^HTTP/1\\.1 ${status} `), req);
    assert.match(head, new RegExp(`x-ss-egress-deny: ${reason}`), req);
  }
  assert.equal(connected, 0);
  assert.equal(proxy.counters.denied['ip-literal'], 2);
  assert.equal(proxy.counters.denied['not-connect'], 2);
  assert.deepEqual(Object.keys(proxy.counters.denied), [...P.DENY_REASONS]);
});

test('a policy host whose DNS answer is private, loopback or metadata is refused before any connect; DNS failure is refused', async (t) => {
  const echo = await echoServer(t);
  for (const [answers, reason, status] of [[[{ address: '10.0.0.5', family: 4 }], 'dns-forbidden-address', 403],
    [[{ address: '93.184.216.34', family: 4 }, { address: '127.0.0.1', family: 4 }], 'dns-forbidden-address', 403],
    [[{ address: '169.254.169.254', family: 4 }], 'dns-forbidden-address', 403], [[], 'dns-forbidden-address', 403], [null, 'dns-failed', 502]]) {
    const { port, proxy } = await proxyWith(t, { port: echo, lookup: async () => { if (answers === null) throw new Error('ENOTFOUND'); return answers; } });
    const { head } = await rawRequest(port, `CONNECT ${HOST}:443 HTTP/1.1\r\nHost: x\r\n\r\n`);
    assert.match(head, new RegExp(`^HTTP/1\\.1 ${status} [\\s\\S]*x-ss-egress-deny: ${reason}`), JSON.stringify(answers));
    assert.equal(Object.values(proxy.counters.allowed).reduce((a, b) => a + b, 0), 0);
  }
});

test('an allowed CONNECT gets 200 and relays bytes unchanged to the checked address; IPv4 is preferred; counted per host', async (t) => {
  const echo = await echoServer(t);
  let seen = null;
  const proxy = P.createProxy({ hosts: [HOST], lookup: async () => [{ address: '2606:4700::6810:1', family: 6 }, { address: '93.184.216.34', family: 4 }],
    connect: (o) => { seen = o; return net.connect({ host: '127.0.0.1', port: echo }); } });
  const port = await proxy.listen(); t.after(() => proxy.close());
  const { head, socket } = await rawRequest(port, `CONNECT ${HOST.toUpperCase()}:443 HTTP/1.1\r\nHost: x\r\n\r\n`, { keep: true });
  assert.match(head, /^HTTP\/1\.1 200 Connection Established\r\n\r\n$/);
  assert.deepEqual(seen, { host: '93.184.216.34', port: 443, family: 4 });
  const reply = await new Promise((resolve) => { socket.once('data', (d) => resolve(d.toString())); socket.write('opaque-tls-bytes'); });
  assert.equal(reply, 'opaque-tls-bytes');
  socket.destroy();
  assert.deepEqual(proxy.counters.allowed, { [HOST]: 1 });
});

test('concurrency is bounded and an unreachable upstream is a closed 502', async (t) => {
  const echo = await echoServer(t);
  const { port, proxy } = await proxyWith(t, { port: echo, limits: { ...P.LIMITS, maxConcurrent: 1 } });
  const first = await rawRequest(port, `CONNECT ${HOST}:443 HTTP/1.1\r\nHost: x\r\n\r\n`, { keep: true });
  assert.match(first.head, /^HTTP\/1\.1 200/);
  const second = await rawRequest(port, `CONNECT ${HOST}:443 HTTP/1.1\r\nHost: x\r\n\r\n`);
  assert.match(second.head, /^HTTP\/1\.1 503 [\s\S]*over-capacity/);
  first.socket.destroy();
  const dead = net.createServer(); await new Promise((r) => dead.listen(0, '127.0.0.1', r)); const deadPort = dead.address().port; await new Promise((r) => dead.close(r));
  const p2 = P.createProxy({ hosts: [HOST], lookup: async () => PUBLIC, connect: () => net.connect({ host: '127.0.0.1', port: deadPort }) });
  const port2 = await p2.listen(); t.after(() => p2.close());
  const { head } = await rawRequest(port2, `CONNECT ${HOST}:443 HTTP/1.1\r\nHost: x\r\n\r\n`);
  assert.match(head, /^HTTP\/1\.1 502 [\s\S]*upstream-connect-failed/);
  assert.equal(proxy.counters.denied['over-capacity'], 1);
});

test('compatibility: the REAL guard upstreamSocket (env-proxy) reaches a TLS server through the service with full certificate verification', async (t) => {
  if (spawnSync('openssl', ['version']).status !== 0) return t.skip('openssl unavailable for the throwaway test certificate');
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'egress-tls-')); t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const r = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', `/CN=${HOST}`, '-addext', `subjectAltName=DNS:${HOST}`,
    '-keyout', path.join(d, 'key.pem'), '-out', path.join(d, 'cert.pem')], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const server = tls.createServer({ key: fs.readFileSync(path.join(d, 'key.pem')), cert: fs.readFileSync(path.join(d, 'cert.pem')) }, (s) => s.end('hello-over-tls'));
  await new Promise((res) => server.listen(0, '127.0.0.1', res)); t.after(() => server.close());
  const proxy = P.createProxy({ hosts: [HOST], lookup: async () => PUBLIC, connect: () => net.connect({ host: '127.0.0.1', port: server.address().port }) });
  const port = await proxy.listen(); t.after(() => proxy.close());
  const { upstreamSocket } = require(path.join(BUNDLE, 'harness', 'guard-proxy.cjs'));
  const saved = { HTTPS_PROXY: process.env.HTTPS_PROXY, https_proxy: process.env.https_proxy, NO_PROXY: process.env.NO_PROXY };
  process.env.HTTPS_PROXY = `http://127.0.0.1:${port}`; delete process.env.https_proxy; delete process.env.NO_PROXY;
  try {
    const policy = { testOnly: true, upstream: { mode: 'env-proxy', caFile: path.join(d, 'cert.pem') } };
    const sock = await upstreamSocket(policy, HOST, new AbortController().signal);
    const text = await new Promise((res) => { let b = ''; sock.on('data', (x) => { b += x; }); sock.on('end', () => res(b)); });
    assert.equal(text, 'hello-over-tls');
    assert.equal(sock.authorized, true, 'the guard verified the certificate end to end');
    // a host the service refuses surfaces in the guard as its closed proxy-connect-status reason
    await assert.rejects(upstreamSocket(policy, 'other.example.com', new AbortController().signal), (e) => /CONNECT 403/.test(e.message));
    // Sam 1794169935: verification failures are real failures through the service. (1) wrong host: the service tunnels an ALLOWED host
    // to a server whose certificate names another host; (2) untrusted: the same server without the test CA. Both reject, no bytes.
    const wrong = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=elsewhere.example.org',
      '-addext', 'subjectAltName=DNS:elsewhere.example.org', '-keyout', path.join(d, 'wkey.pem'), '-out', path.join(d, 'wcert.pem')], { encoding: 'utf8' });
    assert.equal(wrong.status, 0, wrong.stderr);
    let wrongBytes = 0;
    const wrongServer = tls.createServer({ key: fs.readFileSync(path.join(d, 'wkey.pem')), cert: fs.readFileSync(path.join(d, 'wcert.pem')) },
      (s) => { wrongBytes += 1; s.end('must-not-arrive'); });
    await new Promise((res) => wrongServer.listen(0, '127.0.0.1', res)); t.after(() => wrongServer.close());
    const p2 = P.createProxy({ hosts: [HOST], lookup: async () => PUBLIC, connect: () => net.connect({ host: '127.0.0.1', port: wrongServer.address().port }) });
    const port2 = await p2.listen(); t.after(() => p2.close());
    process.env.HTTPS_PROXY = `http://127.0.0.1:${port2}`;
    await assert.rejects(upstreamSocket({ testOnly: true, upstream: { mode: 'env-proxy', caFile: path.join(d, 'wcert.pem') } }, HOST, new AbortController().signal),
      (e) => /altnames|hostname|ERR_TLS_CERT_ALTNAME_INVALID/i.test(`${e.code} ${e.message}`), 'wrong host must fail verification');
    process.env.HTTPS_PROXY = `http://127.0.0.1:${port}`;
    await assert.rejects(upstreamSocket({ upstream: { mode: 'env-proxy' } }, HOST, new AbortController().signal),
      (e) => /self.signed|SELF_SIGNED|unable to verify|DEPTH_ZERO/i.test(`${e.code} ${e.message}`), 'an untrusted certificate must fail verification');
    assert.equal(wrongBytes, 0, 'no application bytes over a failed verification');
  } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
  assert.deepEqual(proxy.counters.allowed, { [HOST]: 2 });   // the verified connection and the untrusted-certificate attempt
  assert.equal(proxy.counters.denied['host-not-in-policy'], 1);
});

test('run as a script: loopback only, port/pid files private, SIGTERM writes a content-safe receipt', async (t) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'egress-cli-')); t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const files = { port: path.join(d, 'port'), pid: path.join(d, 'pid'), receipt: path.join(d, 'receipt.json') };
  const child = spawn(process.execPath, [path.join(ROOT, 'scripts', 'egress_connect_proxy.cjs'), '--bundle', BUNDLE, '--port-file', files.port,
    '--receipt', files.receipt, '--pid-file', files.pid], { stdio: ['ignore', 'ignore', 'pipe'] });
  for (let i = 0; i < 100 && !fs.existsSync(files.port); i++) await new Promise((r) => setTimeout(r, 50));
  const port = Number(fs.readFileSync(files.port, 'utf8'));
  assert.ok(port > 0);
  for (const f of [files.port, files.pid]) assert.equal(fs.statSync(f).mode & 0o777, 0o600);
  const { head } = await rawRequest(port, 'CONNECT evil.example.net:443 HTTP/1.1\r\nHost: x\r\n\r\n');
  assert.match(head, /host-not-in-policy/);
  const exited = new Promise((r) => child.on('exit', r));
  child.kill('SIGTERM');
  assert.equal(await exited, 0);
  const receipt = JSON.parse(fs.readFileSync(files.receipt, 'utf8'));
  assert.equal(receipt.schema, 'speaksharp.cloud-test.egress-connect-proxy.v1');
  assert.equal((receipt.denied['host-not-in-policy']), 1);
  assert.equal(receipt.listen, 'loopback');
  assert.ok(!JSON.stringify(receipt).includes('evil.example.net'), 'never records an unlisted target');
  assert.equal(fs.statSync(files.receipt).mode & 0o777, 0o600);
  const bad = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'egress_connect_proxy.cjs'), '--bundle', d, '--port-file', files.port,
    '--receipt', files.receipt, '--pid-file', files.pid], { encoding: 'utf8' });
  assert.equal(bad.status, 78);
  assert.match(bad.stderr, /^BLOCKED_SETUP: egress-proxy:/);
});
