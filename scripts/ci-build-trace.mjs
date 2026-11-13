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
// Scope note: mtimes are not recorded (a fresh checkout changes them all). The build's caches that key on
// mtime are deleted before every build, and node's compile cache under /tmp validates its own source hash.
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

export function decodeString(arg) {
  if (typeof arg !== 'string' || !arg.startsWith('"')) return null;
  let out = '', i = 1;
  for (; i < arg.length && arg[i] !== '"'; i++) {
    if (arg[i] !== '\\') { out += arg[i]; continue; }
    const e = arg[++i];
    const simple = { n: '\n', t: '\t', r: '\r', v: '\v', f: '\f', '\\': '\\', '"': '"' }[e];
    if (simple !== undefined) out += simple;
    else if (e === 'x') { out += String.fromCharCode(parseInt(arg.slice(i + 1, i + 3), 16)); i += 2; }
    else if (/[0-7]/.test(e)) { const oct = /^[0-7]{1,3}/.exec(arg.slice(i))[0]; out += String.fromCharCode(parseInt(oct, 8)); i += oct.length - 1; }
    else throw Error(`TRACE_UNKNOWN_ESCAPE \\${e}`);
  }
  if (arg[i] !== '"' || arg.slice(i + 1) !== '') throw Error('TRACE_TRUNCATED_STRING');
  return out;
}

const decoration = (arg) => /^(?:AT_FDCWD|\d+)<(.*)>$/s.exec(arg ?? '')?.[1] ?? null;

/**
 * Parse `strace -f -qq -y -s <large> -e trace=%file,getdents64,fchdir,connect` output.
 * Returns absolute observed/listed/written paths and every reason the trace cannot be trusted.
 */
