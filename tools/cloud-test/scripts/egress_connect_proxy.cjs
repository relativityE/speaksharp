'use strict';
// PO-approved restrictive egress for the live job (2026-11-08, "approve the local proxy"; assessment Elon 19:10Z, Sam 1794164750).
//
// The reviewed production guard policy is `upstream.mode: env-proxy`: the guard reaches every allowed host only through an HTTP CONNECT
// proxy named by HTTPS_PROXY, then runs TLS end to end itself (servername = host, default CA verification; guard-proxy.cjs upstreamSocket).
// The GitHub runner provides no proxy. This is that proxy, and nothing more:
//   - listens on 127.0.0.1 only, on an ephemeral port, as the job user (no sudo, no secret, no permission change);
//   - accepts ONLY `CONNECT <host>:443` where <host> is exactly a host of the CODE-pinned production policy (the policy file's sha256 must
//     equal its CODE.sha256 entry, else it refuses to start);
//   - refuses IP-literal targets, any other port, plain or absolute-form HTTP, unlisted hosts, and any DNS answer that is loopback, private,
//     link-local, CGNAT, unspecified, multicast, reserved or the cloud metadata address; it connects to the CHECKED address (no re-resolve);
//   - never sees plaintext: it relays the guard's TLS bytes unchanged; it adds no path or method control (the guard keeps that);
//   - bounds concurrency, idle time and its own lifetime;
//   - records content-safe counters only (allowed per policy host, denied per closed reason) in a receipt written at shutdown.
// It does not restrict other runner processes, which have the runner's direct egress anyway: it is defense in depth for the guard's own
// upstream plus an auditable receipt, not a network perimeter.
const crypto = require('node:crypto');
const dns = require('node:dns');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');

const SCHEMA = 'speaksharp.cloud-test.egress-connect-proxy.v1';
const DENY_REASONS = Object.freeze(['not-connect', 'malformed-target', 'ip-literal', 'port-not-443', 'host-not-in-policy', 'dns-failed',
  'dns-forbidden-address', 'upstream-connect-failed', 'over-capacity', 'shutting-down']);
const LIMITS = Object.freeze({ maxConcurrent: 64, idleMs: 120000, connectTimeoutMs: 15000, lifetimeMs: 100 * 60 * 1000 });
const POLICY_ENTRY = 'config/policy.production.TEMPLATE.json';
const HOST = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

