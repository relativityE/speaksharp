'use strict';
// Loopback fixture servers for the guard self-test. Each server writes its OWN access log (independent
// of the guard's counters). a.test and c.test are allowed hosts; b.test is forbidden; d.test is allowed
// but points at a closed port (upstream error). bhttp is a plain-HTTP loopback listener that must never
// be reached. connect-fwd is a stand-in for the environment's HTTPS proxy (CONNECT forwarder).
const https = require('https');
const http = require('http');
const net = require('net');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const {createFeedbackFixture}=require('./feedback-fixture.cjs');

function cert(dir) {
  const key = path.join(dir, 'fx.key'); const crt = path.join(dir, 'fx.crt');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-keyout', key, '-out', crt, '-subj', '/CN=fixtures', '-addext', 'subjectAltName=DNS:a.test,DNS:b.test,DNS:c.test,DNS:d.test', '-days', '2'], { stdio: 'ignore' });
  return { key: fs.readFileSync(key), cert: fs.readFileSync(crt), caFile: crt };
}

function logger(file) {
  const fd = fs.openSync(file, 'a');
  let live = 0; let maxLive = 0;
  return {
    enter(req) { live++; maxLive = Math.max(maxLive, live); fs.writeSync(fd, JSON.stringify({ t: Date.now(), method: req.method, path: req.url.split('?')[0], mode: req.headers['sec-fetch-mode'] || null, upgrade: req.headers.upgrade || null }) + '\n'); },
    leave() { live--; },
    close() { fs.closeSync(fd); },
    get maxLive() { return maxLive; }, resetMax() { maxLive = live; },
    read() { return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); },
  };
}

const PAGES = {
  '/page': '<!doctype html><title>page</title><img src="/img.png"><p id=t>hello</p>',
  '/img-page': '<!doctype html><img id=i src="/img-redir-cross"><img id=j src="https://b.test/direct.png">',
  '/worker-page': '<!doctype html><script>const w=new Worker("/worker.js");w.onmessage=e=>{document.title=e.data}</script>',
  '/ok': 'ok',
};

