// #1837 smart builds: what a build actually depended on, observed rather than declared.
//
// The producer runs the unchanged `pnpm ci:build` under `strace -f`. Every path the build process tree opened,
// stat'ed, probed (including lookups that FAILED, so a later-added file is noticed), listed, executed or
// resolved through is an input. The manifest records the state of each such path after the build: file bytes
// and mode, directory listings, symlink targets, absence. A consumer may reuse the producer's output only when
// every manifest entry is identical in its own checkout and its build environment digest is equal. Anything
// the parser does not fully understand, any write outside the build's own scratch/output roots, and any
// connection that could have been answered make the trace UNUSABLE: the producer then publishes nothing and nobody can reuse it.
//
// Temporary files (/tmp): the build may write them, but a read of one, or any call whose success shows what was there
// (a non-exclusive create, a write-only open, an unlink, a chmod), is allowed only when the trace proves, in order,
// that the build itself created it from nothing first (scratchVerdicts); any other read of a temporary path
// makes the trace unusable, because its pre-build content is not recorded and could differ on another runner.
// The build's TMPDIR is a directory made empty and private just before it starts (ci-smart-build), so everything in
// it is the build's own. Node's compile cache, which vite turns on, is disabled for the build (buildEnvironment).
//
// /proc, /sys and /dev are not recorded. The build may only read /proc and /sys, and may use only known character
// devices under /dev: /dev/shm and /dev/mqueue are writable directories whose files, links or aliases would
// otherwise be read unrecorded, so any use of them makes the trace unusable, as does an input link into them.
//
// Scope note: mtimes are not recorded (a fresh checkout changes them all). The build's caches that key on
// mtime are deleted before every build. Processes outside the traced build are trusted not to change the checkout
// or the build's own temporary files while it runs, as for every other input. The kernel opens a script's `#!`
// interpreter and a binary's ELF loader without a system call, so strace does not show them; an interpreter that
// then runs code by path (as `env` and `node` do) is traced from there on, but the interpreter or loader file itself
// is not recorded, in /tmp or anywhere else.
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync, readlinkSync, realpathSync } from 'node:fs';
import { posix } from 'node:path';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const WRITE_FLAGS = /\b(O_WRONLY|O_RDWR|O_CREAT|O_TRUNC|O_APPEND|O_TMPFILE)\b/;
// [syscall]: which arguments are paths, as [dirfdIndex|null, pathIndex, kind]. kind: 'observe' | 'write'.
const PATH_ARGS = {
  open: [[null, 0, 'open']], creat: [[null, 0, 'write']], openat: [[0, 1, 'open']], openat2: [[0, 1, 'open']],
  access: [[null, 0, 'observe']], faccessat: [[0, 1, 'observe']], faccessat2: [[0, 1, 'observe']],
  stat: [[null, 0, 'observe']], lstat: [[null, 0, 'observe']], newfstatat: [[0, 1, 'observe']], fstatat64: [[0, 1, 'observe']],
  statx: [[0, 1, 'observe']], readlink: [[null, 0, 'observe']], readlinkat: [[0, 1, 'observe']],
  execve: [[null, 0, 'observe']], execveat: [[0, 1, 'observe']], chdir: [[null, 0, 'observe']],
  getxattr: [[null, 0, 'observe']], lgetxattr: [[null, 0, 'observe']], listxattr: [[null, 0, 'observe']],
  llistxattr: [[null, 0, 'observe']], statfs: [[null, 0, 'observe']], inotify_add_watch: [[null, 1, 'observe']],
  mkdir: [[null, 0, 'write']], mkdirat: [[0, 1, 'write']], unlink: [[null, 0, 'write']], unlinkat: [[0, 1, 'write']],
  rmdir: [[null, 0, 'write']], rename: [[null, 0, 'write'], [null, 1, 'write']],
  renameat: [[0, 1, 'write'], [2, 3, 'write']], renameat2: [[0, 1, 'write'], [2, 3, 'write']],
  link: [[null, 0, 'observe'], [null, 1, 'write']], linkat: [[0, 1, 'observe'], [2, 3, 'write']],
  symlink: [[null, 1, 'write']], symlinkat: [[1, 2, 'write']], chmod: [[null, 0, 'write']], fchmodat: [[0, 1, 'write']],
  fchmodat2: [[0, 1, 'write']], chown: [[null, 0, 'write']], lchown: [[null, 0, 'write']], fchownat: [[0, 1, 'write']],
  utime: [[null, 0, 'write']], utimes: [[null, 0, 'write']], utimensat: [[0, 1, 'write']], futimesat: [[0, 1, 'write']],
  truncate: [[null, 0, 'write']], mknod: [[null, 0, 'write']], mknodat: [[0, 1, 'write']],
  setxattr: [[null, 0, 'write']], lsetxattr: [[null, 0, 'write']], removexattr: [[null, 0, 'write']], lremovexattr: [[null, 0, 'write']],
};
const NO_PATH = new Set(['getcwd', 'fchdir', 'getdents64', 'connect']);