function forbiddenAddress(address) {
  // Every address the policy hosts must never resolve to (SSRF / DNS-rebinding defence). Fail closed on anything unparsable.
  const family = net.isIP(address);
  if (family === 4) {
    const [a, b] = address.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  if (family === 6) {
    const x = address.toLowerCase();
    const mapped = x.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return forbiddenAddress(mapped[1]);
    return x === '::' || x === '::1' || /^f[cd]/.test(x) || /^fe[89ab]/.test(x) || /^ff/.test(x) || x.startsWith('64:ff9b:') || x.startsWith('2001:db8');
  }
  return true;
}

function reviewedPolicy(bundle) {
  const raw = fs.readFileSync(path.join(bundle, POLICY_ENTRY));
  const manifest = fs.readFileSync(path.join(bundle, 'CODE.sha256'), 'utf8');
  const pinned = manifest.split('\n').map((l) => l.trim().split(/\s+/)).find((p) => p.length === 2 && p[1] === POLICY_ENTRY);
  const digest = crypto.createHash('sha256').update(raw).digest('hex');
  if (!pinned || !/^[0-9a-f]{64}$/.test(pinned[0]) || pinned[0] !== digest) throw new Error('policy-not-reviewed');
  const policy = JSON.parse(raw);
  if (!policy || policy.upstream?.mode !== 'env-proxy' || typeof policy.hosts !== 'object') throw new Error('policy-not-env-proxy');
  const hosts = Object.keys(policy.hosts).map((h) => h.toLowerCase());
  if (!hosts.length || hosts.some((h) => !HOST.test(h))) throw new Error('policy-hosts-invalid');
  return { hosts, policySha256: digest };
}

function createProxy({ hosts, lookup = dns.promises.lookup, connect = net.connect, limits = LIMITS }) {
  const allowed = new Set(hosts);
  const counters = { allowed: Object.fromEntries(hosts.map((h) => [h, 0])), denied: Object.fromEntries(DENY_REASONS.map((r) => [r, 0])) };
  const sockets = new Set();
  let closing = false;
  const deny = (sock, reason, status) => {
    counters.denied[reason] += 1;
    try { sock.end(`HTTP/1.1 ${status} ${status === 403 ? 'Forbidden' : status === 503 ? 'Service Unavailable' : status === 502 ? 'Bad Gateway' : 'Bad Request'}\r\nx-ss-egress-deny: ${reason}\r\ncontent-length: 0\r\nconnection: close\r\n\r\n`); } catch { /* client gone */ }
    sock.destroy();
  };
  const server = http.createServer((req, res) => {
    counters.denied['not-connect'] += 1;
    res.writeHead(405, { 'x-ss-egress-deny': 'not-connect', 'content-length': 0, connection: 'close' });
    res.end();
  });
  server.on('connect', async (req, client, head) => {
    if (closing) return deny(client, 'shutting-down', 503);
    if (sockets.size >= limits.maxConcurrent) return deny(client, 'over-capacity', 503);
    const m = typeof req.url === 'string' ? req.url.match(/^([^:/\s]+|\[[^\]\s]+\]):([0-9]{1,5})$/) : null;
    if (!m) return deny(client, 'malformed-target', 400);
    const host = m[1].toLowerCase();
    if (host.startsWith('[') || net.isIP(host)) return deny(client, 'ip-literal', 403);
    if (m[2] !== '443') return deny(client, 'port-not-443', 403);
    if (!allowed.has(host)) return deny(client, 'host-not-in-policy', 403);
    sockets.add(client);
    client.on('close', () => sockets.delete(client));
    client.on('error', () => client.destroy());
    let answers;
    try { answers = await lookup(host, { all: true, verbatim: true }); } catch { sockets.delete(client); return deny(client, 'dns-failed', 502); }
    if (!Array.isArray(answers) || !answers.length || answers.some((a) => forbiddenAddress(a?.address))) {
      sockets.delete(client); return deny(client, 'dns-forbidden-address', 403);
    }
    const target = answers.find((x) => x.family === 4) || answers[0];   // hosted runners often have no IPv6 route
    const upstream = connect({ host: target.address, port: 443, family: target.family });
    sockets.add(upstream);
    upstream.on('close', () => sockets.delete(upstream));
    const timer = setTimeout(() => upstream.destroy(new Error('connect-timeout')), limits.connectTimeoutMs);
    upstream.on('error', () => {
      clearTimeout(timer);
      if (!upstream.connectedOnce) { sockets.delete(client); deny(client, 'upstream-connect-failed', 502); } else client.destroy();
    });
    upstream.once('connect', () => {
      clearTimeout(timer);
      upstream.connectedOnce = true;
      counters.allowed[host] += 1;
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head && head.length) upstream.write(head);
      for (const s of [client, upstream]) s.setTimeout(limits.idleMs, () => { client.destroy(); upstream.destroy(); });
      client.pipe(upstream);
      upstream.pipe(client);
      client.on('close', () => upstream.destroy());
      upstream.on('close', () => client.destroy());
    });
  });
  server.on('clientError', (_err, sock) => { counters.denied['malformed-target'] += 1; sock.destroy(); });
  return {
    server, counters,
    listen: () => new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve(server.address().port)); }),
    close: () => new Promise((resolve) => { closing = true; for (const s of sockets) s.destroy(); server.close(() => resolve()); }),
  };
}

function writePrivate(file, text) {
  const fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_TRUNC, 0o600);
  try { fs.writeSync(fd, text); } finally { fs.closeSync(fd); }
}

async function main(argv = process.argv.slice(2)) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!['--bundle', '--port-file', '--receipt', '--pid-file'].includes(argv[i]) || argv[i + 1] === undefined) throw new Error('arguments');
    out[argv[i]] = argv[i + 1];
  }
  for (const k of ['--bundle', '--port-file', '--receipt', '--pid-file']) if (!out[k]) throw new Error('arguments');
  const { hosts, policySha256 } = reviewedPolicy(out['--bundle']);
  const proxy = createProxy({ hosts });
  const port = await proxy.listen();
  const startedAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  writePrivate(out['--pid-file'], `${process.pid}\n`);
  writePrivate(out['--port-file'], `${port}\n`);
  let done = false;
  const finish = async (why) => {
    if (done) return; done = true;
    await proxy.close();
    const receipt = { schema: SCHEMA, contentSafe: true, policySha256, startedAt, stoppedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      stoppedBy: why, listen: 'loopback', limits: LIMITS, allowed: proxy.counters.allowed, denied: proxy.counters.denied };
    writePrivate(out['--receipt'], `${JSON.stringify(receipt)}\n`);
    process.exit(0);
  };
  process.on('SIGTERM', () => finish('sigterm'));
  process.on('SIGINT', () => finish('sigint'));
  setTimeout(() => finish('lifetime'), LIMITS.lifetimeMs).unref();
}

module.exports = { createProxy, forbiddenAddress, reviewedPolicy, DENY_REASONS, LIMITS };
if (require.main === module) main().catch((e) => { process.stderr.write(`BLOCKED_SETUP: egress-proxy:${/^[a-z-]+$/.test(e?.message) ? e.message : 'start-failed'}\n`); process.exit(78); });
