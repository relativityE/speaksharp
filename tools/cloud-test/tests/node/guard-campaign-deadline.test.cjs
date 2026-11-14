'use strict';
// R10 runs 42607776111 and 42615792133 stopped at A6.guard-selftest on S6.campaign-deadline-cancels: an in-flight request at the
// campaign deadline must end `cancelled` with reason `campaign-deadline`. Two timers are due at that same instant: the guard's campaign
// timer (cancelAll) and the request's own timer, capped at the campaign deadline. Which fires first is event-loop timing, so the
// recorded outcome was not deterministic. These tests arm ONLY the request's own timer (the guard is never started, so no campaign timer
// exists) and require the campaign-deadline outcome anyway; a request whose own timeout ends first still ends as `deadline`.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const net = require('node:net');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { Guard } = require(path.join(__dirname, '..', '..', 'harness', 'bundle', 'harness', 'guard-proxy.cjs'));

const SHA = 'a'.repeat(40);

function silentUpstream() {
  // Accepts TCP and never answers: the guard's upstream TLS handshake stays pending, so the request is in flight until a timer ends it.
  const sockets = new Set();
  const server = net.createServer((s) => { sockets.add(s); s.on('error', () => {}); });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    port: server.address().port,
    close: () => { for (const s of sockets) s.destroy(); server.close(); },
  })));
}

function guardFor(dir, port, { deadlineInMs, requestTimeoutMs }) {
  const caFile = path.join(dir, 'ca.pem');
  fs.writeFileSync(caFile, '');
  const policy = {
    version: 1, sourceSha: SHA, testOnly: true, logPaths: true,
    hosts: { 'a.test': { port: 443, rules: [{ id: 'a-read', methods: ['GET'], path: '^/hang$', cap: 'public', reviewedSourceSha: SHA }] } },
    caps: { total: 10, navigations: 10, public: 10 },
    maxInFlight: 2, queueWaitMs: 1000, requestTimeoutMs,
    deadlineAt: new Date(Date.now() + deadlineInMs).toISOString(),
    upstream: { mode: 'override', override: { 'a.test': '127.0.0.1:' + port }, caFile },
  };
  return new Guard(policy, { runDir: dir, ledgerFile: path.join(dir, 'ledger.json'), logFile: path.join(dir, 'guard.jsonl') });
}

function fakeExchange() {
  const req = new EventEmitter();
  Object.assign(req, { url: '/hang', method: 'GET', headers: { host: 'a.test' }, rawHeaders: ['Host', 'a.test'], socket: { ssHost: 'a.test' } });
  req.resume = () => {};
  const res = new EventEmitter();
  const done = new Promise((resolve) => {
    Object.assign(res, {
      headersSent: false, writableFinished: false, status: null,
      writeHead(status) { this.status = status; this.headersSent = true; },
      end() { this.writableFinished = true; resolve('ended'); },
      destroy() { resolve('destroyed'); },
    });
  });
  return { req, res, done };
}

async function hangOnce({ deadlineInMs, requestTimeoutMs }) {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'guard-deadline-'));   // the ledger refuses a symlinked parent
  const up = await silentUpstream();
  let g;
  try {
    g = guardFor(dir, up.port, { deadlineInMs, requestTimeoutMs });
    const { req, res, done } = fakeExchange();
    g.onRequest(req, res);
    await done;
    await new Promise((r) => setTimeout(r, 20));
    const entries = fs.readFileSync(path.join(dir, 'guard.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    return { entry: entries.find((e) => e.kind === 'request' && e.path === '/hang' && e.outcome), closing: g.closing };
  } finally {
    if (g) {
      try { g.cancelAll('test-end'); } catch { /* already cancelled */ }
      try { g.ledger.release(); } catch { /* released */ }
      try { fs.closeSync(g.logFd); } catch { /* closed */ }
    }
    up.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('an in-flight request at the campaign deadline is cancelled with reason campaign-deadline, whichever timer fires', async () => {
  const { entry, closing } = await hangOnce({ deadlineInMs: 400, requestTimeoutMs: 30000 });
  assert.ok(entry, 'the /hang request is logged with an outcome');
  assert.equal(entry.outcome, 'cancelled');
  assert.equal(entry.reason, 'campaign-deadline');
  assert.equal(closing, true, 'the campaign deadline closes the guard, exactly as the campaign timer would');
});

test('a request whose own timeout ends before the campaign deadline still ends as deadline (504) and the guard stays open', async () => {
  const { entry, closing } = await hangOnce({ deadlineInMs: 60000, requestTimeoutMs: 300 });
  assert.ok(entry, 'the /hang request is logged with an outcome');
  assert.equal(entry.outcome, 'deadline');
  assert.equal(closing, false);
});
