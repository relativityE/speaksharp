'use strict';
// Rev3: inert identity verification and durable, cumulative pre-send reservations.
// No network activity on import. This is marker evidence, not a deployment/config proof.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const MAX_BODY_BYTES = 1024 * 1024;
const SHA = /^[0-9a-f]{40}$/;

function parseIdentityResponse({ body = '', status = 0, redirects = 0, transportExit = 0, expectedSha }) {
  if (!SHA.test(expectedSha || '')) throw new Error('expected SHA must be 40 lowercase hex');
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
  const text = bytes.toString('utf8');
  // Count all marker mentions, including malformed assignments: ambiguity fails closed.
  const mentions = text.match(/window\s*\.\s*__APP_RELEASE__/g) || [];
  // Supported release-marker grammar is intentionally narrow: one standalone JSON
  // assignment in an inline JavaScript script, not a comment, code-string mention, or external
  // script. Supports the shipping JSON-string SHA and the reviewed JSON-object compatibility form.
  const uncommented = text.replace(/<!--[\s\S]*?(?:-->|$)/g, '');
  const inlineMarkers = [...uncommented.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)].flatMap((m) => {
    if (/\bsrc\s*=/i.test(m[1])) return [];
    const types = [...m[1].matchAll(/(?:^|\s)type\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+))/gi)];
    if (types.length > 1) return [];
    const type = types[0] && (types[0][1] ?? types[0][2] ?? types[0][3]).toLowerCase();
    if (type !== undefined && !['', 'text/javascript', 'application/javascript', 'module'].includes(type)) return [];
    const assignment = /^\s*window\.__APP_RELEASE__\s*=\s*([\s\S]{1,8192}?)\s*;?\s*$/.exec(m[2]);
    return assignment ? [assignment[1]] : [];
  });
  let reason = null; let servedSha = null;
  if (transportExit !== 0) reason = 'transport-error';
  else if (Number(redirects) !== 0 || (Number(status) >= 300 && Number(status) < 400)) reason = 'redirect';
  else if (Number(status) !== 200) reason = 'http-' + Number(status);
  else if (bytes.length > MAX_BODY_BYTES) reason = 'body-too-large';
  else if (mentions.length !== 1) reason = 'marker-count-' + mentions.length;
  else if (inlineMarkers.length !== 1) reason = 'marker-not-standalone-inline-json';
  else {
    // Parse JSON only. Never evaluate JS, quote concatenation, template literals or functions.
    let marker;
    try { marker = JSON.parse(inlineMarkers[0]); } catch { reason = 'marker-not-json'; }
    if (!reason && typeof marker === 'string') {
      // JSON escaping is harmless only when its parsed value is exactly one full SHA.
      if (!SHA.test(marker)) reason = 'marker-string-not-sha';
      else servedSha = marker;
    } else if (!reason && marker && !Array.isArray(marker) && typeof marker === 'object') {
      // Count decoded as well as raw values, so escaped second SHAs cannot hide ambiguity.
      // Raw duplicate-key values still count even though JSON.parse keeps the final property.
      const rawShas = inlineMarkers[0].match(/\b[0-9a-f]{40}\b/g) || [];
      const decodedShas = JSON.stringify(marker).match(/\b[0-9a-f]{40}\b/g) || [];
      if (rawShas.length > 1 || decodedShas.length !== 1) reason = 'marker-sha-ambiguous';
      else servedSha = decodedShas[0];
    } else if (!reason) reason = 'marker-not-string-or-object';
    if (!reason && servedSha !== expectedSha) reason = 'drift';
  }
  return { result: reason ? 'BLOCKED' : 'MATCH', reason, http: Number(status) || null,
    redirects: Number(redirects), bytes: bytes.length, bodySha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    markerCount: mentions.length, servedSha, expectedSha, evidenceScope: 'inert-text-marker-only' };
}

