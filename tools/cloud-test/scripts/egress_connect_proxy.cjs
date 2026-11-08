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
  'dns-forbidden-address', 'upstream-connect-failed', 'over-capacity', 'shutting-down', 'client-gone']);
const LIMITS = Object.freeze({ maxConcurrent: 64, idleMs: 120000, connectTimeoutMs: 15000, dnsTimeoutMs: 10000, lifetimeMs: 100 * 60 * 1000 });
const POLICY_ENTRY = 'config/policy.production.TEMPLATE.json';
const HOST = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

function v4Forbidden(b) {
  // b: 4 octets. Every IPv4 range a policy host must never resolve to (RFC 6890 special-purpose and private space).
  const [a, x] = b;
  return a === 0 || a === 10 || a === 127 || (a === 100 && x >= 64 && x <= 127) || (a === 169 && x === 254) || (a === 172 && x >= 16 && x <= 31)
    || (a === 192 && x === 168) || (a === 192 && x === 0 && b[2] === 0) || (a === 192 && x === 0 && b[2] === 2) || (a === 198 && (x === 18 || x === 19))
    || (a === 198 && x === 51 && b[2] === 100) || (a === 203 && x === 0 && b[2] === 113) || a >= 224;
}

function v4Bytes(text) {
  const parts = text.split('.');
  if (parts.length !== 4 || parts.some((p) => !/^(0|[1-9][0-9]{0,2})$/.test(p) || Number(p) > 255)) return null;
  return parts.map(Number);
}

function v6Bytes(text) {
  // Canonical parse of any textual IPv6 form (compressed, expanded, embedded dotted IPv4, mixed case) into 16 octets; null if invalid.
  if (typeof text !== 'string' || net.isIPv6(text) === false) return null;
  let head = text.toLowerCase(), tail4 = null;
  const dotted = head.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) { tail4 = v4Bytes(dotted[2]); if (!tail4) return null; head = dotted[1] + '0:0'; }
  const halves = head.split('::');
  if (halves.length > 2) return null;
  const words = (h) => (h === '' ? [] : h.split(':'));
  const left = words(halves[0]), right = halves.length === 2 ? words(halves[1]) : [];
  const fill = halves.length === 2 ? 8 - left.length - right.length : 0;
  if (fill < 0 || (halves.length === 1 && left.length !== 8)) return null;
  const all = [...left, ...Array(fill).fill('0'), ...right];
  if (all.length !== 8 || all.some((w) => !/^[0-9a-f]{1,4}$/.test(w))) return null;
  const out = [];
  for (const w of all) { const n = parseInt(w, 16); out.push(n >> 8, n & 255); }
  if (tail4) out.splice(12, 4, ...tail4);
  return out;
}

function forbiddenAddress(address) {
  // Every address a policy host must never resolve to (SSRF / DNS-rebinding defence), on the CANONICAL bytes, never on text prefixes
  // (Sam 1794168880: ::ffff:7f00:1 is 127.0.0.1). Fail closed on anything unparsable.
  if (typeof address !== 'string') return true;
  if (net.isIPv4(address)) { const b = v4Bytes(address); return !b || v4Forbidden(b); }
  const b = v6Bytes(address);
  if (!b) return true;
  const zero = (from, to) => b.slice(from, to).every((x) => x === 0);
  if (zero(0, 10) && b[10] === 0xff && b[11] === 0xff) return v4Forbidden(b.slice(12));           // ::ffff:0:0/96  IPv4-mapped
  if (zero(0, 12)) return true;                                                                     // ::/96 incl. ::, ::1, IPv4-compatible
  if (b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b) return true;               // 64:ff9b::/96 (and /48) NAT64
  if (b[0] === 0x01 && b[1] === 0x00 && zero(2, 8)) return true;                                    // 100::/64 discard
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x00 && b[3] === 0x00) return true;               // 2001::/32 Teredo
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x0d && b[3] === 0xb8) return true;               // 2001:db8::/32 documentation
  if (b[0] === 0x20 && b[1] === 0x02) return true;                                                  // 2002::/16 6to4
  if ((b[0] & 0xfe) === 0xfc) return true;                                                          // fc00::/7 unique local
  if (b[0] === 0xfe && (b[1] & 0xc0) === 0x80) return true;                                         // fe80::/10 link-local
  if (b[0] === 0xfe && (b[1] & 0xc0) === 0xc0) return true;                                         // fec0::/10 site-local
  if (b[0] === 0xff) return true;                                                                   // ff00::/8 multicast
  return false;
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
    // The http server keeps sockets half-open, so a client that closes during DNS is only an unread FIN. Read it during the wait (any early
    // tunnel bytes are buffered, bounded, and replayed in order after the 200) so `end` marks the client gone before any connect.
    let gone = false, buffered = [], bufferedBytes = 0;
    const early = (chunk) => { bufferedBytes += chunk.length; if (bufferedBytes > 65536) { gone = true; client.destroy(); } else buffered.push(chunk); };
    client.on('data', early);
    client.once('end', () => { gone = true; });
    let answers, dnsTimer;
    try {
      // Sam 1794168880: the lookup is bounded, and nothing connects after the client went away or shutdown began during it.
      answers = await Promise.race([lookup(host, { all: true, verbatim: true }),
        new Promise((_, reject) => { dnsTimer = setTimeout(() => reject(new Error("dns-timeout")), limits.dnsTimeoutMs); })]);
    } catch { clearTimeout(dnsTimer); sockets.delete(client); return deny(client, "dns-failed", 502); }
    clearTimeout(dnsTimer);
    if (closing || gone || client.destroyed || !sockets.has(client)) { sockets.delete(client); counters.denied['client-gone']++; client.destroy(); return; }
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
      if (gone || client.destroyed) { upstream.destroy(); return; }
      client.off('data', early);
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head && head.length) upstream.write(head);
      for (const chunk of buffered) upstream.write(chunk);
      buffered = [];
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

module.exports = { createProxy, forbiddenAddress, v6Bytes, reviewedPolicy, DENY_REASONS, LIMITS };
if (require.main === module) main().catch((e) => { process.stderr.write(`BLOCKED_SETUP: egress-proxy:${/^[a-z-]+$/.test(e?.message) ? e.message : 'start-failed'}\n`); process.exit(78); });
