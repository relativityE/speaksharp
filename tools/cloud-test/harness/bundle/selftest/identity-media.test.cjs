'use strict';
// Offline-only tests. No browser, socket, curl, credentials or production traffic.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { parseIdentityResponse, IdentityLedger, MAX_BODY_BYTES } = require('../harness/identity-core.cjs');
const { parseArgs, curlArgs, runIdentity } = require('../harness/identity-check.cjs');
const { preparePrivateMedia } = require('../harness/media-private.cjs');
const SHA = 'e14340c99610068abf46462221898bac4f5761fe';
const ALT = '73c5e2d4e9f198805441d6f7b9a84991b4aee375';
const body = '<html><script>window.__APP_RELEASE__ = {"sha":"' + SHA + '"};</script></html>';
const binding = { url: 'https://speaksharp-public.vercel.app/', expectedSha: SHA, cap: 2, phase: 'offline-fixture' };
function privateTmp(t) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-rev3-unit-')); fs.chmodSync(dir, 0o700); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  // macOS inherits /private/tmp's group even for an owned0700 child. Provision
  // only this freshly created fixture to the calling UID/GID; production guards
  // still reject an unprovisioned parent or unexpected ownership.
  fs.chownSync(dir, process.getuid(), process.getgid());
  assert.equal(fs.statSync(dir).gid, process.getgid()); return dir; }
function parse(extra = {}) { return parseIdentityResponse({ body, status: 200, redirects: 0, transportExit: 0, expectedSha: SHA, ...extra }); }

