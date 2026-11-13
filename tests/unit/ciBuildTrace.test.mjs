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
  put('src/a.ts', 'a'); put('src/b.ts', 'b'); put('src/b.mjs', 'export default 1;'); put('tests/t.test.js', 't'); mkdirSync(join(root, 'dist'));
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


// Temporary files (Sam's #1837 review finding): the build may write under /tmp, but a read of a temporary path
// counts only when the trace proves, in order, that the build itself created that path from nothing first.
const scratchBuild = (lines) => buildManifest(parse(lines), { root: '/r', outputRoots: ['/r/dist'], scratchRoots: ['/tmp'] });
const refusedTemp = (result, path) => (result.problems ?? []).some((p) => p === `build read a temporary path it did not create: ${path}`);

test('negative control: a temporary file the build did not create blocks the receipt', () => {
  // A pre-existing /tmp file changes between runners without any recorded input changing, so the trace is unusable.
  const read = scratchBuild(['10 openat(AT_FDCWD</r>, "/tmp/generated-config.json", O_RDONLY|O_CLOEXEC) = 3</tmp/generated-config.json>',
    '10 openat(AT_FDCWD</r>, "/r/dist/out.js", O_WRONLY|O_CREAT|O_TRUNC, 0644) = 4</r/dist/out.js>']);
  assert.equal(read.manifest, undefined);
  assert(refusedTemp(read, '/tmp/generated-config.json'), read.problems?.join('\n'));
  for (const line of ['10 statx(AT_FDCWD</r>, "/tmp/x", AT_STATX_SYNC_AS_STAT, STATX_ALL, {stx_mode=S_IFREG|0644}) = 0',
    '10 access("/tmp/x", F_OK) = -1 ENOENT (No such file or directory)',
    '10 execve("/tmp/x", ["x"], 0x1 /* 3 vars */) = 0',
    '10 getdents64(5</tmp/x>, 0x1 /* 4 entries */, 32768) = 112',
    '10 readlink("/tmp/x", "/r/src", 4095) = 6',
    '10 mkdir("/tmp/x", 0777) = -1 EEXIST (File exists)',
    // Opened for writing as well, but read-write: the old content is read.
    '10 openat(AT_FDCWD</r>, "/tmp/x", O_RDWR|O_CREAT|O_CLOEXEC, 0644) = 3</tmp/x>']) {
    assert(refusedTemp(scratchBuild([line]), '/tmp/x'), line);
  }
  // A hand-built trace with no event log cannot prove anything either.
  const bare = buildManifest({ observed: new Set(['/tmp/x']), listed: new Set(), written: new Set(), network: [], problems: [] },
    { root: '/r', outputRoots: [], scratchRoots: ['/tmp'] });
  assert(refusedTemp(bare, '/tmp/x'));
});

test('a temporary file the build created from nothing before reading it is allowed and is not an input', () => {
  for (const create of ['10 openat(AT_FDCWD</r>, "/tmp/esbuild-1", O_WRONLY|O_CREAT|O_TRUNC|O_CLOEXEC, 0666) = 3</tmp/esbuild-1>',
    '10 openat(AT_FDCWD</r>, "/tmp/esbuild-1", O_RDWR|O_CREAT|O_EXCL|O_CLOEXEC, 0600) = 3</tmp/esbuild-1>',
    '10 creat("/tmp/esbuild-1", 0644) = 3</tmp/esbuild-1>']) {
    const result = scratchBuild([create, '11 openat(AT_FDCWD</r>, "/tmp/esbuild-1", O_RDONLY|O_CLOEXEC) = 5</tmp/esbuild-1>',
      '11 statx(5</tmp/esbuild-1>, "", AT_STATX_SYNC_AS_STAT|AT_EMPTY_PATH, STATX_ALL, {stx_mode=S_IFREG|0644}) = 0',
      '10 unlink("/tmp/esbuild-1") = 0', '11 access("/tmp/esbuild-1", F_OK) = -1 ENOENT (No such file or directory)']);
    assert.equal(result.problems, undefined, `${create}\n${result.problems?.join('\n')}`);
    assert(!result.manifest.some(([n]) => n.startsWith('/tmp/')), 'the build\'s own temporary files are not inputs');
  }
  // A directory the build made, and everything it then wrote inside it, may be listed and read back.
  const dir = scratchBuild(['10 mkdir("/tmp/work", 0700) = 0', '10 openat(AT_FDCWD</r>, "/tmp/work/a", O_WRONLY|O_CREAT|O_CLOEXEC, 0644) = 3</tmp/work/a>',
    '10 getdents64(4</tmp/work>, 0x1 /* 3 entries */, 32768) = 72', '10 openat(AT_FDCWD</r>, "/tmp/work/a", O_RDONLY) = 3</tmp/work/a>']);
  assert.equal(dir.problems, undefined, dir.problems?.join('\n'));
  // A temporary file renamed into place keeps its proof (Node writes caches this way).
  const renamed = scratchBuild(['10 openat(AT_FDCWD</r>, "/tmp/c.tmp", O_RDWR|O_CREAT|O_EXCL, 0600) = 3</tmp/c.tmp>',
    '10 rename("/tmp/c.tmp", "/tmp/c") = 0', '11 openat(AT_FDCWD</r>, "/tmp/c", O_RDONLY) = 3</tmp/c>']);
  assert.equal(renamed.problems, undefined, renamed.problems?.join('\n'));
});

