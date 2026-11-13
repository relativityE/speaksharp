'use strict';
// Consultant P0-2: a green admission never exercised the route a case uses. A6 qualifies the guard against loopback fixtures; the
// identity read and the preflight use their own clients. This probe runs at A7 before any identity dispatch, on the REAL production
// policy, the REAL process environment (HTTPS_PROXY / NO_PROXY) and the guard's OWN upstreamSocket(): one TLS handshake per policy
// host, then the socket is closed. No HTTP request is written, so nothing reaches an application and nothing is counted.
// Output: one closed JSON line {schema, result, hosts:[{host, result}]}; result per host is `ok` or a closed guard upstream reason.
const fs = require('node:fs');
const path = require('node:path');
const { upstreamSocket, upstreamReason, validatePolicy } = require('./guard-proxy.cjs');

const SCHEMA = 'speaksharp.cloud-test.route-probe.v1';
const HOST = /^[a-z0-9.-]{1,253}$/;

async function probeHost(policy, host, timeoutMs) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  timer.unref();
  try {
    const sock = await upstreamSocket(policy, host, ac.signal);
    sock.destroy();
    return 'ok';
  } catch (e) {
    return ac.signal.aborted ? 'timeout' : upstreamReason(e);
  } finally {
    clearTimeout(timer);
  }
}

async function probe(policy, { timeoutMs = 10000 } = {}) {
  validatePolicy(policy);
  if (policy.testOnly === true) throw new Error('route probe runs only on a production policy');
  const hosts = Object.keys(policy.hosts).sort();
  if (!hosts.length || hosts.some((h) => !HOST.test(h))) throw new Error('route probe policy hosts');
  const results = [];
  for (const host of hosts) results.push({ host, result: await probeHost(policy, host, timeoutMs) });
  return { schema: SCHEMA, result: results.every((r) => r.result === 'ok') ? 'PASS' : 'BLOCKED', hosts: results };
}

async function main(argv) {
  try {
    if (argv.length !== 2 || argv[0] !== '--policy') throw new Error('usage: route-probe.cjs --policy POLICY.json');
    const policy = JSON.parse(fs.readFileSync(path.resolve(argv[1]), 'utf8'));
    const out = await probe(policy);
    process.stdout.write(JSON.stringify(out) + '\n');
    return out.result === 'PASS' ? 0 : 78;
  } catch {
    process.stdout.write(JSON.stringify({ schema: SCHEMA, result: 'BLOCKED', hosts: [], error: 'route-probe-setup' }) + '\n');
    return 78;
  }
}

module.exports = { probe, probeHost, main, SCHEMA };
if (require.main === module) main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