// Split one complete strace line `name(args) = result` into raw top-level arguments and the result text.
export function splitCall(line) {
  const name = /^([a-z0-9_]+)\(/.exec(line)?.[1];
  if (!name) return null;
  const args = []; let i = name.length + 1, start = i, depth = 0;
  for (; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { for (i++; i < line.length && line[i] !== '"'; i++) if (line[i] === '\\') i++; continue; }
    if (c === '<' && /(?:AT_FDCWD|\d)$/.test(line.slice(start, i))) {
      // An fd decoration from -y: `AT_FDCWD</cwd>` or `7</a/dir>`. It ends at '>' followed by a delimiter.
      const end = line.slice(i).search(/>(?=[,)\s]|$)/);
      if (end < 0) return null;
      i += end; continue;
    }
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) {
      if (depth === 0 && c === ')') { args.push(line.slice(start, i).trim()); return { name, args: args[0] === '' && args.length === 1 ? [] : args, result: line.slice(i + 1).trim() }; }
      depth--;
    } else if (c === ',' && depth === 0) { args.push(line.slice(start, i).trim()); start = i + 1; }
  }
  return null;
}

// strace escapes are BYTES (a UTF-8 name such as caf\303\251.js arrives as two escaped bytes), so the string is
// rebuilt as bytes and decoded as UTF-8; a name that is not valid UTF-8 cannot be represented and fails closed.
const UTF8 = new TextDecoder('utf-8', { fatal: true });
export function decodeString(arg) {
  if (typeof arg !== 'string' || !arg.startsWith('"')) return null;
  const bytes = []; let i = 1;
  const push = (text) => bytes.push(...Buffer.from(text, 'utf8'));
  for (; i < arg.length && arg[i] !== '"'; i++) {
    if (arg[i] !== '\\') { push(arg[i]); continue; }
    const e = arg[++i];
    const simple = { n: '\n', t: '\t', r: '\r', v: '\v', f: '\f', '\\': '\\', '"': '"' }[e];
    if (simple !== undefined) push(simple);
    else if (e === 'x') {
      const hex = /^[0-9a-fA-F]{2}/.exec(arg.slice(i + 1))?.[0];
      if (!hex) throw Error('TRACE_BAD_ESCAPE');
      bytes.push(parseInt(hex, 16)); i += 2;
    } else if (/[0-7]/.test(e)) {
      const oct = /^[0-7]{1,3}/.exec(arg.slice(i))[0], value = parseInt(oct, 8);
      if (value > 255) throw Error('TRACE_BAD_ESCAPE');
      bytes.push(value); i += oct.length - 1;
    } else throw Error(`TRACE_UNKNOWN_ESCAPE \\${e}`);
  }
  if (arg[i] !== '"' || arg.slice(i + 1) !== '') throw Error('TRACE_TRUNCATED_STRING');
  try { return UTF8.decode(Uint8Array.from(bytes)); } catch { throw Error('TRACE_PATH_NOT_UTF8'); }
}

// strace -y escapes unusual bytes in a decoration too; such a path cannot be read back faithfully, so it counts as
// undecorated and every use of it fails closed.
const decoration = (arg) => {
  const path = /^(?:AT_FDCWD|\d+)<(.*)>$/s.exec(arg ?? '')?.[1] ?? null;
  return path !== null && /^[\x20-\x7e]*$/.test(path) && !path.includes('\\') ? path : null;
};

// The fd a successful open returned, as the kernel resolved it (strace -y): `= 3</tmp/x>`.
const returnedPath = (result) => decoration(/^= (\d+<.*>)$/s.exec(result ?? '')?.[1]);

/**
 * Parse `strace -f -qq -y -s <large> -e trace=%file,getdents64,fchdir,connect` output.
 * Returns absolute observed/listed/written paths and every reason the trace cannot be trusted. For paths under
 * `scratchRoots` it also returns `events`, in trace order, so a reader of temporary files can be checked against
 * what the build itself created there (scratchVerdicts).
 */
