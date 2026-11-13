import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
// The build's TMPDIR. ci-smart-build makes it empty and private (0700) just before every build, so a traced build
// may read back whatever it wrote there; a temporary file outside it counts only with the trace's own proof.
export const BUILD_TMPDIR = '/tmp/speaksharp-ci-build-tmp';
export function buildEnvironment(env = process.env) {
  if (env.SENTRY_AUTH_TOKEN || env.BUILD_ID || env.VERCEL_GIT_COMMIT_SHA || env.NODE_OPTIONS) throw Error('BUILD_REUSE_SIDE_EFFECT');
  const exact = new Set(['PATH', 'HOME', 'TMPDIR', 'LANG', 'TZ', 'CI', 'NODE_ENV', 'NODE_OPTIONS', 'PNPM_HOME', 'COREPACK_HOME', 'COREPACK_ENABLE_DOWNLOAD_PROMPT', 'ImageOS', 'ImageVersion', 'GITHUB_SHA']);
  // Node's compile cache (vite turns it on) lives in /tmp and outlives the build, so a traced build would read
  // cache entries it did not create, which makes its trace unusable. It only speeds up startup: switch it off.
  // libuv can do file operations through io_uring, which strace does not see as file calls. It is off by default;
  // the build pins it off, whatever the runner sets, so every file operation stays a traced system call.
  return { ...Object.fromEntries(Object.entries(env).filter(([key]) => exact.has(key) || /^(VITE_|STT_|SENTRY_)/.test(key))), TMPDIR: BUILD_TMPDIR, NODE_DISABLE_COMPILE_CACHE: '1', UV_USE_IO_URING: '0' };
}
// Build variables that are secrets. A receipt is published, so its digest holds only whether each is set, never its
// value or a hash of it (Sam, #1837). A consumer instead checks that the build it would reuse has this checkout's
// value compiled in (secretsCompiledIn), and builds fresh when it does not.
export const SECRET_BUILD_VARIABLES = Object.freeze(['VITE_SUPABASE_ANON_KEY']);
// The build's environment and toolchain, as one digest. The release commit is excluded: it is rebound, never
// compiled in. `toolchain` names the Node and pnpm versions the build runs with (buildToolchain).
export function environmentDigest(env, toolchain) {
  if (!toolchain || !/^v\d+\.\d+\.\d+$/.test(toolchain.node) || !/^\d+\.\d+\.\d+$/.test(toolchain.pnpm)) throw Error('BUILD_REUSE_TOOLCHAIN');
  const variables = Object.entries(env).filter(([key]) => key !== 'GITHUB_SHA')
    .map(([key, value]) => (SECRET_BUILD_VARIABLES.includes(key) ? [key, value ? '(secret set)' : ''] : [key, value]))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return hash(JSON.stringify({ schema: 2, mode: 'test', variables, toolchain: { node: toolchain.node, pnpm: toolchain.pnpm, platform: toolchain.platform, arch: toolchain.arch } }));
}
// The Node and pnpm the build itself resolves from its PATH, so a runner image or pnpm change never reuses.
export function buildToolchain(env, run = execFileSync) {
  const version = (tool) => run(tool, ['--version'], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  return { node: version('node'), pnpm: version('pnpm'), platform: process.platform, arch: process.arch };
}
// Every secret set in this environment must appear, as the exact string literal Vite compiles in, in the build's
// JavaScript. A build made with another value (a rotated key) then never matches.
export function secretsCompiledIn(env, scripts) {
  return SECRET_BUILD_VARIABLES.filter((key) => env[key]).every((key) => scripts.some((code) => code.includes(JSON.stringify(env[key]))));
}
// full-evidence (#1837, Sam): the build under test carries this commit as its release, once in each entry page.
export function verifyBuildRelease(files, sha) {
  releaseWrappers(files, sha, sha);
}
export function releaseWrappers(files, oldSha, newSha) {
  if (![oldSha,newSha].every(s => /^[a-f0-9]{40}$/.test(s))) throw Error('BUILD_REUSE_RELEASE_SHA');
  const result = {};
  for (const entry of ['index.html', 'private-dropin.html']) {
    const html = files[entry], token = `window.__APP_RELEASE__=${JSON.stringify(oldSha)};`;
    if (typeof html !== 'string' || html.split(token).length !== 2 || (html.match(/window\.__APP_RELEASE__/g)||[]).length !== 1) throw Error('BUILD_REUSE_RELEASE_WRAPPER');
    result[entry] = html.replace(token, `window.__APP_RELEASE__=${JSON.stringify(newSha)};`);
  }
  return result;
}
export function safeOutputPath(name) {
  if (typeof name !== 'string' || !name || name.includes('\\') || name.startsWith('/') || name.split('/').some(p => !p || p === '.' || p === '..') || resolve('/', name) !== '/' + name) throw Error('BUILD_REUSE_UNSAFE_PATH');
  return name;
}
// #1837 completeness floor. Every real build of this app reads these tracked files (checked against the trace of a
// real `pnpm ci:build`): the entry page, both package manifests, every TypeScript, CSS, JSON and JavaScript source
// under frontend/src (Vite compiles the module graph and Tailwind scans all of src for class names), everything
// copied from frontend/public, and the build's own configuration. Node-only .js/.mjs tests under __tests__ are never
// bundled, so they are left out. A manifest missing any of them means the trace lost part of the build, so it is
// never published as a receipt. Returns null when the tracked set cannot be listed; the caller then publishes nothing.
export const REQUIRED_INPUT_PATHSPECS = Object.freeze([':(glob)frontend/index.html', ':(glob)frontend/package.json',
  ':(glob)package.json', ':(glob)frontend/src/**/*.ts', ':(glob)frontend/src/**/*.tsx', ':(glob)frontend/src/**/*.css',
  ':(glob)frontend/src/**/*.json', ':(glob)frontend/src/**/*.js', ':(glob)frontend/src/**/*.mjs',
  ':(glob,exclude)frontend/src/**/__tests__/**/*.js', ':(glob,exclude)frontend/src/**/__tests__/**/*.mjs', ':(glob)frontend/public/**',
  ':(glob)frontend/vite.config.mjs', ':(glob)frontend/tsconfig.json', ':(glob)frontend/tsconfig.node.json',
  ':(glob)frontend/postcss.config.cjs', ':(glob)frontend/tailwind.config.js']);
export function requiredBuildInputs(root, run = execFileSync) {
  try {
    const out = run('git', ['-C', root, 'ls-files', '-z', '--', ...REQUIRED_INPUT_PATHSPECS], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return out.split('\0').filter(Boolean);
  } catch { return null; }
}
export function missingRequiredInputs(manifest, required) {
  if (!Array.isArray(required)) return ['(the tracked build inputs could not be listed)'];
  const names = new Set(manifest.map(([name]) => name));
  return required.filter((path) => !names.has(`@root/${path}`));
}