test('a temporary path only counts as created when nothing pre-existing could have supplied it', () => {
  const cases = {
    'read before it was created': ['11 openat(AT_FDCWD</r>, "/tmp/a", O_RDONLY) = 5</tmp/a>', '10 openat(AT_FDCWD</r>, "/tmp/a", O_WRONLY|O_CREAT|O_TRUNC, 0644) = 3</tmp/a>'],
    'a probe that found nothing, before the build made it': ['11 access("/tmp/a", F_OK) = -1 ENOENT (No such file or directory)', '10 openat(AT_FDCWD</r>, "/tmp/a", O_WRONLY|O_CREAT|O_EXCL, 0644) = 3</tmp/a>'],
    'appended to, not started from nothing': ['10 openat(AT_FDCWD</r>, "/tmp/a", O_WRONLY|O_CREAT|O_APPEND, 0644) = 3</tmp/a>', '10 openat(AT_FDCWD</r>, "/tmp/a", O_RDONLY) = 3</tmp/a>'],
    'truncating open that followed a planted symlink': ['10 openat(AT_FDCWD</r>, "/tmp/a", O_WRONLY|O_CREAT|O_TRUNC, 0644) = 3</r/src/secret>', '10 openat(AT_FDCWD</r>, "/tmp/a", O_RDONLY) = 3</r/src/secret>'],
    'a failed create': ['10 openat(AT_FDCWD</r>, "/tmp/a", O_WRONLY|O_CREAT|O_EXCL, 0644) = -1 EEXIST (File exists)', '10 openat(AT_FDCWD</r>, "/tmp/a", O_RDONLY) = 3</tmp/a>'],
    'replaced by a symlink after it was created': ['10 openat(AT_FDCWD</r>, "/tmp/a", O_WRONLY|O_CREAT|O_EXCL, 0644) = 3</tmp/a>', '10 unlink("/tmp/a") = 0', '10 symlink("/r/src/secret", "/tmp/a") = 0', '10 openat(AT_FDCWD</r>, "/tmp/a", O_RDONLY) = 3</r/src/secret>'],
    'a hard link to another file': ['10 link("/r/dist/out.js", "/tmp/a") = 0', '10 openat(AT_FDCWD</r>, "/tmp/a", O_RDONLY) = 3</tmp/a>'],
    'renamed from a file the build did not create': ['10 rename("/tmp/old", "/tmp/a") = 0', '10 openat(AT_FDCWD</r>, "/tmp/a", O_RDONLY) = 3</tmp/a>'],
    'exchanged with a file the build did not create': ['10 openat(AT_FDCWD</r>, "/tmp/a", O_WRONLY|O_CREAT|O_EXCL, 0644) = 3</tmp/a>', '10 renameat2(AT_FDCWD</r>, "/tmp/a", AT_FDCWD</r>, "/tmp/b", RENAME_EXCHANGE) = 0', '10 openat(AT_FDCWD</r>, "/tmp/a", O_RDONLY) = 3</tmp/a>'],
    'a directory made inside one the build did not create': ['10 mkdir("/tmp/shared/a", 0700) = 0', '10 openat(AT_FDCWD</r>, "/tmp/shared/a/x", O_WRONLY|O_CREAT, 0644) = 3</tmp/shared/a/x>', '10 openat(AT_FDCWD</r>, "/tmp/shared/a/x", O_RDONLY) = 3</tmp/shared/a/x>'],
    'found again after the build removed it': ['10 openat(AT_FDCWD</r>, "/tmp/a", O_WRONLY|O_CREAT|O_EXCL, 0644) = 3</tmp/a>', '10 unlink("/tmp/a") = 0', '10 openat(AT_FDCWD</r>, "/tmp/a", O_RDONLY) = 3</tmp/a>'],
  };
  for (const [label, lines] of Object.entries(cases)) {
    const result = scratchBuild(lines);
    assert.equal(result.manifest, undefined, label);
    assert(result.problems.some((p) => /temporary path it did not create: \/tmp\/(a|shared\/a\/x)$/.test(p)), `${label}\n${result.problems.join('\n')}`);
  }
});