export function parseTrace(text, { scratchRoots = ['/tmp'] } = {}) {
  const problems = [], calls = [], pending = new Map();
  // Each call keeps the line where it was entered and the line where it returned: a lookup happens somewhere in
  // between, so a read is ordered by its entry and a change by its return (scratchVerdicts).
  let line = -1;
  for (const raw of text.split('\n')) {
    line++;
    if (!raw) continue;
    const m = /^(\d+) +(.*)$/.exec(raw);
    if (!m) { problems.push(`unparsed line: ${raw.slice(0, 120)}`); continue; }
    const [, pid, rest] = m;
    if (rest.startsWith('+++ ') || rest.startsWith('--- ')) continue;
    if (rest.endsWith(' <unfinished ...>')) {
      if (pending.has(pid)) problems.push(`nested unfinished call in ${pid}`);
      pending.set(pid, { head: rest.slice(0, -' <unfinished ...>'.length), entry: line });
      continue;
    }
    const resumed = /^<\.\.\. ([a-z0-9_]+) resumed>(.*)$/.exec(rest);
    if (resumed) {
      const open = pending.get(pid);
      if (open === undefined || !open.head.startsWith(`${resumed[1]}(`)) { problems.push(`orphan resume in ${pid}`); continue; }
      pending.delete(pid);
      calls.push({ pid, line: open.head + resumed[2], entry: open.entry, exit: line });
    } else calls.push({ pid, line: rest, entry: line, exit: line });
  }
  // A process that exited inside a call still asked for the path: keep the request, result unknown.
  for (const [pid, { head, entry }] of pending) calls.push({ pid, line: `${head}) = ?`, entry, exit: Infinity });

  // Relative paths outside *at calls resolve against the caller's cwd. strace -y decorates AT_FDCWD with
  // that cwd, so a (pid, chdir-epoch) whose decorations all agree gives the cwd; disagreement fails closed.
  const parsed = [], epoch = new Map(), cwd = new Map();
  for (const { pid, line: text, entry, exit } of calls) {
    const call = splitCall(text);
    if (!call) { problems.push(`unparsed call: ${text.slice(0, 120)}`); continue; }
    const e = epoch.get(pid) ?? 0, key = `${pid}:${e}`;
    for (const arg of call.args) {
      if (!arg.startsWith('AT_FDCWD<')) continue;
      const dir = decoration(arg);
      if (dir === null) { problems.push(`TRACE_UNDECORATED_FD cwd in ${pid}`); continue; }
      if (cwd.has(key) && cwd.get(key) !== dir) problems.push(`cwd changed without chdir in ${pid}`);
      cwd.set(key, dir);
    }
    parsed.push({ pid, key, call, entry, exit });
    if ((call.name === 'chdir' || call.name === 'fchdir') && !/= -1/.test(call.result)) epoch.set(pid, e + 1);
  }

  const observed = new Set(), listed = new Set(), written = new Set(), network = [], dotdot = [], events = [], links = [], moves = [];
  const inScratch = (path) => under(path, scratchRoots);
  let at = { entry: 0, exit: 0 };
  const event = (op, path, extra = {}) => {
    if (inScratch(path) || (extra.to && inScratch(extra.to))) {
      events.push({ op, path, ...extra, seq: op === 'observe' ? at.entry : at.exit, entry: at.entry, exit: at.exit });
    }
  };
  // A path named through an already-open fd that has since been unlinked: `<5</tmp/x (deleted)>`.
  const viaFd = (path) => (path.endsWith(' (deleted)') ? { fdOf: path.slice(0, -' (deleted)'.length) } : {});
  const resolve = (dirfdArg, path, key) => {
    if (path.startsWith('/')) return posix.normalize(path);
    const base = dirfdArg === null ? cwd.get(key) : decoration(dirfdArg);
    if (!base || !base.startsWith('/')) throw Error('TRACE_UNRESOLVED_RELATIVE_PATH');
    return posix.normalize(posix.join(base, path));
  };
  for (const { pid, key, call, entry, exit } of parsed) {
    const { name, args } = call;
    at = { entry, exit };
    try {
      if (name === 'getdents64') {
        const dir = decoration(args[0]);
        if (!dir?.startsWith('/')) throw Error('TRACE_UNDECORATED_FD');
        listed.add(posix.normalize(dir)); event('observe', posix.normalize(dir), { ok: true, ...viaFd(dir) });
        continue;
      }
      if (name === 'connect') {
        // A local socket path that does not exist answers nothing: glibc probes the nscd socket this way before
        // falling back to files (/etc/passwd, /etc/hosts) that are themselves traced. That probe is an
        // observation of an absent path, so a later runner where the socket exists rebuilds. Any connection that
        // could have been answered (inet, abstract, or an existing socket) is network use and fails closed.
        const unix = /^\{sa_family=AF_UNIX, sun_path=("(?:[^"\\]|\\.)*")\}$/.exec(args[1] ?? '');
        if (unix && /^= -1 ENOENT\b/.test(call.result)) {
          const socketPath = decodeString(unix[1]);
          if (!socketPath?.startsWith('/')) throw Error('TRACE_UNRESOLVED_RELATIVE_PATH');
          observed.add(posix.normalize(socketPath)); event('observe', posix.normalize(socketPath), { ok: false });
          continue;
        }
        network.push(`${pid}: ${args[1]?.slice(0, 80)} ${call.result.slice(0, 40)}`);
        continue;
      }
      if (NO_PATH.has(name)) continue;
      const spec = PATH_ARGS[name];
      if (!spec) throw Error(`TRACE_UNCLASSIFIED_SYSCALL ${name}`);
      const touched = [];
      for (const [fdIndex, pathIndex, kind] of spec) {
        const rawPath = args[pathIndex];
        let path, unnormalized = null, fd = {};
        if (rawPath === 'NULL' || (rawPath === '""' && /AT_EMPTY_PATH/.test(args.join(',')))) {
          path = decoration(args[fdIndex ?? -1]);
          if (!path?.startsWith('/')) throw Error('TRACE_UNDECORATED_FD');
          path = posix.normalize(path); fd = viaFd(path);
        } else {
          const text = decodeString(rawPath);
          if (text === null || text === '') throw Error(`TRACE_PATH_ARGUMENT ${name}`);
          path = resolve(fdIndex === null ? null : args[fdIndex], text, key);
          // A lexically removed `..` is only valid when what precedes it is a real directory: record it.
          if (text.split('/').includes('..')) {
            unnormalized = text.startsWith('/') ? text : `${fdIndex === null ? cwd.get(key) : decoration(args[fdIndex])}/${text}`;
            const parts = unnormalized.split('/');
            parts.forEach((part, index) => { if (part === '..' && index > 0) observed.add(posix.normalize(parts.slice(0, index).join('/') || '/')); });
          }
        }
        let effective = kind, flags = '';
        if (kind === 'open') {
          flags = name === 'openat2' ? (/flags=([A-Z0-9_|]+)/.exec(args[2] ?? '')?.[1] ?? '') : (args[fdIndex === null ? 1 : 2] ?? '');
          effective = WRITE_FLAGS.test(flags) ? 'write' : 'observe';
        }
        (effective === 'write' ? written : observed).add(path);
        // The kernel resolves a symlink before the `..` that follows it, so `link/../x` may name a file other than
        // the lexical `x`. The manifest resolves these the kernel's way (resolveLikeKernel) as well.
        if (unnormalized) dotdot.push({ path: unnormalized, write: effective === 'write' });
        touched.push({ path, kind, effective, flags, fd });
      }
      recordScratchEvents(name, args, call.result, touched, event);
      const ok = /^= (?!-1\b|\?)/.test(call.result);
      // Where a read really landed (strace -y): through a symlink, /proc/self/root or /proc/self/fd it can be a
      // file the requested name does not show. That file is read too.
      const landed = ['open', 'openat', 'openat2', 'creat'].includes(name) && ok ? returnedPath(call.result) : null;
      const [first] = touched;
      // A write lands there too: it is checked against the output roots where it really went. The landed file is
      // observed whatever the mode, since an fd on it shows its size and mode through calls strace does not trace.
      if (landed?.startsWith('/') && posix.normalize(landed) !== first.path && !/\bO_TMPFILE\b/.test(first.flags)) {
        if (first.effective === 'write') written.add(posix.normalize(landed));
        observed.add(posix.normalize(landed)); event('observe', posix.normalize(landed), { ok: true });
      }
      if ((name === 'symlink' || name === 'symlinkat') && ok) links.push({ target: decodeString(args[0]), path: touched[0].path });
      if (['rename', 'renameat', 'renameat2', 'link', 'linkat'].includes(name) && ok) moves.push({ from: touched[0].path, to: touched[1].path });
      // An anonymous O_TMPFILE file is the build's own from the start: `= 3</tmp/#123 (deleted)>`. Its name is only
      // strace's label for the fd, so it is reachable through that fd alone and never as an ordinary path.
      if (landed && /\bO_TMPFILE\b/.test(first.flags)) { const anon = viaFd(landed).fdOf; if (anon) event('anon', anon); }
    } catch (error) { problems.push(`${error.message}: ${call.name}(${call.args.slice(0, 3).join(', ').slice(0, 160)})`); }
  }
  return { observed, listed, written, network, dotdot, events: events.sort((a, b) => a.seq - b.seq), links, moves, problems };
}

