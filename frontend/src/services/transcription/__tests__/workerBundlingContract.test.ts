import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const TEST_FILE = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(TEST_FILE), '../../../../..');
const FRONTEND_SRC = path.join(REPO_ROOT, 'frontend/src');

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx']);
const LEGACY_WORKER_URL_PATTERN = /new\s+URL\s*\([^)]*\.worker\.[tj]s[^)]*import\.meta\.url[^)]*\)/s;

function collectSourceFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const absolutePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(absolutePath));
      continue;
    }

    if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(absolutePath);
    }
  }

  return files;
}

describe('worker bundling contract', () => {
  it('uses Vite ?worker&url imports instead of new URL(...worker..., import.meta.url)', () => {
    const offenders = collectSourceFiles(FRONTEND_SRC)
      .map((file) => ({
        file: path.relative(REPO_ROOT, file),
        source: fs.readFileSync(file, 'utf8'),
      }))
      .filter(({ source }) => LEGACY_WORKER_URL_PATTERN.test(source))
      .map(({ file }) => file);

    expect(offenders, [
      'Web workers must use Vite worker asset imports so deployed builds get fingerprinted worker URLs.',
      "Use: import workerUrl from './example.worker.ts?worker&url'; new Worker(workerUrl, { type: 'module' });",
      `Offending files: ${offenders.join(', ') || '(none)'}`,
    ].join('\n')).toEqual([]);
  });
});