test('temporary paths reached through `..` or a link, and the scratch root itself', (t) => {
  const f = tree(t);
  const scratch = mkdtempSync(join(tmpdir(), 'trace-scratch-'));
  t.after(() => rmSync(scratch, { recursive: true, force: true }));
  writeFileSync(join(scratch, 'input.js'), 'pre-existing');
  const options = { root: f.root, outputRoots: f.outputRoots, scratchRoots: [tmpdir()] };
  symlinkSync(join(scratch, 'input.js'), join(f.root, 'src/linked.js'));
  // A stat reports no landing place, so only the link's own target shows where it leads.
  const linked = buildManifest(parse([`10 statx(AT_FDCWD<${f.root}>, "${f.root}/src/linked.js", AT_STATX_SYNC_AS_STAT, STATX_ALL, {stx_mode=S_IFREG|0644}) = 0`]), options);
  assert.match(linked.problems?.join('\n') ?? '', /input link into a temporary path/);
  // Lexically inside the checkout, but the kernel follows the link into the scratch directory before `..`.
  mkdirSync(join(scratch, 'd')); symlinkSync(join(scratch, 'd'), join(f.root, 'via'));
  const dotdot = buildManifest(parse([`10 statx(AT_FDCWD<${f.root}>, "${f.root}/via/../input.js", AT_STATX_SYNC_AS_STAT, STATX_ALL, {stx_mode=S_IFREG|0644}) = 0`]), options);
  assert.match(dotdot.problems?.join('\n') ?? '', /temporary path through `\.\.`/);
  // The checkout may itself live below the scratch root (as in these tests): it and its ancestors are inputs.
  const own = buildManifest(parse([`10 openat(AT_FDCWD<${f.root}>, "${f.root}/src/a.ts", O_RDONLY) = 3<${f.root}/src/a.ts>`,
    `10 statx(AT_FDCWD<${f.root}>, "${tmpdir()}", AT_STATX_SYNC_AS_STAT|AT_SYMLINK_NOFOLLOW, STATX_ALL, {stx_mode=S_IFDIR|S_ISVTX|0777}) = 0`]), options);
  assert.equal(own.problems, undefined, own.problems?.join('\n'));
  assert(own.manifest.some(([n]) => n === tmpdir()), 'the scratch root is recorded like any directory');
  // A directory between the scratch root and a checkout below it is an ordinary input, not a temporary path.
  const above = buildManifest(parse(['10 statx(AT_FDCWD</tmp/base/repo>, "/tmp/base", AT_STATX_SYNC_AS_STAT|AT_SYMLINK_NOFOLLOW, STATX_ALL, {stx_mode=S_IFDIR|0755}) = 0']),
    { root: '/tmp/base/repo', outputRoots: ['/tmp/base/repo/dist'], scratchRoots: ['/tmp'] });
  assert.equal(above.problems, undefined, above.problems?.join('\n'));
  assert(above.manifest.some(([n]) => n === '/tmp/base'), 'a directory above the checkout is recorded like any directory');
  // Writing temporary files is allowed; writing next to the checkout is not.
  assert.equal(buildManifest(parse([`10 openat(AT_FDCWD<${f.root}>, "${scratch}/new", O_WRONLY|O_CREAT|O_TRUNC, 0644) = 3<${scratch}/new>`]), options).problems, undefined);
  assert.match(buildManifest(parse([`10 openat(AT_FDCWD<${f.root}>, "${f.root}/src/new", O_WRONLY|O_CREAT|O_TRUNC, 0644) = 3<${f.root}/src/new>`]), options).problems.join(), /wrote outside/);
});