// What one call did to temporary paths, for scratchVerdicts. Only a call that provably started a path from nothing
// is a `create`: an exclusive create whose returned fd resolves to exactly the requested path (so no pre-existing
// symlink anywhere on the way was followed), or a successful mkdir. A truncating open (creat() included) is not: it
// empties the old content but keeps the old file's mode, owner and links, which a later stat would read.
function recordScratchEvents(name, args, result, touched, event) {
  const ok = /^= (?!-1\b|\?)/.test(result ?? '');
  const [first, second] = touched;
  if (!first) return;
  if (['open', 'openat', 'openat2', 'creat'].includes(name)) {
    const { path, effective, flags } = first;
    if (effective !== 'write') return event('observe', path, { ok, ...first.fd });
    // A failed create or write still found out whether the path was there, which the build can act on.
    if (!ok) return event('observe', path, { ok });
    if (/\bO_CREAT\b/.test(flags) && /\bO_EXCL\b/.test(flags) && returnedPath(result) === path) return event('create', path);
    // Every other successful open is an observation too. One that is not write-only can read what is there
    // (O_RDONLY|O_CREAT and O_RDONLY|O_APPEND included); one without O_CREAT succeeds only on an existing path; and a
    // non-exclusive create either made the file or opened the one already there, which strace cannot tell apart,
    // while its fd shows the old file's size and mode through fstat and lseek, which are not traced.
    event('observe', path, { ok, creates: name === 'creat' || /\bO_CREAT\b/.test(flags) });
    return event(name === 'creat' || /\bO_CREAT\b/.test(flags) ? 'create-in-place' : 'write', path);
  }
  if (name === 'mkdir' || name === 'mkdirat') return event(ok ? 'mkdir' : 'observe', first.path, { ok });
  // From here on, a call that succeeded on an existing path also found out that it was there (and, for rmdir, that it
  // was empty), so it is an observation as well as a change.
  if (['unlink', 'unlinkat', 'rmdir'].includes(name)) { event('observe', first.path, { ok }); return ok ? event('remove', first.path) : undefined; }
  if (['rename', 'renameat', 'renameat2'].includes(name)) {
    if (!ok) { event('observe', first.path, { ok }); return event('observe', second.path, { ok }); }
    event('observe', first.path, { ok });
    if (/\bRENAME_EXCHANGE\b/.test(args.join(','))) { event('taint', first.path); return event('taint', second.path); }
    return event('rename', first.path, { to: second.path });
  }
  // A hard link names the same file under a second name: the build's own only if the source was.
  if (name === 'link' || name === 'linkat') {
    const source = touched.find((t) => t.kind === 'observe'), destination = touched.find((t) => t.kind === 'write');
    event('observe', source.path, { ok, ...source.fd });
    return ok ? event('link', source.fd.fdOf ?? source.path, { to: destination.path, fromFd: Boolean(source.fd.fdOf) })
      : event('observe', destination.path, { ok });
  }
  // A symlink makes the destination name something whose content the build did not write there.
  if (name === 'symlink' || name === 'symlinkat') return event(ok ? 'taint' : 'observe', first.path, { ok });
  for (const t of touched) {
    // chmod, chown, utime, truncate and xattr changes need the path to exist; mknod creates it, as a create does.
    if (t.effective === 'write' && ok && name !== 'mknod' && name !== 'mknodat') event('observe', t.path, { ok, ...t.fd });
    event(t.effective === 'write' && ok ? 'write' : 'observe', t.path, { ok, ...t.fd });
  }
}

