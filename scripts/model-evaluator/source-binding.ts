import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, lstatSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';

export interface SourceBinding {
  head: string;
  tree: string;
  lockSha256: string;
  worktreeSha256: string;
  files: Array<{ path: string; sha256: string }>;
}

const scopes = ['frontend/src', 'frontend/model-evaluator.local.html', 'frontend/vite.config.mjs',
  'scripts/model-evaluator', 'tests/evidence', 'package.json', 'pnpm-lock.yaml'];
export const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');

/** Hash only declared source scopes, never env files, credentials, personal caches or ignored outputs. */
export function readSourceBinding(root: string): SourceBinding {
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args],
    { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }).trim();
  const head = git('rev-parse', 'HEAD');
  const tree = git('rev-parse', 'HEAD^{tree}');
  if (!/^[a-f0-9]{40}$/.test(head) || !/^[a-f0-9]{40}$/.test(tree)) throw new Error('source_git_identity_unavailable');
  const paths = new Set([
    ...git('ls-files', '-z', '--', ...scopes).split('\0'),
    ...git('ls-files', '--others', '--exclude-standard', '-z', '--', ...scopes).split('\0'),
  ].filter(Boolean));
  const files = [...paths].sort().map(path => {
    const absolute = resolve(root, path);
    if (!absolute.startsWith(`${resolve(root)}/`) || !lstatSync(absolute).isFile()
        || realpathSync(absolute) !== absolute) throw new Error(`source_file_not_regular:${path}`);
    return { path, sha256: sha256(readFileSync(absolute)) };
  });
  const lockSha256 = sha256(readFileSync(join(root, 'pnpm-lock.yaml')));
  return { head, tree, lockSha256, files,
    worktreeSha256: sha256(files.map(file => `${file.path}:${file.sha256}\n`).join('')) };
}

export function assertSameSource(expected: SourceBinding, actual: SourceBinding): void {
  if (expected.head !== actual.head || expected.tree !== actual.tree
      || expected.lockSha256 !== actual.lockSha256 || expected.worktreeSha256 !== actual.worktreeSha256) {
    throw new Error('source_changed_during_evaluation');
  }
}

export function assertServedRelease(expected: SourceBinding, actual: unknown): void {
  if (!/^[a-f0-9]{40}$/.test(expected.head) || actual !== expected.head) {
    throw new Error('served_release_mismatch_or_unavailable');
  }
}

/** Vite ?raw modules contain a JSON string export. Parse data only; never evaluate response code. */
export function viteRawSource(body: string): string {
  const match = /^\s*export default ("(?:[^"\\]|\\.)*")(?:;|\s|$)/.exec(body);
  if (!match) throw new Error('served_raw_source_unavailable');
  const source: unknown = JSON.parse(match[1]);
  if (typeof source !== 'string') throw new Error('served_raw_source_unavailable');
  return source;
}

export function servedSourceFiles(binding: SourceBinding) {
  return binding.files.filter(file => file.path.startsWith('frontend/src/')
    && /\.(?:[cm]?[jt]sx?|json|css)$/.test(file.path));
}
