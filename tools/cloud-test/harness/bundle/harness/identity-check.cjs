#!/usr/bin/env node
'use strict';
// Rev3 opt-in identity GET. Normal TLS only; no curl config, retries, redirect following,
// cookies, credentials, executable body parsing, or custom trust changes. Imported safely.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { parseIdentityResponse, IdentityLedger, validateBinding, MAX_BODY_BYTES } = require('./identity-core.cjs');

function parseArgs(argv) {
  const a = {}; const allowed = new Set(['url', 'expect-sha', 'ledger', 'cap', 'phase', 'authorize-identity-read']);
  if (argv.length % 2) throw new Error('arguments require explicit values');
  for (let i = 0; i < argv.length; i += 2) {
    const k = argv[i].replace(/^--/, '');
    if (argv[i] !== '--' + k || !allowed.has(k) || k in a) throw new Error('unknown or repeated argument');
    a[k] = argv[i + 1];
  }
  if (a['authorize-identity-read'] !== 'true') throw new Error('NOT AUTHORIZED: add --authorize-identity-read true only under the bound R0 identity-read authority');
  if (!/^\d+$/.test(a.cap || '') || !a.ledger) throw new Error('ledger and integer cap required');
  const binding = { url: a.url, expectedSha: a['expect-sha'], cap: Number(a.cap), phase: a.phase };
  validateBinding(binding); return { ledger: a.ledger, binding };
}
function curlArgs(url, bodyPath) {
  return ['-q', '--proto', '=https', '--max-redirs', '0', '--retry', '0', '--request', 'GET',
    '--connect-timeout', '10', '--max-time', '20', '--max-filesize', String(MAX_BODY_BYTES), '--silent', '--show-error',
    '--output', bodyPath, '--write-out', '%{http_code} %{num_redirects} %{size_download}', '--url', url];
}
function runIdentity(config, transport = spawnSync) {
  const { binding } = config; const ledger = new IdentityLedger(config.ledger, binding);
  let tmp;
  try {
    const n = ledger.reserve();
    if (n === null) return { exitCode: 11, receipt: { phase: binding.phase, result: 'BLOCKED', reason: 'identity-cap', identityGetsUsed: ledger.state.identityGets, cap: binding.cap } };
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-identity-private-')); fs.chmodSync(tmp, 0o700);
    const bodyPath = path.join(tmp, 'body');
    const fd = fs.openSync(bodyPath, 'wx', 0o600); fs.closeSync(fd);
    let response; let transportError = false;
    try { response = transport('curl', curlArgs(binding.url, bodyPath), { encoding: 'utf8', timeout: 25000, maxBuffer: 8192 }); }
    catch { response = { status: null, stdout: '' }; transportError = true; }
    const match = /^(\d{3}) (\d+) (\d+(?:\.\d+)?)$/.exec(String(response.stdout || '').trim());
    let body = Buffer.alloc(0);
    if (fs.existsSync(bodyPath) && fs.statSync(bodyPath).size <= MAX_BODY_BYTES) body = fs.readFileSync(bodyPath);
    else transportError = true;
    const parsed = parseIdentityResponse({ body, status: match ? Number(match[1]) : 0, redirects: match ? Number(match[2]) : 0,
      transportExit: transportError || !match || response.status !== 0 ? 1 : 0, expectedSha: binding.expectedSha });
    const receipt = { ...parsed, phase: binding.phase, url: binding.url, identityGetsUsed: ledger.state.identityGets, cap: binding.cap };
    ledger.complete(n, receipt);
    return { exitCode: parsed.result === 'MATCH' ? 0 : 10, receipt };
  } finally {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
    ledger.release();
  }
}
function main(argv) {
  try { const result = runIdentity(parseArgs(argv)); console.log(JSON.stringify(result.receipt)); return result.exitCode; }
  catch (e) { console.error('BLOCKED_SETUP identity: ' + e.message); return 2; }
}
if (require.main === module) process.exitCode = main(process.argv.slice(2));
module.exports = { parseArgs, curlArgs, runIdentity, main };
