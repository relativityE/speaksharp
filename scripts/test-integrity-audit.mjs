#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const TEST_EXTENSIONS = /\.(test|spec)\.(ts|tsx)$/;

const requiredFiles = [
  'tests/live/first-time-tester-private-trial.live.spec.ts',
];

const requiredWorkflowNeedles = [
  'first-time-tester-private-trial',
  'tests/live/first-time-tester-private-trial.live.spec.ts',
];

const failPatterns = [
  {
    name: 'placeholder assertion',
    pattern: /expect\(true\)\.toBe\(true\)/,
    rationale: 'This makes a test pass without proving user-visible behavior.',
  },
  {
    name: 'placeholder test title',
    pattern: /\b(it|test)\s*\(\s*['"`][^'"`]*placeholder[^'"`]*['"`]/i,
    rationale: 'Placeholder tests must not count as release evidence.',
  },
  {
    name: 'explicit non-gating diagnostic',
    pattern: /do NOT fail test/i,
    rationale: 'Diagnostics are allowed, but not as passing release tests.',
  },
];

const warnPatterns = [
  {
    name: 'weak existence assertion',
    pattern: /\.to(BeTruthy|BeDefined)\(\)/,
    rationale: 'Often valid as a precondition, but weak if it is the main assertion.',
  },
  {
    name: 'swallowed cleanup error',
    pattern: /\.catch\(\s*\(\s*\)\s*=>\s*(undefined|\{\s*\})\s*\)/,
    rationale: 'Acceptable in teardown only; dangerous in product-path assertions.',
  },
  {
    name: 'runtime skip',
    pattern: /\btest\.skip\(/,
    rationale: 'Live tests may skip without secrets; release gates should make skipped coverage explicit.',
  },
];

const files = [];
walk(join(ROOT, 'frontend', 'src'), files);
walk(join(ROOT, 'tests'), files);
walk(join(ROOT, 'backend', 'supabase', 'functions'), files);

const failures = [];
const warnings = [];

for (const file of files.filter((path) => TEST_EXTENSIONS.test(path))) {
  const text = readFileSync(file, 'utf8');
  const rel = relative(ROOT, file);

  for (const rule of failPatterns) {
    if (rule.pattern.test(text)) {
      failures.push({ file: rel, ...rule });
    }
  }

  for (const rule of warnPatterns) {
    if (rule.pattern.test(text)) {
      warnings.push({ file: rel, ...rule });
    }
  }
}

for (const file of requiredFiles) {
  try {
    statSync(join(ROOT, file));
  } catch {
    failures.push({
      file,
      name: 'missing critical user journey',
      rationale: 'The first-time tester Private trial path must be a named live release gate.',
    });
  }
}

const workflowText = readFileSync(join(ROOT, '.github', 'workflows', 'live-release-matrix.yml'), 'utf8');
for (const needle of requiredWorkflowNeedles) {
  if (!workflowText.includes(needle)) {
    failures.push({
      file: '.github/workflows/live-release-matrix.yml',
      name: 'missing critical workflow wiring',
      rationale: `Expected workflow to include ${needle}.`,
    });
  }
}

console.log(`TEST_INTEGRITY_AUDIT files=${files.filter((path) => TEST_EXTENSIONS.test(path)).length} warnings=${warnings.length} failures=${failures.length}`);

if (warnings.length > 0) {
  console.log('TEST_INTEGRITY_WARNINGS');
  for (const warning of warnings.slice(0, 80)) {
    console.log(`- ${warning.file}: ${warning.name} - ${warning.rationale}`);
  }
  if (warnings.length > 80) {
    console.log(`- ... ${warnings.length - 80} more warnings omitted`);
  }
}

if (failures.length > 0) {
  console.error('TEST_INTEGRITY_FAILURES');
  for (const failure of failures) {
    console.error(`- ${failure.file}: ${failure.name} - ${failure.rationale}`);
  }
  process.exit(1);
}

function walk(dir, out) {
  let entries = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }

  for (const entry of entries) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist' || entry === 'coverage') continue;
      walk(path, out);
    } else {
      out.push(path);
    }
  }
}