test('a real strace: a temporary file the build made is allowed, a pre-existing one blocks the receipt', (t) => {
  const f = tree(t);
  // Its own scratch root: the fixture checkout itself lives in the system temporary directory.
  const scratch = mkdtempSync(join(tmpdir(), 'trace-scratch-'));
  t.after(() => rmSync(scratch, { recursive: true, force: true }));
  writeFileSync(join(scratch, 'pre-existing.json'), '{"flag":1}');
  const traced = (source, env = {}) => {
    f.put('build.mjs', source);
    const out = join(f.root, 'dist', 'trace.strace');
    const r = spawnSync('strace', ['-f', '-qq', '-s', '8192', '-y', '-e', 'trace=%file,getdents64,fchdir,connect', '-o', out, process.execPath, 'build.mjs'],
      { cwd: f.root, encoding: 'utf8', env: { ...process.env, NODE_V8_COVERAGE: '', ...env } });
    assert.equal(r.status, 0, r.stderr);
    const trace = parseTrace(readFileSync(out, 'utf8'), { scratchRoots: [scratch] });
    rmSync(out, { force: true });
    return { trace, ...buildManifest(trace, { root: f.root, outputRoots: f.outputRoots, scratchRoots: [scratch] }) };
  };
  const made = traced(`import fs from 'node:fs';import path from 'node:path';
const dir=fs.mkdtempSync(path.join(${JSON.stringify(scratch)},'job-'));fs.writeFileSync(path.join(dir,'part.js'),fs.readFileSync('src/a.ts'));
fs.readdirSync(dir);fs.writeFileSync('dist/out.js',fs.readFileSync(path.join(dir,'part.js')));fs.rmSync(dir,{recursive:true});`);
  assert.equal(made.problems, undefined, made.problems?.join('\n'));
  assert(made.manifest.some(([n]) => n === '@root/src/a.ts'));
  assert(!made.manifest.some(([n]) => n.startsWith(`${scratch}/`)));
  const stale = traced(`import fs from 'node:fs';fs.writeFileSync('dist/out.js',fs.readFileSync(${JSON.stringify(join(scratch, 'pre-existing.json'))}));`);
  assert.equal(stale.manifest, undefined);
  assert((stale.problems ?? []).includes(`build read a temporary path it did not create: ${join(scratch, 'pre-existing.json')}`), stale.problems?.join('\n'));
  // Node's compile cache in /tmp outlives the build and would be such a read; the build environment switches it off.
  const cached = traced(`import module from 'node:module';module.enableCompileCache?.();await import('./src/b.mjs');`, { NODE_DISABLE_COMPILE_CACHE: '1' });
  const touched = [...cached.trace.observed, ...cached.trace.written, ...cached.trace.listed];
  assert(!touched.some((p) => p.includes('node-compile-cache')), touched.filter((p) => p.includes('compile')).join());
});

test('a read is ordered by when it started: a file replaced while it was being opened was the old one', () => {
  for (const [label, replace] of [['renamed into place', ['10 openat(AT_FDCWD</r>, "/tmp/c.tmp", O_RDWR|O_CREAT|O_EXCL, 0600) = 3</tmp/c.tmp>', '10 rename("/tmp/c.tmp", "/tmp/c") = 0']],
    ['removed and created again', ['10 unlink("/tmp/c") = 0', '10 openat(AT_FDCWD</r>, "/tmp/c", O_WRONLY|O_CREAT|O_EXCL, 0600) = 3</tmp/c>']]]) {
    const result = scratchBuild(['11 openat(AT_FDCWD</r>, "/tmp/c", O_RDONLY <unfinished ...>', ...replace, '11 <... openat resumed>) = 4</tmp/c (deleted)>']);
    assert(refusedTemp(result, '/tmp/c'), `${label}\n${result.problems?.join('\n')}`);
  }
  // A process that exited inside the call still started the lookup before the file existed.
  const exited = scratchBuild(['11 openat(AT_FDCWD</r>, "/tmp/c", O_RDONLY <unfinished ...>', '10 openat(AT_FDCWD</r>, "/tmp/c", O_WRONLY|O_CREAT|O_EXCL, 0600) = 3</tmp/c>']);
  assert(refusedTemp(exited, '/tmp/c'), exited.problems?.join('\n'));
  // A create is ordered by its return, so a read that started before the create returned is refused.
  const overlapping = scratchBuild(['10 openat(AT_FDCWD</r>, "/tmp/c", O_WRONLY|O_CREAT|O_EXCL, 0600 <unfinished ...>', '11 openat(AT_FDCWD</r>, "/tmp/c", O_RDONLY) = 4</tmp/c>',
    '10 <... openat resumed>) = 3</tmp/c>']);
  assert(refusedTemp(overlapping, '/tmp/c'), 'a read that starts before the create returned');
});

