import test from 'node:test';
import process from 'node:process';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, appendFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseTrace, buildManifest, firstManifestDifference, splitCall, decodeString } from '../../scripts/ci-build-trace.mjs';

const parse = (lines) => parseTrace(lines.join('\n'));

test('splits calls whose strings, structs and fd decorations contain delimiters', () => {
  const call = splitCall('statx(AT_FDCWD</a, b>, "/x, (y)", AT_STATX_SYNC_AS_STAT, STATX_ALL, {stx_mask=STATX_ALL, stx_mode=S_IFREG|0644}) = 0');
  assert.deepEqual(call.args.slice(0, 2), ['AT_FDCWD</a, b>', '"/x, (y)"']);
  assert.equal(call.result, '= 0');
});

test('decodes escapes and refuses truncated strings', () => {
  assert.equal(decodeString('"a\\"b\\\\c\\x41\\101"'), 'a"b\\cAA');
  assert.throws(() => decodeString('"abc"...'), /TRUNCATED/);
});

test('escaped bytes are decoded as UTF-8, and a name that is not UTF-8 fails closed', () => {
  assert.equal(decodeString('"caf\\303\\251.js"'), 'caf\u00e9.js');
  assert.equal(decodeString('"caf\\xc3\\xa9.js"'), 'caf\u00e9.js');
  assert.throws(() => decodeString('"bad\\377.js"'), /NOT_UTF8/);
  const t = parse(['10 openat(AT_FDCWD</r>, "/r/caf\\303\\251.js", O_RDONLY) = 3</r/caf\\303\\251.js>']);
  assert(t.observed.has('/r/caf\u00e9.js'), [...t.observed].join());
});

test('an escaped fd decoration cannot be read back faithfully and fails closed', () => {
  assert.match(parse(['10 openat(5</r/caf\\303\\251>, "x.js", O_RDONLY) = 3']).problems.join(), /UNDECORATED|UNRESOLVED/);
  assert.match(parse(['10 openat(AT_FDCWD</r/caf\\303\\251>, "/a", O_RDONLY) = 3</a>']).problems.join(), /UNDECORATED/);
});

test('joins unfinished and resumed halves of one call', () => {
  const t = parse(['10 openat(AT_FDCWD</r>, "src/a.ts", O_RDONLY|O_CLOEXEC <unfinished ...>', '11 statx(AT_FDCWD</r>, "/r/b", 0, STATX_ALL, 0x1) = 0',
    '10 <... openat resumed>) = 21</r/src/a.ts>']);
  assert.deepEqual(t.problems, []);
  assert(t.observed.has('/r/src/a.ts') && t.observed.has('/r/b'));
});

test('a failed lookup is still an observation: a later-added file must be noticed', () => {
  const t = parse(['10 openat(AT_FDCWD</r>, "/r/.env.local", O_RDONLY) = -1 ENOENT (No such file or directory)']);
  assert(t.observed.has('/r/.env.local'));
});

test('dirfd-relative paths join the decorated directory; listings are recorded', () => {
  const t = parse(['10 openat(19</r/src>, "x.ts", O_RDONLY) = 3</r/src/x.ts>', '10 getdents64(19</r/src>, 0x1 /* 4 entries */, 32768) = 112']);
  assert(t.observed.has('/r/src/x.ts'));
  assert(t.listed.has('/r/src'));
});

test('relative non-*at paths resolve through the same process cwd, and refuse when unknown', () => {
  const ok = parse(['10 execve("./node_modules/.bin/vite", ["vite"], 0x1 /* 3 vars */) = 0', '10 openat(AT_FDCWD</r/frontend>, "/etc/ld.so.cache", O_RDONLY) = 3</etc/ld.so.cache>']);
  assert(ok.observed.has('/r/frontend/node_modules/.bin/vite'), [...ok.observed].join());
  const unknown = parse(['10 execve("./tool", ["tool"], 0x1 /* 3 vars */) = -1 ENOENT (No such file or directory)']);
  assert.match(unknown.problems.join(), /UNRESOLVED_RELATIVE/);
});

