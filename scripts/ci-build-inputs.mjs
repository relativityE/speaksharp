import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync, readlinkSync, realpathSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
// Only generated outputs and Git metadata are excluded. No documentation is
// declared irrelevant: plugins may read it. All installed dependency bytes count.
const excluded = new Set(['.git', 'frontend/dist', '.ci-build-cache', 'node_modules/.vite', 'node_modules/.cache']);
export function buildEnvironment(env = process.env) {
  if (env.SENTRY_AUTH_TOKEN || env.BUILD_ID || env.VERCEL_GIT_COMMIT_SHA || env.NODE_OPTIONS) throw Error('BUILD_REUSE_SIDE_EFFECT');
  const exact = new Set(['PATH', 'HOME', 'TMPDIR', 'LANG', 'TZ', 'CI', 'NODE_ENV', 'NODE_OPTIONS', 'PNPM_HOME', 'COREPACK_HOME', 'COREPACK_ENABLE_DOWNLOAD_PROMPT', 'ImageOS', 'ImageVersion', 'GITHUB_SHA']);
  return Object.fromEntries(Object.entries(env).filter(([key]) => exact.has(key) || /^(VITE_|STT_|SENTRY_)/.test(key)));
}
export function snapshotBuildInputs(root, env, toolchain) {
  const base = realpathSync(root), rows = [];
  function visit(directory) {
    for (const name of readdirSync(directory).sort()) {
      const path = join(directory, name), rel = relative(base, path).split('\\').join('/');
      if (excluded.has(rel)) continue;
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) {
        const target = realpathSync(path);
        // pnpm internal links are covered by walking the real store. External
        // stores or workspace links cannot qualify without their bytes.
        if (target !== base && !target.startsWith(base + '/')) throw Error('BUILD_REUSE_EXTERNAL_SYMLINK');
        rows.push([rel, 'link', readlinkSync(path)]);
      } else if (stat.isDirectory()) {
        rows.push([rel, 'directory', stat.mode & 0o777]);
        visit(path);
      } else if (stat.isFile()) rows.push([rel, stat.mode & 0o777, hash(readFileSync(path))]);
      else throw Error('BUILD_REUSE_SPECIAL_INPUT');
    }
  }
  visit(base);
  if (!rows.some(([p]) => p === 'pnpm-lock.yaml') || !rows.some(([p]) => p === 'frontend/vite.config.mjs')) throw Error('BUILD_REUSE_INCOMPLETE_INPUTS');
  const variables = Object.entries(env).filter(([key]) => key !== 'GITHUB_SHA').sort(([a], [b]) => a.localeCompare(b));
  if (!toolchain?.nodeHash || !toolchain?.pnpm || !toolchain?.platform || !toolchain?.arch) throw Error('BUILD_REUSE_TOOLCHAIN');
  return hash(JSON.stringify({schema:2, mode:'test', rows, variables, toolchain}));
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