test('a read is checked where it really landed: /proc and links in the outputs cannot hide a temporary file', () => {
  for (const lines of [['10 openat(AT_FDCWD</r>, "/proc/self/root/tmp/pre.json", O_RDONLY) = 3</tmp/pre.json>'],
    ['10 openat(AT_FDCWD</r>, "/proc/self/fd/9", O_RDONLY) = 3</tmp/pre.json>'],
    ['10 openat(AT_FDCWD</r>, "/r/dist/l", O_RDONLY) = 3</tmp/pre.json>']]) {
    assert(refusedTemp(scratchBuild(lines), '/tmp/pre.json'), lines.join('\n'));
  }
  // /proc/<pid>/root, cwd and fd name any file under another name, so they are refused outright.
  for (const path of ['/proc/self/root/r/src/a.ts', '/proc/42/cwd/src/a.ts', '/proc/self/fd/9']) {
    assert.match(scratchBuild([`10 statx(AT_FDCWD</r>, "${path}", AT_STATX_SYNC_AS_STAT, STATX_ALL, {stx_mode=S_IFREG|0644}) = 0`]).problems.join(), /through \/proc/, path);
  }
  assert.equal(scratchBuild(['10 openat(AT_FDCWD</r>, "/proc/self/maps", O_RDONLY) = 3</proc/1/maps>']).problems, undefined, 'other /proc files are fine');
  // Reads under output roots are not recorded, so a link there may only point within the outputs.
  for (const target of ['/tmp/pre.json', '../src/a.ts', 'assets/../../src/a.ts']) {
    assert.match(scratchBuild([`10 symlink("${target}", "/r/dist/l") = 0`]).problems.join(), /linked an output/, target);
  }
  assert.equal(scratchBuild(['10 symlink("assets/a.js", "/r/dist/l") = 0']).problems, undefined, 'a link within the outputs is fine');
});

test('ordinary temporary-file patterns keep the receipt', () => {
  const cases = {
    'an anonymous O_TMPFILE file': ['10 openat(AT_FDCWD</r>, "/tmp", O_RDWR|O_EXCL|O_TMPFILE, 0600) = 3</tmp/#123 (deleted)>'],
    'mkdir -p reaching the scratch root': ['10 mkdir("/tmp", 0777) = -1 EEXIST (File exists)', '10 mkdir("/tmp/w", 0777) = 0', '10 openat(AT_FDCWD</r>, "/tmp/w/a", O_RDONLY) = -1 ENOENT (No such file or directory)'],
    'a name the build removed and wrote again inside its own directory': ['10 mkdir("/tmp/w", 0700) = 0', '10 openat(AT_FDCWD</r>, "/tmp/w/a", O_WRONLY|O_CREAT|O_EXCL, 0644) = 3</tmp/w/a>',
      '10 unlink("/tmp/w/a") = 0', '10 openat(AT_FDCWD</r>, "/tmp/w/a", O_WRONLY|O_CREAT, 0644) = 3</tmp/w/a>', '10 openat(AT_FDCWD</r>, "/tmp/w/a", O_RDONLY) = 3</tmp/w/a>'],
    'a directory the build made, renamed with its contents': ['10 mkdir("/tmp/w", 0700) = 0', '10 openat(AT_FDCWD</r>, "/tmp/w/a", O_WRONLY|O_CREAT|O_EXCL, 0644) = 3</tmp/w/a>',
      '10 rename("/tmp/w", "/tmp/v") = 0', '10 openat(AT_FDCWD</r>, "/tmp/v/a", O_RDONLY) = 3</tmp/v/a>'],
  };
  for (const [label, lines] of Object.entries(cases)) assert.equal(scratchBuild(lines).problems, undefined, `${label}\n${scratchBuild(lines).problems?.join('\n')}`);
  // The same patterns with something the build did not make stay refused.
  assert(refusedTemp(scratchBuild(['10 statx(3</tmp/t (deleted)>, "", AT_STATX_SYNC_AS_STAT|AT_EMPTY_PATH, STATX_ALL, {stx_mode=S_IFREG|0600}) = 0']), '/tmp/t (deleted)'));
  assert(refusedTemp(scratchBuild(['10 openat(AT_FDCWD</r>, "/tmp/w/a", O_WRONLY|O_CREAT, 0644) = 3</tmp/w/a>', '10 openat(AT_FDCWD</r>, "/tmp/w/a", O_RDONLY) = 3</tmp/w/a>']), '/tmp/w/a'));
  // A tainted file inside a renamed directory stays tainted under its new name.
  assert(refusedTemp(scratchBuild(['10 mkdir("/tmp/w", 0700) = 0', '10 symlink("/r/src/a.ts", "/tmp/w/a") = 0', '10 rename("/tmp/w", "/tmp/v") = 0',
    '10 openat(AT_FDCWD</r>, "/tmp/v/a", O_RDONLY) = 3</r/src/a.ts>']), '/tmp/v/a'));
});