/**
 * Replay temporary-path events in trace order. A read (open, stat, probe, listing, exec) of a temporary path is
 * allowed only when the build itself created that path, or a directory above it, from nothing before the read,
 * and nothing since replaced it with a link or with something the build did not create; or, for a lookup that
 * failed, when the build itself removed the path first. Every other read of a temporary path is a pre-existing
 * input that the manifest cannot record faithfully, so it makes the trace unusable.
 */
export function scratchVerdicts(events, isScratch, freshRoots = []) {
  const state = new Map(), verified = new Set(), refused = new Set();
  // A directory made empty and private for this build before it started (its TMPDIR): all it holds is the build's.
  for (const fresh of freshRoots) state.set(fresh, 'create');
  const clearUnder = (path) => { for (const key of [...state.keys()]) if (key.startsWith(`${path}/`)) state.delete(key); };
  const status = (path) => {
    for (let p = path; isScratch(p); p = posix.dirname(p)) if (state.has(p)) return state.get(p);
    return 'unknown';
  };
  for (const e of events) {
    const { op, path } = e;
    if (op === 'link') {
      const own = isScratch(path) && (status(path) === 'create' || (e.fromFd && state.get(path) === 'anon'));
      if (isScratch(e.to)) { clearUnder(e.to); state.set(e.to, own ? 'create' : 'taint'); }
      continue;
    }
    if (op === 'rename') {
      const from = path, to = e.to, moved = isScratch(from) ? status(from) : 'taint';
      if (isScratch(to)) {
        const subtree = isScratch(from) ? [...state].filter(([key]) => key.startsWith(`${from}/`)) : [];
        clearUnder(to);
        for (const [key, value] of subtree) state.set(`${to}${key.slice(from.length)}`, value);
        state.set(to, moved === 'create' ? 'create' : 'taint');
      }
      if (isScratch(from)) { clearUnder(from); state.set(from, 'remove'); }
      continue;
    }
    if (!isScratch(path)) continue;
    const parent = posix.dirname(path);
    if (op === 'observe') {
      // Through an fd on an unlinked file. Only the build's own anonymous O_TMPFILE file passes: any other such fd may
      // have been inherited from outside the build, and strace never shows which file it was opened on.
      if (e.fdOf) { (state.get(e.fdOf) === 'anon' ? verified : refused).add(path); continue; }
      // A create where the build removed the old name inside a directory it made cannot have opened anything else.
      const s = status(path), freshName = s === 'remove' && (!e.ok || (e.creates && status(parent) === 'create'));
      (s === 'create' || freshName ? verified : refused).add(path);
    } else if (op === 'create') { clearUnder(path); state.set(path, 'create'); }
    else if (op === 'anon') { clearUnder(path); state.set(path, 'anon'); }
    else if (op === 'mkdir') {
      // mkdir does not report where it landed, so it proves a fresh directory only below a directory that cannot
      // be a planted symlink: the scratch root itself (recorded as an input) or a directory the build created.
      clearUnder(path); state.set(path, !isScratch(parent) || status(parent) === 'create' ? 'create' : 'taint');
    } else if (op === 'create-in-place') {
      // A non-exclusive create is fresh only where the build removed the old name inside a directory it created.
      if (state.get(path) === 'remove' && status(parent) === 'create') state.set(path, 'create');
    } else if (op === 'remove') {
      clearUnder(path); state.set(path, 'remove');
    }
    else if (op === 'taint') { clearUnder(path); state.set(path, 'taint'); }
  }
  // Ordering a read by its start and a change by its return is exact only when the two did not run at the same
  // time. A read that overlaps any change to the same path, a directory above it or a path below it may have seen
  // either side of that change, so it is refused.
  // Inside the build's fresh TMPDIR, a create or removal is the build's own either way, so either side is safe; a
  // rename, link or symlink there can still bring in something from outside, so those stay changes.
  const inFresh = (path) => freshRoots.some((r) => path === r || path.startsWith(`${r}/`));
  const changes = events.filter((e) => !['observe', 'write'].includes(e.op)
    && !(['create', 'mkdir', 'create-in-place', 'remove', 'anon'].includes(e.op) && inFresh(e.path)));
  const related = (a, b) => a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
  for (const read of events) {
    if (read.op !== 'observe' || !isScratch(read.path)) continue;
    const hit = changes.some((c) => c.entry !== read.entry && c.entry <= read.exit && read.entry <= c.exit
      && [c.path, c.to].some((p) => p && related(p, read.path) || (p && read.fdOf && related(p, read.fdOf))));
    if (hit) refused.add(read.path);
  }
  return { verified, refused };
}

