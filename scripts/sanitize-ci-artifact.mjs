import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MODULE_PATH = fileURLToPath(import.meta.url);
const SCHEMA_VERSION = 1;
const PLAYWRIGHT_STATUSES = new Set(['passed', 'failed', 'timedOut', 'skipped', 'interrupted']);
const PLAYWRIGHT_OUTCOMES = new Set(['expected', 'unexpected', 'flaky', 'skipped']);
const LIGHTHOUSE_CATEGORIES = [
  ['performance', 'performance'],
  ['accessibility', 'accessibility'],
  ['bestPractices', 'best-practices'],
  ['seo', 'seo'],
];
const LIGHTHOUSE_METRICS = [
  'first-contentful-paint',
  'largest-contentful-paint',
  'speed-index',
  'total-blocking-time',
  'cumulative-layout-shift',
];

function fail(message) {
  throw new Error(message);
}

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`);
  return value;
}

function finiteNumber(value, label, { integer = false } = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || (integer && !Number.isInteger(value))) {
    fail(`${label} must be a non-negative${integer ? ' integer' : ''}`);
  }
  return value;
}

function exactKeys(value, allowed, label) {
  const extras = Object.keys(value).filter((key) => !allowed.has(key));
  if (extras.length) fail(`${label} contains unapproved fields`);
}

function writeSanitizedJson(outputPath, value) {
  const absolute = resolve(outputPath);
  const temporary = `${absolute}.tmp`;
  mkdirSync(dirname(absolute), { recursive: true });
  rmSync(absolute, { force: true });
  rmSync(temporary, { force: true });
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  renameSync(temporary, absolute);
}

function sanitizedPlaywrightTest(test, index) {
  object(test, `Playwright test ${index}`);
  if (!PLAYWRIGHT_STATUSES.has(test.status)) fail(`Playwright test ${index} has an invalid status`);
  if (!PLAYWRIGHT_OUTCOMES.has(test.outcome)) fail(`Playwright test ${index} has an invalid outcome`);
  return {
    status: test.status,
    outcome: test.outcome,
    retries: finiteNumber(test.retries ?? 0, `Playwright test ${index} retries`, { integer: true }),
    duration: finiteNumber(test.duration ?? 0, `Playwright test ${index} duration`),
    retryOverheadMs: finiteNumber(test.retryOverheadMs ?? 0, `Playwright test ${index} retry overhead`),
    attempts: finiteNumber(test.attempts ?? 1, `Playwright test ${index} attempts`, { integer: true }),
  };
}

function playwrightStats(tests) {
  const stats = { expected: 0, unexpected: 0, flaky: 0, skipped: 0, total: tests.length };
  for (const test of tests) stats[test.outcome] += 1;
  return stats;
}

export function sanitizePlaywrightReport(rawReport, shard) {
  const raw = object(rawReport, 'Playwright report');
  const shardNumber = finiteNumber(Number(shard), 'Playwright shard', { integer: true });
  if (shardNumber < 1) fail('Playwright shard must be greater than zero');
  if (!Array.isArray(raw.tests)) fail('Playwright report tests must be an array');
  const tests = raw.tests.map(sanitizedPlaywrightTest);
  if (tests.length === 0) fail('Playwright report contains no tests');
  return {
    schemaVersion: SCHEMA_VERSION,
    kind: 'playwright-shard-summary',
    shard: shardNumber,
    stats: playwrightStats(tests),
    tests,
  };
}

function validateSanitizedPlaywrightSummary(value, label) {
  const summary = object(value, label);
  exactKeys(summary, new Set(['schemaVersion', 'kind', 'shard', 'stats', 'tests']), label);
  if (summary.schemaVersion !== SCHEMA_VERSION || summary.kind !== 'playwright-shard-summary') {
    fail(`${label} has an unsupported schema`);
  }
  const shard = finiteNumber(summary.shard, `${label} shard`, { integer: true });
  const stats = object(summary.stats, `${label} stats`);
  exactKeys(stats, new Set(['expected', 'unexpected', 'flaky', 'skipped', 'total']), `${label} stats`);
  if (!Array.isArray(summary.tests) || summary.tests.length === 0) fail(`${label} contains no tests`);
  const tests = summary.tests.map((test, index) => {
    object(test, `${label} test ${index}`);
    exactKeys(test, new Set(['status', 'outcome', 'retries', 'duration', 'retryOverheadMs', 'attempts']), `${label} test ${index}`);
    return sanitizedPlaywrightTest(test, index);
  });
  const computed = playwrightStats(tests);
  for (const key of Object.keys(computed)) {
    finiteNumber(stats[key], `${label} stats.${key}`, { integer: true });
    if (stats[key] !== computed[key]) fail(`${label} stats do not match sanitized tests`);
  }
  return { schemaVersion: SCHEMA_VERSION, kind: summary.kind, shard, stats: computed, tests };
}

export function mergePlaywrightSummaries(rawSummaries) {
  if (!Array.isArray(rawSummaries) || rawSummaries.length === 0) fail('No Playwright summaries were provided');
  const summaries = rawSummaries.map((summary, index) => validateSanitizedPlaywrightSummary(summary, `Playwright summary ${index}`));
  summaries.sort((left, right) => left.shard - right.shard);
  if (new Set(summaries.map(({ shard }) => shard)).size !== summaries.length) fail('Playwright summary shards must be unique');
  const tests = summaries.flatMap(({ tests }) => tests);
  return {
    schemaVersion: SCHEMA_VERSION,
    kind: 'playwright-suite-summary',
    stats: playwrightStats(tests),
    shards: summaries.map(({ shard, stats }) => ({ shard, stats })),
    tests,
  };
}

function lighthouseScore(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) fail(`${label} must be between zero and one`);
  return value;
}

function sanitizedLighthouseReport(rawReport) {
  const raw = object(rawReport, 'Lighthouse report');
  const categories = object(raw.categories, 'Lighthouse categories');
  const audits = object(raw.audits, 'Lighthouse audits');
  const sanitizedCategories = {};
  for (const [outputName, sourceName] of LIGHTHOUSE_CATEGORIES) {
    sanitizedCategories[outputName] = lighthouseScore(
      object(categories[sourceName], `Lighthouse category ${sourceName}`).score,
      `Lighthouse category ${sourceName} score`,
    );
  }
  const metrics = {};
  for (const name of LIGHTHOUSE_METRICS) {
    const audit = object(audits[name], `Lighthouse metric ${name}`);
    metrics[name] = {
      score: audit.score === null ? null : lighthouseScore(audit.score, `Lighthouse metric ${name} score`),
      numericValue: finiteNumber(audit.numericValue, `Lighthouse metric ${name} numeric value`),
    };
  }
  return { categories: sanitizedCategories, metrics };
}

export function sanitizeLighthouseReports(rawReports) {
  if (!Array.isArray(rawReports) || rawReports.length === 0) fail('No valid Lighthouse reports were found');
  return {
    schemaVersion: SCHEMA_VERSION,
    kind: 'lighthouse-metrics-summary',
    reports: rawReports.map(sanitizedLighthouseReport),
  };
}

function readJson(path, label) {
  if (!existsSync(path)) fail(`${label} is missing`);
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    fail(`${label} is not valid JSON`);
  }
}

export function sanitizePlaywrightFile(inputPath, outputPath, shard) {
  rmSync(resolve(outputPath), { force: true });
  const sanitized = sanitizePlaywrightReport(readJson(inputPath, 'Playwright input report'), shard);
  writeSanitizedJson(outputPath, sanitized);
}

export function mergePlaywrightFiles(outputPath, inputPaths) {
  rmSync(resolve(outputPath), { force: true });
  const merged = mergePlaywrightSummaries(inputPaths.map((path, index) => readJson(path, `Playwright summary ${index}`)));
  writeSanitizedJson(outputPath, merged);
}

export function sanitizeLighthouseDirectory(inputDirectory, outputPath) {
  rmSync(resolve(outputPath), { force: true });
  if (!existsSync(inputDirectory)) fail('Lighthouse input directory is missing');
  const rawReports = readdirSync(inputDirectory)
    .filter((name) => name.endsWith('-report.json'))
    .sort()
    .map((name) => readJson(join(inputDirectory, name), `Lighthouse report ${basename(name)}`))
    .filter((report) => report?.categories && report?.audits);
  writeSanitizedJson(outputPath, sanitizeLighthouseReports(rawReports));
}

function usage() {
  fail('Usage: sanitize-ci-artifact.mjs <playwright|merge-playwright|lighthouse> ...');
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(MODULE_PATH)) {
  try {
    const [, , command, ...args] = process.argv;
    if (command === 'playwright' && args.length === 3) sanitizePlaywrightFile(args[0], args[1], args[2]);
    else if (command === 'merge-playwright' && args.length >= 2) mergePlaywrightFiles(args[0], args.slice(1));
    else if (command === 'lighthouse' && args.length === 2) sanitizeLighthouseDirectory(args[0], args[1]);
    else usage();
  } catch (error) {
    console.error(`CI artifact sanitization failed: ${error.message}`);
    process.exitCode = 1;
  }
}