test('a cwd that changes without a traced chdir fails closed', () => {
  const t = parse(['10 openat(AT_FDCWD</r>, "/a", O_RDONLY) = 3</a>', '10 openat(AT_FDCWD</elsewhere>, "/b", O_RDONLY) = 3</b>']);
  assert.match(t.problems.join(), /cwd changed/);
});

test('writes are separated from reads by flags and by syscall', () => {
  const t = parse(['10 openat(AT_FDCWD</r>, "/r/dist/a.js", O_WRONLY|O_CREAT|O_TRUNC|O_CLOEXEC, 0666) = 3</r/dist/a.js>',
    '10 mkdir("/r/dist/assets", 0777) = 0', '10 unlinkat(5</r/dist>, "old.js", 0) = 0', '10 renameat2(AT_FDCWD</r>, "/tmp/x", AT_FDCWD</r>, "/r/dist/x", 0) = 0']);
  assert.deepEqual([...t.written].sort(), ['/r/dist/a.js', '/r/dist/assets', '/r/dist/old.js', '/r/dist/x', '/tmp/x']);
  assert.equal(t.observed.size, 0);
});

test('unclassified path syscalls, undecorated fds and network use make the trace unusable', () => {
  assert.match(parse(['10 mount("/a", "/b", "ext4", 0, NULL) = -1 EPERM (Operation not permitted)']).problems.join(), /UNCLASSIFIED/);
  assert.match(parse(['10 getdents64(5, 0x1 /* 4 entries */, 32768) = 112']).problems.join(), /UNDECORATED/);
  assert.match(parse(['10 openat(AT_FDCWD</r>, "/r/a"..., O_RDONLY) = 3']).problems.join(), /TRUNCATED|unparsed/);
  const t = parse(['10 connect(23<socket:[1]>, {sa_family=AF_INET, sin_port=htons(443), sin_addr=inet_addr("1.2.3.4")}, 16) = 0']);
  const m = buildManifest(t, { root: '/r', outputRoots: [] });
  assert.match(m.problems.join(), /network/);
});

test('a failed connect to an absent local socket is a probe; any answerable connection is network use', () => {
  const nscd = '10 connect(5<socket:[9]>, {sa_family=AF_UNIX, sun_path="/var/run/nscd/socket"}, 110) = -1 ENOENT (No such file or directory)';
  const probe = parse([nscd]);
  assert.deepEqual(probe.problems, []);
  assert.deepEqual(probe.network, []);
  assert(probe.observed.has('/var/run/nscd/socket'), 'recorded as an observed (absent) path, so a socket that appears later forces a rebuild');
  for (const line of [
    '10 connect(5<socket:[9]>, {sa_family=AF_UNIX, sun_path="/var/run/nscd/socket"}, 110) = 0',
    '10 connect(5<socket:[9]>, {sa_family=AF_UNIX, sun_path="/var/run/nscd/socket"}, 110) = -1 ECONNREFUSED (Connection refused)',
    '10 connect(5<socket:[9]>, {sa_family=AF_UNIX, sun_path=@"abstract"}, 12) = -1 ENOENT (No such file or directory)',
    '10 connect(5<socket:[9]>, {sa_family=AF_INET, sin_port=htons(53), sin_addr=inet_addr("127.0.0.53")}, 16) = -1 ENOENT (No such file or directory)',
  ]) {
    const t = parse([line]);
    assert.equal(t.network.length, 1, line);
    assert.match(buildManifest(t, { root: '/r', outputRoots: [] }).problems.join(), /network/, line);
  }
});