test('a read that runs at the same time as a change to its path is refused, whichever side it saw', () => {
  const cases = {
    'a rename over a file the build made': ['10 openat(AT_FDCWD</r>, "/tmp/a", O_WRONLY|O_CREAT|O_EXCL, 0644) = 3</tmp/a>', '12 rename("/tmp/pre", "/tmp/a" <unfinished ...>',
      '11 openat(AT_FDCWD</r>, "/tmp/a", O_RDONLY) = 4</tmp/a>', '12 <... rename resumed>) = 0'],
    'an exchange': ['10 openat(AT_FDCWD</r>, "/tmp/a", O_WRONLY|O_CREAT|O_EXCL, 0644) = 3</tmp/a>', '12 renameat2(AT_FDCWD</r>, "/tmp/pre", AT_FDCWD</r>, "/tmp/a", RENAME_EXCHANGE <unfinished ...>',
      '11 openat(AT_FDCWD</r>, "/tmp/a", O_RDONLY) = 4</tmp/a>', '12 <... renameat2 resumed>) = 0'],
    'a rename of the directory above it': ['10 mkdir("/tmp/w", 0700) = 0', '10 openat(AT_FDCWD</r>, "/tmp/w/a", O_WRONLY|O_CREAT|O_EXCL, 0644) = 3</tmp/w/a>',
      '12 rename("/tmp/pre", "/tmp/w" <unfinished ...>', '11 openat(AT_FDCWD</r>, "/tmp/w/a", O_RDONLY) = 4</tmp/w/a>', '12 <... rename resumed>) = 0'],
  };
  for (const [label, lines] of Object.entries(cases)) assert.equal(scratchBuild(lines).manifest, undefined, label);
  // The same read after the change has returned is judged by the result of the change.
  assert(refusedTemp(scratchBuild(['10 openat(AT_FDCWD</r>, "/tmp/a", O_WRONLY|O_CREAT|O_EXCL, 0644) = 3</tmp/a>', '12 rename("/tmp/pre", "/tmp/a") = 0',
    '11 openat(AT_FDCWD</r>, "/tmp/a", O_RDONLY) = 4</tmp/a>']), '/tmp/a'));
});

