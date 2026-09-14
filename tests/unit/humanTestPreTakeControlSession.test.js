// @vitest-environment node
// RWT-01 — PM RETURN 5664428448: the entry point's REAL connection ordering, over real loopback sockets.
//
// On 5ceaab35 `prepare-take.mjs` opened the page debugger client before the pre-arm exclusivity probe. An open page client
// is itself an attachment (Chromium reports `TargetInfo.attached: true` for it), so a clean page refused itself; and the
// removed `await client.ready` allowed a command before the socket opened. The unit casualties used an already-open fake
// client, so neither ordering was ever exercised. This drives the same `openReady` / `attachmentProbe` the CLI uses against
// a loopback CDP endpoint that reports `attached` while any page socket is open.
import http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';
import { modelComparisonSwitchExpression } from '../../scripts/human-test/modelComparisonArm.mjs';
import { attachmentProbe, openReady } from '../../scripts/human-test/cdpControlSession.mjs';
import { RELEASE_EXPRESSION, SURFACE_READY_EXPRESSION, runPreTakeControl } from '../../scripts/human-test/preTakeControl.mjs';

const RELEASE = 'a'.repeat(40);
const APP = 'https://speaksharp-public.vercel.app';
const CANDIDATE = 'v2:base.en';
const JOURNEY = 'open_mic';
const AUTHORIZATION = {
  runId: 900002, runAttempt: 1, releaseSha: RELEASE, origin: APP, candidateId: CANDIDATE, journey: JOURNEY,
  evidenceDocumentId: '22222222-2222-4222-8222-222222222222', nonce: `run-900002-1-${'cd'.repeat(12)}`,
  verifiedAt: '2026-09-14T13:00:05.000Z',
};
const MATCH = { requested: CANDIDATE, observed: CANDIDATE, expected: CANDIDATE, matches: true };

const browsers = [];
afterEach(async () => { await Promise.all(browsers.splice(0).map((b) => b.close())); });

/** A loopback CDP endpoint: one page target, attached while any page socket is open. */
async function fakeBrowser({ pageOpenDelayMs = 0, workerAttached = false } = {}) {
  const pageSockets = new Set();
  const pageCommands = [];
  const server = http.createServer((req, res) => {
    const { port } = server.address();
    if (req.url === '/json/version') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/browser/B1` }));
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    const isPage = req.url === '/devtools/page/P1';
    const accept = () => wss.handleUpgrade(req, socket, head, (ws) => {
      if (isPage) pageSockets.add(ws);
      ws.on('close', () => pageSockets.delete(ws));
      ws.on('message', (raw) => {
        const { id, method, params = {} } = JSON.parse(raw.toString());
        if (isPage) pageCommands.push(method);
        let result = {};
        if (method === 'Target.getTargets') {
          result = { targetInfos: [
            { targetId: 'P1', type: 'page', attached: pageSockets.size > 0 },
            { targetId: 'W1', type: 'worker', attached: workerAttached },
          ] };
        }
        if (method === 'Page.addScriptToEvaluateOnNewDocument') result = { identifier: 'arm-1' };
        if (method === 'Runtime.evaluate') {
          if (params.expression === SURFACE_READY_EXPRESSION) result = { result: { value: true } };
          else if (params.expression === RELEASE_EXPRESSION) result = { result: { value: RELEASE } };
          else if (params.expression === modelComparisonSwitchExpression(CANDIDATE, JOURNEY)) {
            result = { result: { value: { outcome: { ok: true, candidate: CANDIDATE }, active: MATCH } } };
          }
        }
        ws.send(JSON.stringify({ id, result }));
      });
    });
    if (isPage && pageOpenDelayMs > 0) setTimeout(accept, pageOpenDelayMs); else accept();
  });
  await new Promise((resolve) => { server.listen(0, '127.0.0.1', resolve); });
  const { port } = server.address();
  const browser = {
    origin: `http://127.0.0.1:${port}`,
    pageUrl: `ws://127.0.0.1:${port}/devtools/page/P1`,
    pageSockets, pageCommands,
    close: () => new Promise((resolve) => { for (const c of wss.clients) c.terminate(); server.close(() => resolve()); }),
  };
  browsers.push(browser);
  return browser;
}

const openRaw = (url) => new Promise((resolve, reject) => { const ws = new WebSocket(url); ws.once('open', () => resolve(ws)); ws.once('error', reject); });

const control = (browser, overrides = {}) => runPreTakeControl({
  openClient: () => openReady(browser.pageUrl),
  probeAttachment: attachmentProbe(browser.origin, 'P1'),
  appUrl: APP, authorization: AUTHORIZATION, candidate: CANDIDATE, journey: JOURNEY, expectedRelease: RELEASE,
  sleep: async () => {},
  ...overrides,
});

describe('RWT-01 — pre-take control through real loopback sockets (the CLI\'s own connection code)', () => {
  it('a clean target reaches the control and PASSes instead of refusing itself', async () => {
    const browser = await fakeBrowser();
    const receipt = await control(browser);
    expect(receipt.problems).toEqual([]);
    expect(receipt.verdict).toBe('PASS');
    expect(browser.pageCommands[0]).toBe('Page.enable');
    expect(browser.pageSockets.size).toBe(0);
  });

  it('a page socket that opens late never receives a command before it is ready', async () => {
    const browser = await fakeBrowser({ pageOpenDelayMs: 300 });
    const receipt = await control(browser);
    expect(receipt.verdict).toBe('PASS');
    expect(browser.pageCommands[0]).toBe('Page.enable');
  });

  it('CASUALTY: a pre-existing second client HOLDs before arming — the control sends the page nothing', async () => {
    const browser = await fakeBrowser();
    const other = await openRaw(browser.pageUrl);
    const receipt = await control(browser);
    expect(receipt.verdict).toBe('HOLD');
    expect(receipt.problems.join('\n')).toMatch(/already attached/);
    expect(browser.pageCommands).toEqual([]);
    other.close();
  });

  it('CASUALTY: a debugger held on a worker (not the page) HOLDs before arming — the page receives nothing', async () => {
    const browser = await fakeBrowser({ workerAttached: true });
    const receipt = await control(browser);
    expect(receipt.verdict).toBe('HOLD');
    expect(receipt.problems.join('\n')).toMatch(/already attached/);
    expect(browser.pageCommands).toEqual([]);
  });

  it('CASUALTY: an external attachment that survives this control\'s disconnect HOLDs', async () => {
    const browser = await fakeBrowser();
    let external = null;
    const receipt = await control(browser, {
      openClient: async () => {
        const client = await openReady(browser.pageUrl);
        external = await openRaw(browser.pageUrl);
        return client;
      },
    });
    expect(receipt.verdict).toBe('HOLD');
    expect(receipt.problems.join('\n')).toMatch(/still attached/);
    expect(browser.pageSockets.size).toBe(1);
    external.close();
  });
});