function assertPrivateDir(dir) {
  const st = fs.lstatSync(dir);
  if (st.isSymbolicLink() || !st.isDirectory() || (st.mode & 0o077) !== 0 || (process.getuid && st.uid !== process.getuid())) {
    throw new Error('private directory required (owned, non-symlink, mode 0700): ' + dir);
  }
}
function assertPrivateFile(file) {
  const st = fs.lstatSync(file);
  if (st.isSymbolicLink() || !st.isFile() || st.nlink !== 1 || (st.mode & 0o077) !== 0 || (process.getuid && st.uid !== process.getuid())) {
    throw new Error('private file required (owned regular single-link, mode 0600): ' + file);
  }
}
function fsyncDir(dir) { const fd = fs.openSync(dir, 'r'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } }
function atomicPrivateJson(file, state) {
  const dir = path.dirname(file); assertPrivateDir(dir);
  if (fs.existsSync(file)) assertPrivateFile(file);
  const tmp = path.join(dir, '.' + path.basename(file) + '.' + crypto.randomBytes(12).toString('hex') + '.tmp');
  let fd;
  try {
    fd = fs.openSync(tmp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
    fs.writeFileSync(fd, JSON.stringify(state, null, 2) + '\n'); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
    fs.renameSync(tmp, file); fsyncDir(dir);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    try { fs.unlinkSync(tmp); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
}
function validateBinding({ url, expectedSha, cap, phase }) {
  if (!/^https:\/\/[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\/$/.test(url || '') || !SHA.test(expectedSha || '') ||
      !Number.isSafeInteger(cap) || cap < 0 || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(phase || '')) {
    throw new Error('identity binding requires canonical HTTPS root URL, 40hex SHA, finite nonnegative cap, and content-safe phase');
  }
}
class IdentityLedger {
  constructor(file, binding) {
    validateBinding(binding); this.binding = binding; this.file = path.resolve(file);
    this.lock = this.file + '.lock'; this.token = crypto.randomBytes(18).toString('hex'); this.released = false;
    assertPrivateDir(path.dirname(this.file));
    // Never guess a stale lock safe: a crash requires explicit review, not automatic replay.
    const fd = fs.openSync(this.lock, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
    try { fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, token: this.token })); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fsyncDir(path.dirname(this.file));
    try {
      if (fs.existsSync(this.file)) { assertPrivateFile(this.file); this.state = JSON.parse(fs.readFileSync(this.file, 'utf8')); }
      else this.state = { version: 1, url: binding.url, expectedSha: binding.expectedSha, cap: binding.cap, identityGets: 0, receipts: [] };
      const s = this.state;
      if (s.version !== 1 || s.url !== binding.url || s.expectedSha !== binding.expectedSha || s.cap !== binding.cap ||
          !Number.isSafeInteger(s.identityGets) || s.identityGets < 0 || s.identityGets > binding.cap || !Array.isArray(s.receipts) || s.receipts.length !== s.identityGets) {
        throw new Error('identity ledger corrupt or campaign binding changed');
      }
    } catch (e) { this.release(); throw e; }
  }
  reserve() {
    if (this.released) throw new Error('ledger closed');
    if (this.state.identityGets >= this.binding.cap) return null;
    const n = ++this.state.identityGets;
    this.state.receipts.push({ reservation: n, phase: this.binding.phase, startedAt: new Date().toISOString(), result: 'RESERVED', reason: 'response-not-yet-recorded' });
    // Reservation is durable before caller may send; never refunded on any outcome.
    atomicPrivateJson(this.file, this.state); return n;
  }
  complete(n, receipt) {
    if (this.released || !Number.isInteger(n) || n < 1 || n > this.state.identityGets || this.state.receipts[n - 1].result !== 'RESERVED') throw new Error('unknown or completed reservation');
    this.state.receipts[n - 1] = { ...this.state.receipts[n - 1], ...receipt, reservation: n, phase: this.binding.phase, endedAt: new Date().toISOString() };
    atomicPrivateJson(this.file, this.state);
  }
  release() {
    if (this.released) return;
    this.released = true;
    const lock = JSON.parse(fs.readFileSync(this.lock, 'utf8'));
    if (lock.token !== this.token) throw new Error('identity lock ownership changed');
    fs.unlinkSync(this.lock); fsyncDir(path.dirname(this.file));
  }
}
module.exports = { parseIdentityResponse, IdentityLedger, atomicPrivateJson, assertPrivateDir, assertPrivateFile, validateBinding, MAX_BODY_BYTES };
