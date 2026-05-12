#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();
const scanRoots = ['frontend/src', 'frontend/public', 'frontend/index.html'];
const blockedPatterns = [
  /VITE_[A-Z0-9_]*(SECRET|SERVICE_ROLE|WEBHOOK|ASSEMBLYAI|GEMINI|OPENAI|STRIPE_SECRET)[A-Z0-9_]*/g,
  /\b(SUPABASE_SERVICE_ROLE_KEY|ASSEMBLYAI_API_KEY|GEMINI_API_KEY|GOOGLE_API_KEY|STRIPE_SECRET_KEY|STRIPE_WEBHOOK_SECRET)\b/g,
];
const allowedPatterns = [
  /\bSENTRY_DSN\b/g,
  /\bVITE_SENTRY_DSN\b/g,
  /\bPOSTHOG_PROJECT_API_KEY\b/g,
  /\bVITE_POSTHOG_KEY\b/g,
  /\bVITE_SUPABASE_ANON_KEY\b/g,
  /\bVITE_STRIPE_PUBLISHABLE_KEY\b/g,
];
const ignoredDirs = new Set(['node_modules', 'dist', 'coverage', '.git']);
const textExtensions = new Set([
  '.cjs',
  '.css',
  '.html',
  '.js',
  '.jsx',
  '.json',
  '.mjs',
  '.ts',
  '.tsx',
]);

const findings = [];

for (const scanRoot of scanRoots) {
  walk(join(root, scanRoot));
}

if (findings.length > 0) {
  console.error('RC_SECRET_SCAN_FINDINGS');
  for (const finding of findings) {
    console.error(`${finding.path}:${finding.line}: ${finding.match}`);
  }
  process.exit(1);
}

console.log('RC_SECRET_SCAN_OK provider secrets are not referenced by frontend runtime files.');

function walk(path) {
  let stats;
  try {
    stats = statSync(path);
  } catch {
    return;
  }

  if (stats.isDirectory()) {
    const name = path.split('/').at(-1);
    if (ignoredDirs.has(name)) return;
    for (const child of readdirSync(path)) {
      walk(join(path, child));
    }
    return;
  }

  if (!stats.isFile() || !isTextFile(path)) return;

  const contents = readFileSync(path, 'utf8');
  const lines = contents.split(/\r?\n/);

  for (const [index, line] of lines.entries()) {
    const matches = blockedPatterns.flatMap((pattern) => [...line.matchAll(pattern)].map((match) => match[0]));
    for (const match of matches) {
      if (allowedPatterns.some((pattern) => pattern.test(match))) continue;
      findings.push({
        path: relative(root, path),
        line: index + 1,
        match,
      });
    }
  }
}

function isTextFile(path) {
  const basename = path.split('/').at(-1) ?? '';
  const dot = basename.lastIndexOf('.');
  if (dot === -1) return false;
  return textExtensions.has(basename.slice(dot));
}