/**
 * Resolve an absolute path component by component, following symlinks before `..` as the kernel does.
 * Stops at the first component that does not exist (the kernel's lookup fails there too) and returns it.
 */
export function resolveLikeKernel(path, visited = []) {
  let current = '/';
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') { current = posix.dirname(current); continue; }
    const next = posix.join(current, part);
    visited.push(next);
    let st;
    try { st = lstatSync(next); } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return next;
      throw Error(`TRACE_UNREADABLE ${error.code} ${next}`);
    }
    current = st.isSymbolicLink() ? realpathOrSelf(next) : next;
  }
  return current;
}
function realpathOrSelf(path) {
  try { return realpathSync(path); } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR' || error.code === 'ELOOP') return path;
    throw Error(`TRACE_UNREADABLE ${error.code} ${path}`);
  }
}

function under(path, roots) { return roots.some((r) => path === r || path.startsWith(`${r}/`)); }

// The state of one path, as a lookup sees it. Never follows the final symlink: a link records its target and
// the target is recorded as its own entry.
export function pathState(path, { listing = false, outputRoots = [] } = {}) {
  let st;
  try { st = lstatSync(path); } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return { t: 'missing' };
    throw Error(`TRACE_UNREADABLE ${error.code} ${path}`);
  }
  if (st.isSymbolicLink()) return { t: 'link', to: readlinkSync(path) };
  if (st.isFile()) return { t: 'file', m: st.mode & 0o7777, h: sha256(readFileSync(path)) };
  if (st.isDirectory()) {
    const state = { t: 'dir', m: st.mode & 0o7777 };
    if (listing) {
      state.ls = readdirSync(path, { withFileTypes: true })
        .filter((d) => !under(posix.join(path, d.name), outputRoots))
        .map((d) => `${d.name}:${d.isDirectory() ? 'd' : d.isFile() ? 'f' : d.isSymbolicLink() ? 'l' : 'o'}`).sort();
    }
    return state;
  }
  return { t: 'other' };
}