test('identity positive: exact JSON marker, full SHA, inert body only', () => {
  const r = parse(); assert.equal(r.result, 'MATCH'); assert.equal(r.servedSha, SHA); assert.equal(r.markerCount, 1);
  assert.equal(r.evidenceScope, 'inert-text-marker-only'); assert.equal('body' in r, false);
});
test('identity shipping JSON-string marker matches exact full SHA', () => {
  const r=parse({body:'<script>window.__APP_RELEASE__='+JSON.stringify(SHA)+';</script>'});
  assert.equal(r.result,'MATCH');assert.equal(r.servedSha,SHA);assert.equal(r.markerCount,1);
});
test('identity JSON-string marker mismatch blocks', () => {assert.equal(parse({body:'<script>window.__APP_RELEASE__='+JSON.stringify(ALT)+';</script>'}).reason,'drift');});
test('identity JSON-string marker rejects non-40-hex values', () => {
  for(const value of [SHA.slice(0,39),SHA+'0',SHA.toUpperCase(),'release '+SHA,42,null,[]])assert.equal(parse({body:'<script>window.__APP_RELEASE__='+JSON.stringify(value)+';</script>'}).result,'BLOCKED');
});
test('identity JSON-string marker rejects a second SHA in the same value', () => {assert.equal(parse({body:'<script>window.__APP_RELEASE__='+JSON.stringify(SHA+' '+ALT)+';</script>'}).reason,'marker-string-not-sha');});
test('identity JSON-string quote escape is rejected when parsed value is not exactly SHA', () => {
  assert.equal(parse({body:'<script>window.__APP_RELEASE__='+JSON.stringify(SHA+'"')+';</script>'}).reason,'marker-string-not-sha');
  assert.equal(parse({body:'<script>window.__APP_RELEASE__="'+SHA+'\\q";</script>'}).reason,'marker-not-json');
});
test('identity JSON-string escaped character is accepted only for exact decoded SHA', () => {
  assert.equal(parse({body:'<script>window.__APP_RELEASE__="\\u0065'+SHA.slice(1)+'";</script>'}).result,'MATCH');
  assert.equal(parse({body:'<script>window.__APP_RELEASE__="'+SHA+'\\n";</script>'}).result,'BLOCKED');
});
test('identity JSON-string executable grammar and duplicate assignments are rejected', () => {
  for(const expression of ['JSON.stringify("'+SHA+'")','"'+SHA+'"+""','`'+SHA+'`'])assert.equal(parse({body:'<script>window.__APP_RELEASE__='+expression+';</script>'}).result,'BLOCKED');
  const marker='<script>window.__APP_RELEASE__='+JSON.stringify(SHA)+';</script>';
  assert.equal(parse({body:marker+marker}).reason,'marker-count-2');
});
test('identity JSON-object escaped second SHA cannot hide ambiguity', () => {
  const escaped='\\u0037'+ALT.slice(1);
  assert.equal(parse({body:'<script>window.__APP_RELEASE__={"sha":"'+SHA+'","other":"'+escaped+'"};</script>'}).reason,'marker-sha-ambiguous');
});
test('identity marker in an HTML comment is not a release assignment', () => { assert.equal(parse({ body: '<!--' + body + '-->' }).reason, 'marker-not-standalone-inline-json'); });
test('identity marker inside a JavaScript string is rejected', () => { assert.equal(parse({ body: '<script>const example = \'window.__APP_RELEASE__={\"sha\":\"' + SHA + '\"};\';</script>' }).reason, 'marker-not-standalone-inline-json'); });
test('identity JSON-string marker requires an unambiguous JavaScript script type', () => {
  const marker='window.__APP_RELEASE__='+JSON.stringify(SHA)+';';
  assert.equal(parse({body:'<script type=application/json>'+marker+'</script>'}).result,'BLOCKED');
  assert.equal(parse({body:'<script type=module type=application/json>'+marker+'</script>'}).result,'BLOCKED');
  assert.equal(parse({body:'<script type=text/javascript>'+marker+'</script>'}).result,'MATCH');
});
test('identity marker in non-JavaScript script is rejected', () => { assert.equal(parse({ body: body.replace('<script>', '<script type="application/json">') }).reason, 'marker-not-standalone-inline-json'); });
test('identity mismatch blocks', () => { assert.equal(parse({ expectedSha: ALT }).reason, 'drift'); });
test('identity missing marker blocks', () => { assert.equal(parse({ body: '<html>none</html>' }).reason, 'marker-count-0'); });
test('identity duplicate assignments block', () => { assert.equal(parse({ body: body + body }).reason, 'marker-count-2'); });
test('identity malformed second marker blocks', () => { assert.equal(parse({ body: body + '<script>window.__APP_RELEASE__ = unknown;</script>' }).reason, 'marker-count-2'); });
test('identity multiple SHA values ambiguous', () => { assert.equal(parse({ body: '<script>window.__APP_RELEASE__={"sha":"' + SHA + '","other":"' + ALT + '"};</script>' }).reason, 'marker-sha-ambiguous'); });
test('identity non-JSON assignment fails closed without evaluating code', () => {
  assert.equal(parse({ body: '<script>window.__APP_RELEASE__={"sha":process.exit(0)};</script>' }).reason, 'marker-not-json');
});
test('identity redirect status blocked without following', () => { assert.equal(parse({ status: 302 }).reason, 'redirect'); });
test('identity unexpected redirect count blocks even with status 200', () => { assert.equal(parse({ redirects: 1 }).reason, 'redirect'); });
test('identity server error status is not MATCH', () => { assert.equal(parse({ status: 500 }).reason, 'http-500'); });
test('identity transport failure is not MATCH even with matching marker', () => { assert.equal(parse({ transportExit: 1 }).reason, 'transport-error'); });
test('identity oversized body blocks', () => { assert.equal(parse({ body: body + ' '.repeat(MAX_BODY_BYTES) }).reason, 'body-too-large'); });
test('identity requires explicit authorization argument', () => {
  assert.throws(() => parseArgs(['--url', binding.url, '--expect-sha', SHA, '--ledger', '/never-used', '--cap', '2', '--phase', 'unit']), /NOT AUTHORIZED/);
});
test('identity rejects unknown and duplicate CLI flags before transport', () => {
  assert.throws(() => parseArgs(['--insecure', 'true']), /unknown/);
  assert.throws(() => parseArgs(['--authorize-identity-read', 'true', '--authorize-identity-read', 'true']), /repeated/);
});
test('curl uses normal TLS, ignores config, never follows redirects/retries', () => {
  const args = curlArgs(binding.url, '/unit-body'); assert.equal(args[0], '-q');
  assert.equal(args.includes('-k') || args.includes('--insecure') || args.includes('-L') || args.includes('--location'), false);
  assert.equal(args[args.indexOf('--retry') + 1], '0'); assert.equal(args[args.indexOf('--max-redirs') + 1], '0');
  assert.equal(args[args.indexOf('--proto') + 1], '=https'); assert.equal(args.includes('--cacert'), false);
});
test('ledger reservation durable before sending, cumulative across reopening', (t) => {
  const file = path.join(privateTmp(t), 'ledger.json'); const l = new IdentityLedger(file, binding);
  assert.equal(l.reserve(), 1); assert.equal(JSON.parse(fs.readFileSync(file)).identityGets, 1); l.release();
  const next = new IdentityLedger(file, binding); assert.equal(next.reserve(), 2); assert.equal(next.reserve(), null); next.release();
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});
test('ledger concurrent invocation fails closed; pending reservation never refunded', (t) => {
  const file = path.join(privateTmp(t), 'ledger.json'); const l = new IdentityLedger(file, binding); l.reserve();
  assert.throws(() => new IdentityLedger(file, binding), { code: 'EEXIST' }); l.release();
  const next = new IdentityLedger(file, binding); assert.equal(next.state.identityGets, 1); assert.equal(next.state.receipts[0].result, 'RESERVED'); next.release();
});
test('ledger cap zero refuses without creating reservation file', (t) => {
  const file = path.join(privateTmp(t), 'ledger.json'); const l = new IdentityLedger(file, { ...binding, cap: 0 });
  assert.equal(l.reserve(), null); l.release(); assert.equal(fs.existsSync(file), false);
});
test('ledger rejects changed campaign cap or SHA', (t) => {
  const file = path.join(privateTmp(t), 'ledger.json'); const l = new IdentityLedger(file, binding); l.reserve(); l.release();
  assert.throws(() => new IdentityLedger(file, { ...binding, cap: 10 }), /binding changed/);
  assert.throws(() => new IdentityLedger(file, { ...binding, expectedSha: ALT }), /binding changed/);
});
test('ledger rejects nonprivate directory and symlink target', (t) => {
  const dir = privateTmp(t); const publicDir = path.join(dir, 'public'); fs.mkdirSync(publicDir, { mode: 0o755 }); fs.chmodSync(publicDir, 0o755);
  assert.throws(() => new IdentityLedger(path.join(publicDir, 'ledger.json'), binding), /private directory/);
  const file = path.join(dir, 'ledger.json'); const target = path.join(dir, 'other'); fs.writeFileSync(target, '{}', { mode: 0o600 }); fs.symlinkSync(target, file);
  assert.throws(() => new IdentityLedger(file, binding), /private file/);
});
test('identity fake transport observes pre-send reservation, private body, exact curl command; cleanup', (t) => {
  const file = path.join(privateTmp(t), 'ledger.json'); let tempDir;
  const r = runIdentity({ ledger: file, binding }, (command, args) => {
    assert.equal(command, 'curl'); assert.equal(JSON.parse(fs.readFileSync(file)).identityGets, 1);
    const output = args[args.indexOf('--output') + 1]; tempDir = path.dirname(output);
    assert.equal(fs.statSync(tempDir).mode & 0o777, 0o700); assert.equal(fs.statSync(output).mode & 0o777, 0o600);
    fs.writeFileSync(output, body); return { status: 0, stdout: '200 0 ' + Buffer.byteLength(body) };
  });
  assert.equal(r.exitCode, 0); assert.equal(r.receipt.result, 'MATCH'); assert.equal(fs.existsSync(tempDir), false); assert.equal(fs.existsSync(file + '.lock'), false);
});
test('identity fake redirect transport yields blocked receipt; never second request', (t) => {
  const file = path.join(privateTmp(t), 'ledger.json'); let calls = 0;
  const r = runIdentity({ ledger: file, binding }, (_command, args) => { calls++; fs.writeFileSync(args[args.indexOf('--output') + 1], body); return { status: 0, stdout: '302 0 0' }; });
  assert.equal(calls, 1); assert.equal(r.exitCode, 10); assert.equal(r.receipt.reason, 'redirect');
});
test('identity transport throw remains counted and cleans private files', (t) => {
  const file = path.join(privateTmp(t), 'ledger.json'); let tempDir;
  const r = runIdentity({ ledger: file, binding }, (_command, args) => { tempDir = path.dirname(args[args.indexOf('--output') + 1]); throw new Error('fixture-only-failure'); });
  assert.equal(r.exitCode, 10); assert.equal(r.receipt.reason, 'transport-error'); assert.equal(JSON.parse(fs.readFileSync(file)).identityGets, 1); assert.equal(fs.existsSync(tempDir), false);
});
test('identity zero cap never invokes injected transport', (t) => {
  const r = runIdentity({ ledger: path.join(privateTmp(t), 'ledger.json'), binding: { ...binding, cap: 0 } }, () => { throw new Error('must not send'); });
  assert.equal(r.exitCode, 11); assert.equal(r.receipt.reason, 'identity-cap');
});
function fixture(dir) { const wav = Buffer.alloc(44); wav.write('RIFF', 0); wav.writeUInt32LE(36, 4); wav.write('WAVE', 8); const file = path.join(dir, 'fixture.wav'); fs.writeFileSync(file, wav, { mode: 0o600 }); return { file, expectedSha256: crypto.createHash('sha256').update(wav).digest('hex') }; }
test('media copy is private per run, hash bound, scoped cleanup leaves source', (t) => {
  const dir = privateTmp(t); const f = fixture(dir); const media = preparePrivateMedia({ ...f, runDir: dir });
  assert.equal(fs.statSync(media.directory).mode & 0o777, 0o700); assert.equal(fs.statSync(media.path).mode & 0o777, 0o600);
  assert.equal(media.sha256, f.expectedSha256); media.cleanup(); media.cleanup(); assert.equal(fs.existsSync(media.directory), false); assert.equal(fs.existsSync(f.file), true);
});
test('media hash mismatch fails before copy', (t) => { const dir = privateTmp(t); const f = fixture(dir); assert.throws(() => preparePrivateMedia({ ...f, expectedSha256: '0'.repeat(64), runDir: dir }), /hash differs/); });
test('media rejects symlink source and public run directory', (t) => {
  const dir = privateTmp(t); const f = fixture(dir); const link = path.join(dir, 'link.wav'); fs.symlinkSync(f.file, link);
  assert.throws(() => preparePrivateMedia({ ...f, file: link, runDir: dir }), /non-symlink/);
  const publicDir = path.join(dir, 'public'); fs.mkdirSync(publicDir, { mode: 0o755 }); fs.chmodSync(publicDir, 0o755);
  assert.throws(() => preparePrivateMedia({ ...f, runDir: publicDir }), /private directory/);
});
test('media cross-UID browser remains HARNESS_LIMITED; permissions not widened', (t) => {
  const dir = privateTmp(t); const f = fixture(dir); assert.throws(() => preparePrivateMedia({ ...f, runDir: dir, browserUid: (process.getuid ? process.getuid() : 0) + 1 }), /cross-UID/);
  assert.equal(fs.statSync(f.file).mode & 0o777, 0o600);
});
test('media cleanup refuses unexpected content instead of broad deletion', (t) => {
  const dir = privateTmp(t); const f = fixture(dir); const media = preparePrivateMedia({ ...f, runDir: dir });
  const extra = path.join(media.directory, 'unexpected'); fs.writeFileSync(extra, 'retain', { mode: 0o600 });
  assert.throws(() => media.cleanup(), /unexpected/); assert.equal(fs.existsSync(extra), true); fs.unlinkSync(extra); media.cleanup();
});

