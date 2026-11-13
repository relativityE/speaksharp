import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export function buildEnvironment(env = process.env) {
  if (env.SENTRY_AUTH_TOKEN || env.BUILD_ID || env.VERCEL_GIT_COMMIT_SHA || env.NODE_OPTIONS) throw Error('BUILD_REUSE_SIDE_EFFECT');
  const exact = new Set(['PATH', 'HOME', 'TMPDIR', 'LANG', 'TZ', 'CI', 'NODE_ENV', 'NODE_OPTIONS', 'PNPM_HOME', 'COREPACK_HOME', 'COREPACK_ENABLE_DOWNLOAD_PROMPT', 'ImageOS', 'ImageVersion', 'GITHUB_SHA']);
  // Node's compile cache (vite turns it on) lives in /tmp and outlives the build, so a traced build would read
  // cache entries it did not create, which makes its trace unusable. It only speeds up startup: switch it off.
  return { ...Object.fromEntries(Object.entries(env).filter(([key]) => exact.has(key) || /^(VITE_|STT_|SENTRY_)/.test(key))), NODE_DISABLE_COMPILE_CACHE: '1' };
}
// The build's environment, as one digest. The release commit is excluded: it is rebound, never compiled in.
export function environmentDigest(env) {
  const variables = Object.entries(env).filter(([key]) => key !== 'GITHUB_SHA').sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return hash(JSON.stringify({ schema: 1, mode: 'test', variables }));
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
// #1837 completeness floor. Every real build of this app reads these tracked files: the entry page, both
// package manifests, and every TypeScript source under frontend/src (Vite compiles the module graph and Tailwind
// scans all of src for class names). A manifest missing any of them means the trace lost part of the build, so it
// is never published as a receipt. Returns null when the tracked set cannot be listed; the caller then publishes
// nothing.
export const REQUIRED_INPUT_PATHSPECS = Object.freeze([':(glob)frontend/index.html', ':(glob)frontend/package.json',
  ':(glob)package.json', ':(glob)frontend/src/**/*.ts', ':(glob)frontend/src/**/*.tsx']);
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