test('exec, /proc/<pid>/task, /dev/fd and moves into the outputs cannot reach a temporary file unrecorded', () => {
  assert.match(scratchBuild(['10 execve("/proc/self/task/10/root/tmp/pre.sh", ["x"], 0x1 /* 3 vars */) = 0']).problems.join(), /through \/proc/);
  assert.match(scratchBuild(['10 execve("/dev/fd/9", ["x"], 0x1 /* 3 vars */) = 0']).problems.join(), /inherited fd/);
  assert.match(scratchBuild(['10 symlink("/tmp/pre.sh", "/tmp/s") = 0', '10 rename("/tmp/s", "/r/dist/run") = 0',
    '10 execve("/r/dist/run", ["run"], 0x1 /* 3 vars */) = 0']).problems.join(), /moved something into its outputs/);
  assert.match(scratchBuild(['10 link("/r/src/a.ts", "/r/dist/a.ts") = 0']).problems.join(), /moved something into its outputs/);
  assert.equal(scratchBuild(['10 rename("/r/dist/a.tmp", "/r/dist/a.js") = 0']).problems, undefined, 'moves within the outputs are fine');
  // An inherited fd on a file the build never opened stays refused after an unlink.
  assert(refusedTemp(scratchBuild(['10 unlink("/tmp/pre") = 0', '10 statx(9</tmp/pre (deleted)>, "", AT_STATX_SYNC_AS_STAT|AT_EMPTY_PATH, STATX_ALL, {stx_mode=S_IFREG|0644}) = 0']), '/tmp/pre (deleted)'));
  assert(refusedTemp(scratchBuild(['10 rmdir("/tmp/d") = 0', '10 getdents64(9</tmp/d (deleted)>, 0x1 /* 2 entries */, 32768) = 48']), '/tmp/d (deleted)'));
  // An fd on an unlinked file is refused even after the build made and removed a file of that name, because strace
  // never shows which file an inherited fd was opened on.
  assert(refusedTemp(scratchBuild(['10 unlink("/tmp/x") = 0', '10 openat(AT_FDCWD</r>, "/tmp/x", O_WRONLY|O_CREAT|O_EXCL, 0600) = 3</tmp/x>',
    '10 unlink("/tmp/x") = 0', '10 statx(9</tmp/x (deleted)>, "", AT_STATX_SYNC_AS_STAT|AT_EMPTY_PATH, STATX_ALL, {stx_mode=S_IFREG|0600}) = 0']), '/tmp/x (deleted)'));
  assert(refusedTemp(scratchBuild(['10 openat(AT_FDCWD</r>, "/tmp/t", O_RDWR|O_CREAT|O_EXCL, 0600) = 3</tmp/t>', '10 unlink("/tmp/t") = 0',
    '10 statx(3</tmp/t (deleted)>, "", AT_STATX_SYNC_AS_STAT|AT_EMPTY_PATH, STATX_ALL, {stx_mode=S_IFREG|0600}) = 0']), '/tmp/t (deleted)'));
});

test('an O_TMPFILE file and a hard link to the build\'s own file keep the receipt', () => {
  const anonymous = scratchBuild(['10 openat(AT_FDCWD</r>, "/tmp", O_RDWR|O_EXCL|O_TMPFILE, 0600) = 3</tmp/#123 (deleted)>',
    '10 newfstatat(3</tmp/#123 (deleted)>, "", {st_mode=S_IFREG|0600, st_size=0, ...}, AT_EMPTY_PATH) = 0',
    '10 linkat(3</tmp/#123 (deleted)>, "", AT_FDCWD</r>, "/tmp/named", AT_EMPTY_PATH) = 0', '10 openat(AT_FDCWD</r>, "/tmp/named", O_RDONLY) = 4</tmp/named>']);
  assert.equal(anonymous.problems, undefined, anonymous.problems?.join('\n'));
  // The anonymous file's label is not a path: a real file with that name is pre-existing, and so is a link made from it.
  const label = '10 openat(AT_FDCWD</r>, "/tmp", O_RDWR|O_EXCL|O_TMPFILE, 0600) = 3</tmp/#123 (deleted)>';
  assert(refusedTemp(scratchBuild([label, '10 openat(AT_FDCWD</r>, "/tmp/#123", O_RDONLY) = 4</tmp/#123>']), '/tmp/#123'));
  assert(refusedTemp(scratchBuild([label, '10 link("/tmp/#123", "/tmp/named") = 0', '10 openat(AT_FDCWD</r>, "/tmp/named", O_RDONLY) = 4</tmp/named>']), '/tmp/named'));
  const linked = scratchBuild(['10 openat(AT_FDCWD</r>, "/tmp/a", O_WRONLY|O_CREAT|O_EXCL, 0644) = 3</tmp/a>', '10 link("/tmp/a", "/tmp/b") = 0', '10 openat(AT_FDCWD</r>, "/tmp/b", O_RDONLY) = 4</tmp/b>']);
  assert.equal(linked.problems, undefined, linked.problems?.join('\n'));
});