// Virtual ownership tests: no actual chown, root execution, browser, wrapper, or changes to
// /var/tmp occur. Every filesystem call below is an in-memory adapter operation.
function virtualMediaFixture(options = {}) {
  const nodes = new Map(); const handles = new Map(); const operations = []; let inode = 1; let fd = 1; let sequence = 1;
  const supervisorUid = options.supervisorUid === undefined ? 0 : options.supervisorUid;
  const supervisorGid = options.supervisorGid === undefined ? 0 : options.supervisorGid;
  const approvedPrivateParent = '/approved/existing-parent'; const sourceFile = '/reviewed/source.wav';
  const wav = Buffer.alloc(44); wav.write('RIFF', 0); wav.writeUInt32LE(36, 4); wav.write('WAVE', 8);
  function add(p, kind, mode, owner = supervisorUid, group = supervisorGid, content = Buffer.alloc(0)) {
    const node = { kind, mode, uid: owner, gid: group, nlink: 1, dev: 1, ino: inode++, content: Buffer.from(content) }; nodes.set(p, node); return node;
  }
  add(approvedPrivateParent, 'directory', options.parentMode === undefined ? 0o755 : options.parentMode, options.parentUid === undefined ? 0 : options.parentUid, 0);
  add(sourceFile, 'file', 0o600, 1000, 1000, wav);
  function node(p) { if (!nodes.has(p)) { const e = new Error('virtual ENOENT ' + p); e.code = 'ENOENT'; throw e; } return nodes.get(p); }
  function stat(p) { const n = node(p); return { ...n, isDirectory: () => n.kind === 'directory', isFile: () => n.kind === 'file', isSymbolicLink: () => n.kind === 'symlink' }; }
  const virtualFs = {
    constants: fs.constants,
    lstatSync: stat,
    fstatSync: (handle) => stat(handles.get(handle)),
    realpathSync: (p) => { node(p); return options.parentSymlinkAncestor && p === approvedPrivateParent ? '/different/parent' : p; },
    openSync: (p, flags, mode) => {
      operations.push({ op: 'open', path: p, flags, mode });
      if (flags & fs.constants.O_CREAT) { if (nodes.has(p)) throw new Error('virtual EEXIST'); add(p, 'file', mode); }
      node(p); const handle = fd++; handles.set(handle, p); return handle;
    },
    closeSync: (handle) => handles.delete(handle),
    readFileSync: (p) => Buffer.from(node(typeof p === 'number' ? handles.get(p) : p).content),
    writeFileSync: (p, data) => { node(typeof p === 'number' ? handles.get(p) : p).content = Buffer.from(data); },
    fsyncSync: (handle) => { node(handles.get(handle)); operations.push({ op: 'fsync', path: handles.get(handle) }); },
    mkdtempSync: (prefix) => { const p = prefix + 'virtual' + sequence++; add(p, 'directory', 0o700); operations.push({ op: 'mkdir', path: p, mode: 0o700 }); return p; },
    chmodSync: () => { throw new Error('chmod must never occur in this provisioning design'); },
    chownSync: (p, owner, group) => {
      operations.push({ op: 'chown', path: p, uid: owner, gid: group });
      if (options.failDirectoryTransfer && node(p).kind === 'directory') throw new Error('virtual transfer failure');
      node(p).uid = owner; node(p).gid = group;
    },
    readdirSync: (dir) => [...nodes.keys()].filter((p) => path.dirname(p) === dir).map((p) => path.basename(p)),
    unlinkSync: (p) => { if (node(p).kind === 'directory') throw new Error('virtual EISDIR'); operations.push({ op: 'unlink', path: p }); nodes.delete(p); },
    rmdirSync: (p) => { if ([...nodes.keys()].some((x) => path.dirname(x) === p)) throw new Error('virtual ENOTEMPTY'); node(p); operations.push({ op: 'rmdir', path: p }); nodes.delete(p); },
  };
  return { nodes, operations, add, adapter: { fs: virtualFs, getuid: () => supervisorUid, getgid: () => supervisorGid },
    input: { sourceFile, runDir: '/unused/current-user-run', expectedSha256: crypto.createHash('sha256').update(wav).digest('hex'), targetUid: 65534, targetGid: 65534, approvedPrivateParent } };
}
const { createPrivateMedia } = require('../harness/media-private.cjs');
test('VIRTUAL ONLY cross-UID provisioning transfers only fresh 0600 file then 0700 directory', () => {
  const v = virtualMediaFixture(); const parentBefore = { ...v.nodes.get(v.input.approvedPrivateParent) }; const sourceBefore = { ...v.nodes.get(v.input.sourceFile) };
  const media = createPrivateMedia(v.input, v.adapter);
  assert.equal(media.crossUid, true); assert.equal(media.targetUid, 65534); assert.equal(media.targetGid, 65534);
  assert.equal(v.nodes.get(media.directory).mode, 0o700); assert.equal(v.nodes.get(media.path).mode, 0o600);
  assert.deepEqual(v.operations.filter((o) => o.op === 'chown'), [
    { op: 'chown', path: media.path, uid: 65534, gid: 65534 }, { op: 'chown', path: media.directory, uid: 65534, gid: 65534 }]);
  assert.deepEqual(v.nodes.get(v.input.approvedPrivateParent), parentBefore); assert.deepEqual(v.nodes.get(v.input.sourceFile), sourceBefore);
  media.cleanup(); media.cleanup(); assert.equal(v.nodes.has(media.directory), false); assert.equal(v.nodes.has(media.path), false);
  assert.deepEqual(v.nodes.get(v.input.sourceFile), sourceBefore); assert.deepEqual(v.nodes.get(v.input.approvedPrivateParent), parentBefore);
});
test('VIRTUAL ONLY cross-UID rejects non-root supervisor before creating or changing anything', () => {
  const v = virtualMediaFixture({ supervisorUid: 1000, supervisorGid: 1000 });
  assert.throws(() => createPrivateMedia(v.input, v.adapter), /reviewed root supervisor/); assert.deepEqual(v.operations, []);
});
test('VIRTUAL ONLY cross-UID requires explicit reviewed UID AND GID', () => {
  for (const field of ['targetUid', 'targetGid']) { const v = virtualMediaFixture(); delete v.input[field]; assert.throws(() => createPrivateMedia(v.input, v.adapter), /explicitly bind/); assert.deepEqual(v.operations, []); }
  const v = virtualMediaFixture(); v.input.targetUid = 1234; assert.throws(() => createPrivateMedia(v.input, v.adapter), /explicitly bind/);
});
test('VIRTUAL ONLY cross-UID rejects absent or unbound existing parent; never creates it', () => {
  const v = virtualMediaFixture(); delete v.input.approvedPrivateParent; assert.throws(() => createPrivateMedia(v.input, v.adapter), /explicitly bound/); assert.deepEqual(v.operations, []);
  const missing = virtualMediaFixture(); missing.nodes.delete(missing.input.approvedPrivateParent); assert.throws(() => createPrivateMedia(missing.input, missing.adapter), /ENOENT/); assert.deepEqual(missing.operations, []);
});
test('VIRTUAL ONLY cross-UID rejects writable, wrong-owner, nontraversable or symlink parent', () => {
  for (const options of [{ parentMode: 0o777 }, { parentMode: 0o775 }, { parentUid: 1000 }, { parentMode: 0o700 }, { parentSymlinkAncestor: true }]) {
    const v = virtualMediaFixture(options); assert.throws(() => createPrivateMedia(v.input, v.adapter), /parent/); assert.deepEqual(v.operations, []);
  }
  const symlink = virtualMediaFixture(); symlink.nodes.get(symlink.input.approvedPrivateParent).kind = 'symlink';
  assert.throws(() => createPrivateMedia(symlink.input, symlink.adapter), /non-symlink/); assert.deepEqual(symlink.operations, []);
});
test('VIRTUAL ONLY cross-UID mismatched bytes do not create media or transfer ownership', () => {
  const v = virtualMediaFixture(); v.input.expectedSha256 = '0'.repeat(64);
  assert.throws(() => createPrivateMedia(v.input, v.adapter), /hash differs/); assert.equal(v.operations.some((o) => ['mkdir', 'chown'].includes(o.op)), false);
});
test('VIRTUAL ONLY partial ownership-transfer failure cleans only generated nodes', () => {
  const v = virtualMediaFixture({ failDirectoryTransfer: true }); assert.throws(() => createPrivateMedia(v.input, v.adapter), /virtual transfer failure/);
  assert.deepEqual([...v.nodes.keys()].sort(), [v.input.approvedPrivateParent, v.input.sourceFile].sort());
  assert.equal(v.operations.filter((o) => ['unlink', 'rmdir'].includes(o.op)).every((o) => o.path.startsWith(v.input.approvedPrivateParent + '/media-private-')), true);
});
test('VIRTUAL ONLY cleanup refuses inode replacement without touching replacement or source', () => {
  const v = virtualMediaFixture(); const media = createPrivateMedia(v.input, v.adapter); v.nodes.get(media.path).ino += 1000;
  assert.throws(() => media.cleanup(), /identity\/ownership changed/); assert.equal(v.nodes.has(media.path), true); assert.equal(v.nodes.has(v.input.sourceFile), true);
});
test('VIRTUAL ONLY cleanup refuses added content instead of recursive deletion', () => {
  const v = virtualMediaFixture(); const media = createPrivateMedia(v.input, v.adapter); const extra = path.join(media.directory, 'extra'); v.add(extra, 'file', 0o600, 65534, 65534);
  assert.throws(() => media.cleanup(), /unexpected media-directory content/); assert.equal(v.nodes.has(extra), true); assert.equal(v.nodes.has(v.input.sourceFile), true);
});