function aHandler(L, durable, feedback) {
  return (req, res) => {
    L.enter(req);
    let done = false; const end = () => { if (!done) { done = true; L.leave(); } };
    res.on('close', end);
    const u = new URL(req.url, 'https://a.test');
    const p = u.pathname;
    const send = (status, body, headers = {}) => { res.writeHead(status, { 'content-type': 'text/html', 'cache-control': 'no-store', ...headers }); res.end(req.method === 'HEAD' ? undefined : body); };
    if(feedback.handle(req,res))return;
    if (p === '/model.bin' && req.method === 'GET') {
      req.resume(); const model=Buffer.alloc(8192); for(let i=0;i<model.length;i++)model[i]=i%251;
      res.writeHead(200,{'content-type':'application/octet-stream','content-length':model.length,'cache-control':'no-store'});
      let offset=0; const timer=setInterval(()=>{if(res.destroyed){clearInterval(timer);return;} const end=Math.min(offset+512,model.length);res.write(model.subarray(offset,end));offset=end;if(offset===model.length){clearInterval(timer);res.end();}},20);
      res.once('close',()=>clearInterval(timer)); return;
    }
    if ((p === '/model-gz.bin' || p === '/model-gz2.bin') && req.method === 'GET') {
      // Compressed, chunked (no Content-Length) when the client offers gzip; identity with Content-Length otherwise. Echoes what was negotiated.
      req.resume(); const model=Buffer.alloc(8192); for(let i=0;i<model.length;i++)model[i]=i%251;
      const ae=String(req.headers['accept-encoding']||'');
      if(/gzip/.test(ae)){ res.writeHead(200,{'content-type':'application/octet-stream','content-encoding':'gzip','x-ss-seen-ae':ae,'cache-control':'no-store','access-control-expose-headers':'x-ss-seen-ae'}); res.end(zlib.gzipSync(model)); return; }
      res.writeHead(200,{'content-type':'application/octet-stream','content-length':model.length,'x-ss-seen-ae':ae||'(none)','cache-control':'no-store','access-control-expose-headers':'x-ss-seen-ae'});
      let offset=0; const timer=setInterval(()=>{if(res.destroyed){clearInterval(timer);return;} const end=Math.min(offset+512,model.length);res.write(model.subarray(offset,end));offset=end;if(offset===model.length){clearInterval(timer);res.end();}},20);
      res.once('close',()=>clearInterval(timer)); return;
    }
    if (p === '/model-error.bin' && req.method === 'GET') { req.resume(); const message='intentional-download-error'; return send(503,message,{'content-type':'text/plain','content-length':Buffer.byteLength(message)}); }
    if (p === '/saved' && req.method === 'GET') { req.resume(); return send(200, JSON.stringify({ rows: durable.read() }), { 'content-type': 'application/json' }); }
    if ((p === '/save' || p === '/save-error') && req.method === 'POST') {
      const chunks = []; let bytes = 0;
      req.on('data', chunk => { bytes += chunk.length; if (bytes > 1048576) req.destroy(); else chunks.push(chunk); });
      req.on('end', () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          const values = ['account', 'take', 'completion'].map(k => body[k]);
          if (values.some(v => typeof v !== 'string' || !v)) return send(400, 'invalid fixture identity');
          if (p === '/save-error') return send(503, 'intentional-negative-status');
          const operationDigest = crypto.createHash('sha256').update(JSON.stringify(values)).digest('hex');
          durable.save({ operationDigest, saved: true });
          return send(200, 'saved', { 'content-type': 'text/plain' });
        } catch { return send(400, 'invalid fixture request'); }
      });
      return;
    }
    req.resume();
    if (p === '/redir-nav-cross') return send(302, '', { location: 'https://b.test/leak' });
    if (p === '/img-redir-cross') return send(302, '', { location: 'https://b.test/leak-img' });
    if (p === '/fetch-redir-cross') return send(302, '', { location: 'https://b.test/leak-fetch' });
    if (p === '/chain1') return send(302, '', { location: '/chain2' });
    if (p === '/chain2') return send(301, '', { location: '/chain3' });
    if (p === '/chain3') return send(200, '<!doctype html><title>chain3</title>');
    if (p === '/redir-forbidden-path') return send(302, '', { location: '/forbidden' });
    if (p === '/redir-allowed-cross') return send(302, '', { location: 'https://c.test/ok' });
    if (p === '/redir-loopback') return send(302, '', { location: 'http://127.0.0.1:' + u.searchParams.get('port') + '/loop' });
    if (p === '/gz') { const z = zlib.gzipSync(Buffer.from('<!doctype html><p id=g>gzip-body-ok</p>')); res.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip', 'content-length': z.length }); return res.end(req.method === 'HEAD' ? undefined : z); }
    if (p === '/img.png') return send(200, '', { 'content-type': 'image/png' });
    if (p === '/worker.js') return send(200, 'fetch("https://b.test/w").then(()=>postMessage("b-reached"),()=>fetch("/ok").then(r=>r.text()).then(t=>postMessage("worker-"+t),()=>postMessage("worker-fail")))', { 'content-type': 'text/javascript' });
    if (p === '/sw.js') return send(200, 'self.addEventListener("fetch",()=>{})', { 'content-type': 'text/javascript' });
    if (p === '/slow') { const ms = Number(u.searchParams.get('ms') || 500); return setTimeout(() => send(200, 'slow'), ms); }
    if (p === '/hang') return; // never answers
    if (/^\/nav\d+$/.test(p)) return send(200, '<!doctype html><title>' + p + '</title>');
    if (p === '/') return send(200, '<!doctype html><title>root</title>');
    if (PAGES[p] !== undefined) return send(200, PAGES[p]);
    if (['/post', '/beacon', '/save', '/coach', '/get-only', '/forbidden', '/ws'].includes(p)) return send(200, 'ok-' + p.slice(1));
    return send(404, 'nf');
  };
}

function cHandler(L) {
  return (req, res) => {
    L.enter(req); res.on('close', () => L.leave()); req.resume();
    const h = { 'access-control-allow-origin': 'https://a.test', 'access-control-allow-methods': 'GET, POST', 'access-control-allow-headers': 'content-type', 'cache-control': 'no-store' };
    if (req.method === 'OPTIONS') { res.writeHead(204, h); return res.end(); }
    res.writeHead(200, { ...h, 'content-type': 'text/plain' }); res.end('c-ok');
  };
}