export function parseTrace(text) {
  const problems = [], calls = [], pending = new Map();
  for (const raw of text.split('\n')) {
    if (!raw) continue;
    const m = /^(\d+) +(.*)$/.exec(raw);
    if (!m) { problems.push(`unparsed line: ${raw.slice(0, 120)}`); continue; }
    const [, pid, rest] = m;
    if (rest.startsWith('+++ ') || rest.startsWith('--- ')) continue;
    if (rest.endsWith(' <unfinished ...>')) {
      if (pending.has(pid)) problems.push(`nested unfinished call in ${pid}`);
      pending.set(pid, rest.slice(0, -' <unfinished ...>'.length));
      continue;
    }
    const resumed = /^<\.\.\. ([a-z0-9_]+) resumed>(.*)$/.exec(rest);
    if (resumed) {
      const head = pending.get(pid);
      if (head === undefined || !head.startsWith(`${resumed[1]}(`)) { problems.push(`orphan resume in ${pid}`); continue; }
      pending.delete(pid);
      calls.push({ pid, line: head + resumed[2] });
    } else calls.push({ pid, line: rest });
  }
  // A process that exited inside a call still asked for the path: keep the request, result unknown.
  for (const [pid, head] of pending) calls.push({ pid, line: `${head}) = ?` });

  // Relative paths outside *at calls resolve against the caller's cwd. strace -y decorates AT_FDCWD with
  // that cwd, so a (pid, chdir-epoch) whose decorations all agree gives the cwd; disagreement fails closed.
  const parsed = [], epoch = new Map(), cwd = new Map();
  for (const { pid, line } of calls) {
    const call = splitCall(line);
    if (!call) { problems.push(`unparsed call: ${line.slice(0, 120)}`); continue; }
    const e = epoch.get(pid) ?? 0, key = `${pid}:${e}`;
    for (const arg of call.args) {
      if (!arg.startsWith('AT_FDCWD<')) continue;
      const dir = decoration(arg);
      if (cwd.has(key) && cwd.get(key) !== dir) problems.push(`cwd changed without chdir in ${pid}`);
      cwd.set(key, dir);
    }
    parsed.push({ pid, key, call });
    if ((call.name === 'chdir' || call.name === 'fchdir') && !/= -1/.test(call.result)) epoch.set(pid, e + 1);
  }

  const observed = new Set(), listed = new Set(), written = new Set(), network = [], dotdot = [];
  const resolve = (dirfdArg, path, key) => {
    if (path.startsWith('/')) return posix.normalize(path);
    const base = dirfdArg === null ? cwd.get(key) : decoration(dirfdArg);
    if (!base || !base.startsWith('/')) throw Error('TRACE_UNRESOLVED_RELATIVE_PATH');
    return posix.normalize(posix.join(base, path));
  };
  for (const { pid, key, call } of parsed) {
    const { name, args } = call;
    try {
      if (name === 'getdents64') { const dir = decoration(args[0]); if (!dir?.startsWith('/')) throw Error('TRACE_UNDECORATED_FD'); listed.add(posix.normalize(dir)); continue; }
      if (name === 'connect') {
        // A local socket path that does not exist answers nothing: glibc probes the nscd socket this way before
        // falling back to files (/etc/passwd, /etc/hosts) that are themselves traced. That probe is an
        // observation of an absent path, so a later runner where the socket exists rebuilds. Any connection that
        // could have been answered (inet, abstract, or an existing socket) is network use and fails closed.
        const unix = /^\{sa_family=AF_UNIX, sun_path=("(?:[^"\\]|\\.)*")\}$/.exec(args[1] ?? '');
        if (unix && /^= -1 ENOENT\b/.test(call.result)) {
          const socketPath = decodeString(unix[1]);
          if (!socketPath?.startsWith('/')) throw Error('TRACE_UNRESOLVED_RELATIVE_PATH');
          observed.add(posix.normalize(socketPath));
          continue;
        }
        network.push(`${pid}: ${args[1]?.slice(0, 80)} ${call.result.slice(0, 40)}`);
        continue;
      }
      if (NO_PATH.has(name)) continue;
      const spec = PATH_ARGS[name];
      if (!spec) throw Error(`TRACE_UNCLASSIFIED_SYSCALL ${name}`);
      for (const [fdIndex, pathIndex, kind] of spec) {
        const rawPath = args[pathIndex];
        let path, unnormalized = null;
        if (rawPath === 'NULL' || (rawPath === '""' && /AT_EMPTY_PATH/.test(args.join(',')))) {
          path = decoration(args[fdIndex ?? -1]);
          if (!path?.startsWith('/')) throw Error('TRACE_UNDECORATED_FD');
          path = posix.normalize(path);
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
        let effective = kind;
        if (kind === 'open') {
          const flags = name === 'openat2' ? (/flags=([A-Z0-9_|]+)/.exec(args[2] ?? '')?.[1] ?? '') : (args[fdIndex === null ? 1 : 2] ?? '');
          effective = WRITE_FLAGS.test(flags) ? 'write' : 'observe';
        }
        (effective === 'write' ? written : observed).add(path);
        // The kernel resolves a symlink before the `..` that follows it, so `link/../x` may name a file other than
        // the lexical `x`. The manifest resolves these the kernel's way (resolveLikeKernel) as well.
        if (unnormalized) dotdot.push({ path: unnormalized, write: effective === 'write' });
      }
    } catch (error) { problems.push(`${error.message}: ${call.name}(${call.args.slice(0, 3).join(', ').slice(0, 160)})`); }
  }
  return { observed, listed, written, network, dotdot, problems };
}

/**
 * Resolve an absolute path component by component, following symlinks before `..` as the kernel does.
 * Stops at the first component that does not exist (the kernel's lookup fails there too) and returns it.
 */
export function resolveLikeKernel(path) {
  let current = '/';
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') { current = posix.dirname(current); continue; }
    const next = posix.join(current, part);
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
export function buildManifest(trace, { root, outputRoots, ignoredRoots = ['/proc', '/sys', '/dev'] }) {
  const problems = [...trace.problems];
  if (trace.network.length) problems.push(...trace.network.map((n) => `network connection during build: ${n}`));
  const outputs = outputRoots.map((r) => posix.normalize(r));
  // /dev/null and /dev/tty are not files; /proc and /sys writes would be odd but cannot change a later build's inputs.
  const physical = (trace.dotdot ?? []).map(({ path, write }) => {
    try { return { path: resolveLikeKernel(path), write }; } catch (error) { problems.push(error.message); return null; }
  }).filter(Boolean);
  const writes = [...trace.written, ...physical.filter((p) => p.write).map((p) => p.path)];
  for (const path of writes) if (!under(path, outputs) && !under(path, ignoredRoots)) problems.push(`build wrote outside its output roots: ${path}`);
  if (problems.length) return { problems };
  const wanted = new Map();
  const add = (path, listing = false) => {
    if (under(path, ignoredRoots) || under(path, outputs)) return;
    wanted.set(path, (wanted.get(path) ?? false) || listing);
    // Every lookup resolves through its ancestors: a directory replaced by a symlink changes what it reads.
    for (let dir = posix.dirname(path); ; dir = posix.dirname(dir)) {
      if (!wanted.has(dir)) wanted.set(dir, false);
      if (dir === '/') break;
    }
  };
  for (const path of trace.observed) add(path);
  for (const { path, write } of physical) if (!write) add(path);
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
        const target = posix.normalize(posix.isAbsolute(state.to) ? state.to : posix.join(posix.dirname(path), state.to));
        if (under(target, outputs)) { problems.push(`input link into an output root: ${path}`); continue; }
        if (!wanted.has(target)) { add(target); changed = true; }
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
