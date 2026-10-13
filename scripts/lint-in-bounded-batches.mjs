import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const eslintBin = path.join(root, 'node_modules/eslint/bin/eslint.js');
const sourceRoot = path.join(root, 'frontend/src');
const sourceExtensions = new Set(['.js', '.jsx', '.ts', '.tsx']);
const ignoredDirectories = new Set(['dist', 'node_modules', 'playwright-report', 'test-results', 'html', 'public']);
const maxFilesPerBatch = 250;
const eslintOptions = ['--no-cache', '--report-unused-disable-directives', '--max-warnings', '0'];

function listSourceFiles(relativeDirectory = '') {
  const absoluteDirectory = path.join(sourceRoot, relativeDirectory);
  const files = [];

  for (const entry of readdirSync(absoluteDirectory, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;

    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) {
      files.push(...listSourceFiles(relativePath));
    } else if (entry.isFile() && sourceExtensions.has(path.extname(entry.name))) {
      files.push(path.join('frontend/src', relativePath));
    }
  }

  return files.sort();
}

function runEslint(label, files) {
  if (files.length === 0) return;

  console.log(`\n> eslint batch ${label} (${files.length} files)`);
  const result = spawnSync(process.execPath, [eslintBin, ...files, ...eslintOptions], {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
  });

  if (result.error) throw result.error;
  if (result.signal) process.exit(1);
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const sourceFiles = listSourceFiles();
const sourceGroups = new Map();
for (const file of sourceFiles) {
  const relative = path.relative('frontend/src', file);
  const topLevel = relative.split(path.sep, 1)[0];
  const group = sourceGroups.get(topLevel) ?? [];
  group.push(file);
  sourceGroups.set(topLevel, group);
}

for (const [topLevel, files] of sourceGroups) {
  for (let offset = 0, batch = 1; offset < files.length; offset += maxFilesPerBatch, batch += 1) {
    runEslint(`frontend/src/${topLevel} #${batch}`, files.slice(offset, offset + maxFilesPerBatch));
  }
}

runEslint('tests and edge functions', [
  'tests/**/*.{js,jsx,ts,tsx}',
  'backend/supabase/functions/**/*.ts',
]);