async function startFixtures(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const c = cert(dir);
  const durableFile = path.join(dir, 'durable-saved-rows.jsonl');
  const durableFd = fs.openSync(durableFile, 'wx', 0o600); fs.fsyncSync(durableFd);
  { const dfd = fs.openSync(dir, 'r'); try { fs.fsyncSync(dfd); } finally { fs.closeSync(dfd); } }
  const durable = {
    read: () => fs.readFileSync(durableFile, 'utf8').split('\n').filter(Boolean).map(JSON.parse),
    save(row) { if (!this.read().some(x => x.operationDigest === row.operationDigest)) { fs.writeSync(durableFd, JSON.stringify(row) + '\n'); fs.fsyncSync(durableFd); } },
  };
  const L = { a: logger(path.join(dir, 'a.jsonl')), b: logger(path.join(dir, 'b.jsonl')), c: logger(path.join(dir, 'c.jsonl')), bhttp: logger(path.join(dir, 'bhttp.jsonl')), fwd: logger(path.join(dir, 'connect-fwd.jsonl')) };
  const servers = []; const sockets = new Set();
  let feedback;
  try {
  feedback=createFeedbackFixture(path.join(dir,'durable-feedback-rows.jsonl')); 
  const listen = (srv) => new Promise((r) => { servers.push(srv); srv.on('connection',socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));}); srv.listen(0, '127.0.0.1', () => r(srv.address().port)); });
  const aSrv = https.createServer({ key: c.key, cert: c.cert }, aHandler(L.a, durable, feedback));
  aSrv.on('upgrade', (req, sock) => { L.a.enter(req); L.a.leave(); sock.destroy(); });
  const bSrv = https.createServer({ key: c.key, cert: c.cert }, (req, res) => { L.b.enter(req); L.b.leave(); res.end('LEAK'); });
  bSrv.on('upgrade', (req, sock) => { L.b.enter(req); L.b.leave(); sock.destroy(); });
  const cSrv = https.createServer({ key: c.key, cert: c.cert }, cHandler(L.c));
  const bh = http.createServer((req, res) => { L.bhttp.enter(req); L.bhttp.leave(); res.end('LEAK'); });
  const ports = { a: await listen(aSrv), b: await listen(bSrv), c: await listen(cSrv), bhttp: await listen(bh) };
  const closed = net.createServer(); ports.d = await listen(closed); await new Promise((r) => closed.close(r)); servers.pop();
  const map = { 'a.test:443': ports.a, 'b.test:443': ports.b, 'c.test:443': ports.c, 'd.test:443': ports.d };
  const fwd = http.createServer();
  fwd.on('connect', (req, sock) => {
    L.fwd.enter({ method: 'CONNECT', url: req.url, headers: {} }); L.fwd.leave();
    const port = map[req.url];
    if (!port) { sock.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return; }
    const up = net.connect(port, '127.0.0.1', () => { sock.write('HTTP/1.1 200 OK\r\n\r\n'); up.pipe(sock); sock.pipe(up); });
    up.on('error', () => sock.destroy()); sock.on('error', () => up.destroy());
  });
  ports.fwd = await listen(fwd);
  const override = Object.fromEntries(Object.entries(map).map(([k, v]) => [k.split(':')[0], '127.0.0.1:' + v]));
  return { ports, logs: L, durableFile, durable, feedback, caFile: c.caFile, override, close: async () => { for(const socket of sockets)socket.destroy(); await Promise.all(servers.map((s) => new Promise((r) => { s.closeAllConnections?.(); s.close(() => r()); }))); fs.closeSync(durableFd); feedback.close();for(const logger of Object.values(L))logger.close(); if(servers.some(server=>server.listening))throw new Error('fixture listener remained open'); } };
  } catch(error) {
    for(const socket of sockets)socket.destroy();
    await Promise.all(servers.map(server=>new Promise(resolve=>{if(!server.listening)return resolve();server.close(()=>resolve());})));
    try{fs.closeSync(durableFd);}catch{}
    try{feedback?.close();}catch{}
    for(const logger of Object.values(L))try{logger.close();}catch{}
    throw error;
  }
}

module.exports = { startFixtures };