/**
 * Turn a parsed trace into a manifest. `root` is the checkout; repository paths are stored relative to it so
 * that the manifest is independent of where the checkout lives. Returns { manifest } or { problems }.
 */
// Character devices that hold no file data, and /dev itself. Reads of stdout and stderr are left out: they read an
// inherited fd.
const DEVICE_READ = /^\/dev(\/(null|zero|full|random|urandom|tty|ptmx|pts\/\d+))?$/;
const DEVICE_WRITE = /^\/dev\/(null|zero|full|tty|stdout|stderr|pts\/\d+)$/;

export function buildManifest(trace, { root, outputRoots, scratchRoots = [], freshRoots = [], unclearedOutputRoots = [], ignoredRoots = ['/proc', '/sys', '/dev'] }) {
  const problems = [...trace.problems];
  if (trace.network.length) problems.push(...trace.network.map((n) => `network connection during build: ${n}`));
  const outputs = outputRoots.map((r) => posix.normalize(r)), scratch = scratchRoots.map((r) => posix.normalize(r));
  // A temporary path is anything below a scratch root except the checkout, its outputs and the checkout's own
  // ancestors (a scratch root itself, and every directory above the checkout, is recorded like any directory).
  const isScratch = (path) => under(path, scratch) && !scratch.includes(path) && !under(path, [root, ...outputs])
    && !root.startsWith(`${path}/`);
  // The build may write temporary files, but it may read one only if it created it itself (scratchVerdicts).
  const fresh = freshRoots.map((r) => posix.normalize(r));
  if (fresh.some((r) => !isScratch(r))) throw Error('TRACE_FRESH_ROOT_OUTSIDE_SCRATCH');
  const { verified, refused } = scratchVerdicts(trace.events ?? [], isScratch, fresh);
  // Refused: a read the event log shows came first. Unverified: a recorded read with no event proving it safe.
  const unsafe = new Set([...refused, ...[...trace.observed, ...trace.listed].filter((path) => isScratch(path) && !verified.has(path))]);
  for (const path of [...unsafe].sort()) problems.push(`build read a temporary path it did not create: ${path}`);
  // /dev/null and /dev/tty are not files; /proc and /sys writes would be odd but cannot change a later build's inputs.
  const physical = (trace.dotdot ?? []).map(({ path, write }) => {
    const visited = [];
    try { return { path: resolveLikeKernel(path, visited), visited, write }; } catch (error) { problems.push(error.message); return null; }
  }).filter(Boolean);
  const writes = [...trace.written, ...physical.filter((p) => p.write).map((p) => p.path)];
  // Writing temporary files is allowed, in the scratch root itself too (O_TMPFILE, mkdir -p).
  const scratchWrite = (path) => isScratch(path) || scratch.includes(path);
  for (const path of writes) if (!under(path, outputs) && !under(path, ignoredRoots) && !scratchWrite(path)) problems.push(`build wrote outside its output roots: ${path}`);
  // /proc/<pid>/root, cwd and fd reach any file under another name, and /proc is not recorded: refuse them.
  for (const path of [...trace.observed, ...trace.listed, ...writes]) {
    if (/^\/proc\/[^/]+\/(task\/[^/]+\/)?(root|cwd|fd|map_files)(\/|$)/.test(path)) problems.push(`build reached a path through /proc: ${path}`);
  }
  // /dev/fd and /dev/stdin read an fd under another name, which /dev (not recorded) would hide.
  for (const path of [...trace.observed, ...trace.listed]) if (/^\/dev\/(fd|stdin)(\/|$)/.test(path)) problems.push(`build read an inherited fd through /dev: ${path}`);
  // /dev is not recorded because its devices hold no file data, but /dev/shm and /dev/mqueue are ordinary writable
  // directories: a file, link or alias there (`/dev/shm/x -> /tmp/pre`) would be read unrecorded. So only known
  // character devices may be used under /dev, and nothing may be written under the other unrecorded roots at all.
  for (const path of [...trace.observed, ...trace.listed]) {
    if (under(path, ['/dev']) && !DEVICE_READ.test(path) && !/^\/dev\/(fd|stdin)(\/|$)/.test(path)) problems.push(`build used a /dev path that is not a known device: ${path}`);
  }
  for (const path of writes) if (under(path, ignoredRoots) && !DEVICE_WRITE.test(path)) problems.push(`build wrote under an unrecorded root: ${path}`);
  // Something moved or linked into an output root from outside would be read there unrecorded.
  for (const { from, to } of trace.moves ?? []) {
    if (under(to, outputs) && !under(from, outputs)) problems.push(`build moved something into its outputs from outside them: ${to}`);
  }
  // Reads under output roots are not recorded, so a link there may only point within the outputs. A `..` in the
  // target is refused before normalizing: the kernel follows a link on the way before applying `..`, so
  // `entry -> deep/link/../../tmp/x` with `deep/link -> ..` leaves the outputs though it normalizes inside them.
  for (const { target, path } of trace.links ?? []) {
    if (!under(path, outputs)) continue;
    const to = typeof target === 'string' && !target.split('/').includes('..')
      ? posix.normalize(posix.isAbsolute(target) ? target : posix.join(posix.dirname(path), target)) : null;
    // An output root that is not emptied before the build (.host-locks) may hold links from before it, so it does not count.
    if (!to || !under(to, outputs) || under(to, unclearedOutputRoots.map((r) => posix.normalize(r)))) {
      problems.push(`build linked an output to something outside its outputs: ${path}`);
    }
  }
  // A `..` lookup is replayed by path, not in trace order, so one that goes through a temporary path is refused.
  for (const { path, visited, write } of physical) {
    if (!write && [path, ...visited].some(isScratch)) problems.push(`build read a temporary path through \`..\`: ${path}`);
  }
  if (problems.length) return { problems };
  const wanted = new Map();
  const add = (path, listing = false) => {
    if (under(path, ignoredRoots) || under(path, outputs) || isScratch(path)) return;
    wanted.set(path, (wanted.get(path) ?? false) || listing);
    // Every lookup resolves through its ancestors: a directory replaced by a symlink changes what it reads.
    for (let dir = posix.dirname(path); ; dir = posix.dirname(dir)) {
      if (!wanted.has(dir)) wanted.set(dir, false);
      if (dir === '/') break;
    }
  };
  for (const path of trace.observed) add(path);
  for (const { path, visited, write } of physical) { for (const step of visited) add(step); if (!write) add(path); }
  for (const path of trace.listed) add(path, true);
  // The kernel follows symlinks without telling strace where they lead: every link target is an input too.
  const states = new Map();
  for (let changed = true; changed;) {
    changed = false;
    for (const [path, listing] of wanted) {
      if (states.has(path)) continue;
      const state = pathState(path, { listing, outputRoots: outputs });
      states.set(path, state);
      if (state.t === 'link') {
        // Resolve the target string the kernel's way too: a symlink inside it is followed before any `..`.
        const unnormalized = posix.isAbsolute(state.to) ? state.to : `${posix.dirname(path)}/${state.to}`;
        const visited = [];
        let target;
        try { target = resolveLikeKernel(unnormalized, visited); } catch (error) { problems.push(error.message); continue; }
        for (const candidate of [posix.normalize(unnormalized), target, ...visited]) {
          if (under(candidate, outputs)) { problems.push(`input link into an output root: ${path}`); break; }
          if (isScratch(candidate)) { problems.push(`input link into a temporary path: ${path}`); break; }
          // A link into /dev/shm and the like (or /proc) names a file whose content is never recorded.
          if (under(candidate, ignoredRoots) && !ignoredRoots.includes(candidate) && !DEVICE_READ.test(candidate)) { problems.push(`input link into an unrecorded root: ${path}`); break; }
          if (!wanted.has(candidate)) { add(candidate); changed = true; }
        }
      }
    }
  }
  if (problems.length) return { problems };
  const manifest = [...states].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([path, state]) => [relativeName(path, root), state]);
  return { manifest };
}

const relativeName = (path, root) => (path === root ? '@root' : path.startsWith(`${root}/`) ? `@root/${path.slice(root.length + 1)}` : path);
const absoluteName = (name, root) => (name === '@root' ? root : name.startsWith('@root/') ? `${root}/${name.slice(6)}` : name);

export function manifestDigest(manifest) { return sha256(JSON.stringify(manifest)); }

/** First difference between a manifest and this checkout, or null when every entry is identical. */
export function firstManifestDifference(manifest, { root, outputRoots }) {
  if (!Array.isArray(manifest) || manifest.length === 0) return 'empty manifest';
  const outputs = outputRoots.map((r) => posix.normalize(r));
  for (const entry of manifest) {
    if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string') return 'malformed entry';
    const [name, expected] = entry;
    const path = absoluteName(name, root);
    if (!path.startsWith('/') || posix.normalize(path) !== path) return `unsafe path ${name}`;
    let actual;
    try { actual = pathState(path, { listing: Array.isArray(expected?.ls), outputRoots: outputs }); } catch { return `unreadable ${name}`; }
    if (JSON.stringify(actual) !== JSON.stringify(expected)) return name;
  }
  return null;
}