function tree(t) {
  const root = mkdtempSync(join(tmpdir(), 'trace-manifest-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (p, s = 'x') => { mkdirSync(dirname(join(root, p)), { recursive: true }); writeFileSync(join(root, p), s); };
  put('src/a.ts', 'a'); put('src/b.ts', 'b'); put('tests/t.test.js', 't'); mkdirSync(join(root, 'dist'));
  return { root, put, outputRoots: [join(root, 'dist')] };
}

test('manifest covers reads, listings, absences and ancestors; unrelated files do not invalidate', (t) => {
  const f = tree(t);
  const trace = { observed: new Set([`${f.root}/src/a.ts`, `${f.root}/.env.local`]), listed: new Set([`${f.root}/src`]), written: new Set([`${f.root}/dist/out.js`]), network: [], problems: [] };
  const { manifest, problems } = buildManifest(trace, { root: f.root, outputRoots: f.outputRoots });
  assert.equal(problems, undefined);
  const names = manifest.map(([n]) => n);
  assert(names.includes('@root/src/a.ts') && names.includes('@root/.env.local') && names.includes('@root') && names.includes('/'));
  const check = () => firstManifestDifference(manifest, { root: f.root, outputRoots: f.outputRoots });
  assert.equal(check(), null);
  f.put('tests/t.test.js', 'changed'); f.put('dist/out.js', 'output'); assert.equal(check(), null, 'unread files and outputs are not inputs');
  f.put('src/b.ts', 'changed'); assert.equal(check(), null, 'a listed directory records names, not unread bytes');
  f.put('src/a.ts', 'changed'); assert.equal(check(), '@root/src/a.ts'); f.put('src/a.ts', 'a');
  f.put('src/new.ts'); assert.equal(check(), '@root/src', 'a new file in a listed directory'); unlinkSync(join(f.root, 'src/new.ts'));
  f.put('.env.local'); assert.equal(check(), '@root/.env.local', 'a file that was probed and absent'); unlinkSync(join(f.root, '.env.local'));
  appendFileSync(join(f.root, 'src/a.ts'), ''); assert.equal(check(), null);
});

test('symlink targets become inputs, and the build may not write outside its output roots', (t) => {
  const f = tree(t);
  f.put('store/pkg/index.js', 'one'); symlinkSync('../store/pkg', join(f.root, 'src/pkg'));
  const { manifest } = buildManifest({ observed: new Set([`${f.root}/src/pkg`]), listed: new Set(), written: new Set(), network: [], problems: [] }, { root: f.root, outputRoots: f.outputRoots });
  assert(manifest.some(([n]) => n === '@root/store/pkg'), 'the link target directory is recorded');
  const bad = buildManifest({ observed: new Set(), listed: new Set(), written: new Set([`${f.root}/src/a.ts`]), network: [], problems: [] }, { root: f.root, outputRoots: f.outputRoots });
  assert.match(bad.problems.join(), /wrote outside/);
});

test('`..` after a symlink is resolved as the kernel does: the file actually read is the input', (t) => {
  const f = tree(t);
  f.put('store/pkg/index.js', 'pkg'); f.put('store/input.js', 'real input'); f.put('input.js', 'lexical decoy');
  symlinkSync('store/pkg', join(f.root, 'link'));
  const trace = parse([`10 openat(AT_FDCWD<${f.root}>, "${f.root}/link/../input.js", O_RDONLY) = 3<${f.root}/store/input.js>`]);
  assert.deepEqual(trace.problems, []);
  const { manifest, problems } = buildManifest(trace, { root: f.root, outputRoots: f.outputRoots });
  assert.equal(problems, undefined, problems?.join('\n'));
  assert(manifest.some(([n]) => n === '@root/store/input.js'), manifest.map(([n]) => n).join());
  const check = () => firstManifestDifference(manifest, { root: f.root, outputRoots: f.outputRoots });
  assert.equal(check(), null);
  f.put('store/input.js', 'changed'); assert.equal(check(), '@root/store/input.js', 'the consumed file changed');
  f.put('store/input.js', 'real input');
  rmSync(join(f.root, 'link')); mkdirSync(join(f.root, 'link'));
  assert.equal(check(), '@root/link', 'the link replaced by a directory');
});

test('a symlink whose target goes through another symlink and `..` records the file actually read', (t) => {
  const f = tree(t);
  f.put('store/pkg/index.js', 'pkg'); f.put('store/input.js', 'real input'); f.put('input.js', 'lexical decoy');
  symlinkSync('store/pkg', join(f.root, 'link'));
  symlinkSync('link/../input.js', join(f.root, 'entry.js'));
  const { manifest, problems } = buildManifest({ observed: new Set([`${f.root}/entry.js`]), listed: new Set(), written: new Set(), network: [], problems: [] },
    { root: f.root, outputRoots: f.outputRoots });
  assert.equal(problems, undefined, problems?.join('\n'));
  const names = manifest.map(([n]) => n);
  assert(names.includes('@root/store/input.js') && names.includes('@root/link'), names.join());
  const check = () => firstManifestDifference(manifest, { root: f.root, outputRoots: f.outputRoots });
  assert.equal(check(), null);
  f.put('store/input.js', 'changed'); assert.equal(check(), '@root/store/input.js');
  f.put('store/input.js', 'real input');
  rmSync(join(f.root, 'link')); symlinkSync('src', join(f.root, 'link'));
  assert.equal(check(), '@root/link', 'the intermediate link was retargeted');
});

test('a write through `..` after a symlink is checked where it really lands', (t) => {
  const f = tree(t);
  symlinkSync('../src', join(f.root, 'dist/out'));
  const trace = parse([`10 openat(AT_FDCWD<${f.root}>, "${f.root}/dist/out/../escaped.js", O_WRONLY|O_CREAT|O_TRUNC, 0644) = 3<${f.root}/escaped.js>`]);
  assert(trace.written.has(`${f.root}/dist/escaped.js`), 'lexically inside the output root');
  assert.match(buildManifest(trace, { root: f.root, outputRoots: f.outputRoots }).problems.join(), /wrote outside/);
});

test('a manifest with an unsafe or malformed entry never matches', (t) => {
  const f = tree(t);
  for (const manifest of [[], [['@root/../etc/passwd', { t: 'missing' }]], [['relative', { t: 'missing' }]], [[1, 2]]]) {
    assert.notEqual(firstManifestDifference(manifest, { root: f.root, outputRoots: f.outputRoots }), null);
  }
});

test('a real strace of a small build observes what it read, probed and listed', (t) => {
  const version = spawnSync('strace', ['-V'], { encoding: 'utf8' });
  assert.equal(version.status, 0, 'strace must be installed where smart builds are produced');
  const f = tree(t);
  f.put('build.mjs', `import fs from 'node:fs';fs.existsSync('src/maybe.ts');fs.readdirSync('src');fs.writeFileSync('dist/out.js',fs.readFileSync('src/a.ts'));`);
  const out = join(f.root, 'dist', 'trace.strace');
  const r = spawnSync('strace', ['-f', '-qq', '-s', '8192', '-y', '-e', 'trace=%file,getdents64,fchdir,connect', '-o', out, process.execPath, 'build.mjs'], { cwd: f.root, encoding: 'utf8',
    // Node passes NODE_V8_COVERAGE to children unless it is set explicitly; a covered test run would otherwise make
    // the traced fixture write coverage outside its output roots (a real build has no coverage directory).
    env: { ...process.env, NODE_V8_COVERAGE: '' } });
  assert.equal(r.status, 0, r.stderr);
  const trace = parseTrace(readFileSync(out, 'utf8'));
  assert.deepEqual(trace.problems, []);
  const { manifest, problems } = buildManifest(trace, { root: f.root, outputRoots: f.outputRoots });
  assert.equal(problems, undefined, problems?.join('\n'));
  const names = new Set(manifest.map(([n]) => n));
  for (const name of ['@root/src/a.ts', '@root/src/maybe.ts', '@root/src', '@root/build.mjs']) assert(names.has(name), name);
  assert(!names.has('@root/src/b.ts'), 'listed but never read: only its name counts');
  assert(manifest.some(([n]) => n === process.execPath), 'the interpreter itself is an input');
  const check = () => firstManifestDifference(manifest, { root: f.root, outputRoots: f.outputRoots });
  assert.equal(check(), null);
  f.put('tests/t.test.js', 'unrelated'); assert.equal(check(), null);
  f.put('src/maybe.ts', 'now exists'); assert.equal(check(), '@root/src');
});

