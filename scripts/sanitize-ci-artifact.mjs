import { createHash } from 'node:crypto';
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
const ASSEMBLYAI_VARIANTS = new Set(['baseline', 'keyterms', 'prompt', 'prompt_keyterms']);
const PRIVATE_MODES = new Set(['private']);

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

function signedFiniteNumber(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${label} must be a finite number`);
  return value;
}

function optionalFiniteNumber(value, label, options) {
  return value == null ? null : finiteNumber(value, label, options);
}

function boolean(value, label) {
  if (typeof value !== 'boolean') fail(`${label} must be a boolean`);
  return value;
}

function optionalBoolean(value, label) {
  return value == null ? null : boolean(value, label);
}

function enumValue(value, allowed, label) {
  if (typeof value !== 'string' || !allowed.has(value)) fail(`${label} is not approved`);
  return value;
}

function safeRuntimeToken(value, label) {
  if (value == null) return null;
  if (typeof value !== 'string' || !/^[A-Za-z0-9._-]{1,80}$/.test(value)) fail(`${label} is not a safe runtime token`);
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

function sanitizedAssemblyAiResult(row, index, fixtureOrdinals) {
  const raw = object(row, `AssemblyAI result ${index}`);
  const variant = enumValue(raw.variant, ASSEMBLYAI_VARIANTS, `AssemblyAI result ${index} variant`);
  const fixture = typeof raw.fixture === 'string' && raw.fixture ? raw.fixture : fail(`AssemblyAI result ${index} fixture is missing`);
  if (!fixtureOrdinals.has(fixture)) fixtureOrdinals.set(fixture, fixtureOrdinals.size + 1);
  if (typeof raw.wer !== 'number') {
    return {
      variant,
      fixtureOrdinal: fixtureOrdinals.get(fixture),
      status: 'error',
    };
  }
  const invalidSession = boolean(raw.invalidSession, `AssemblyAI result ${index} invalidSession`);
  return {
    variant,
    fixtureOrdinal: fixtureOrdinals.get(fixture),
    status: invalidSession ? 'invalid' : 'measured',
    wer: finiteNumber(raw.wer, `AssemblyAI result ${index} WER`),
    accuracyPct: signedFiniteNumber(raw.accuracyPct, `AssemblyAI result ${index} accuracy`),
    fillerRecall: optionalFiniteNumber(raw.fillerRecall, `AssemblyAI result ${index} filler recall`),
    turnCount: finiteNumber(raw.turnCount, `AssemblyAI result ${index} turn count`, { integer: true }),
    finalTurnCount: finiteNumber(raw.finalTurnCount, `AssemblyAI result ${index} final turn count`, { integer: true }),
    partialTurnCount: finiteNumber(raw.partialTurnCount, `AssemblyAI result ${index} partial turn count`, { integer: true }),
    terminationSeen: boolean(raw.terminationSeen, `AssemblyAI result ${index} terminationSeen`),
    messageCount: finiteNumber(raw.messageCount, `AssemblyAI result ${index} message count`, { integer: true }),
    closeCode: optionalFiniteNumber(raw.closeCode, `AssemblyAI result ${index} close code`, { integer: true }),
    invalidSession,
    concurrencyRetries: finiteNumber(raw.concurrencyRetries, `AssemblyAI result ${index} concurrency retries`, { integer: true }),
  };
}

function assemblyAiVariantSummary(variant, results) {
  const variantResults = results.filter((row) => row.variant === variant);
  const measured = variantResults.filter((row) => row.status === 'measured');
  const averageWer = measured.length
    ? measured.reduce((sum, row) => sum + row.wer, 0) / measured.length
    : null;
  const fillerResults = measured.filter((row) => row.fillerRecall != null);
  return {
    variant,
    validRowCount: measured.length,
    invalidRowCount: variantResults.filter((row) => row.status === 'invalid').length,
    errorRowCount: variantResults.filter((row) => row.status === 'error').length,
    evidenceValid: measured.length > 0,
    averageWer,
    averageAccuracyPct: averageWer == null ? null : Number(((1 - averageWer) * 100).toFixed(2)),
    averageFillerRecall: fillerResults.length
      ? fillerResults.reduce((sum, row) => sum + row.fillerRecall, 0) / fillerResults.length
      : null,
  };
}

export function sanitizeAssemblyAiStreamingProof(rawProof) {
  const raw = object(rawProof, 'AssemblyAI streaming proof');
  if (!Array.isArray(raw.variants) || raw.variants.length === 0) fail('AssemblyAI streaming proof variants are missing');
  if (!Array.isArray(raw.fixtures) || raw.fixtures.length === 0) fail('AssemblyAI streaming proof fixtures are missing');
  if (!Array.isArray(raw.results) || raw.results.length === 0) fail('AssemblyAI streaming proof results are missing');
  const variants = raw.variants.map((variant, index) => enumValue(variant, ASSEMBLYAI_VARIANTS, `AssemblyAI variant ${index}`));
  const fixtureOrdinals = new Map();
  const results = raw.results.map((row, index) => sanitizedAssemblyAiResult(row, index, fixtureOrdinals));
  return {
    schemaVersion: SCHEMA_VERSION,
    kind: 'assemblyai-streaming-metrics-summary',
    model: raw.model === 'universal-streaming-english' ? raw.model : fail('AssemblyAI model is not approved'),
    chunkMs: finiteNumber(raw.chunkMs, 'AssemblyAI chunk size'),
    variantCount: variants.length,
    fixtureCount: raw.fixtures.length,
    resultCount: results.length,
    results,
    variantSummaries: variants.map((variant) => assemblyAiVariantSummary(variant, results)),
  };
}

function audioPayloadDigest(dataUrl, label) {
  if (typeof dataUrl !== 'string') fail(`${label} is missing`);
  const match = dataUrl.match(/^data:audio\/[A-Za-z0-9.+-]+;base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match) fail(`${label} is not a base64 audio data URL`);
  const encoded = match[1];
  const canonicalBase64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
  if (!canonicalBase64.test(encoded)) fail(`${label} must use canonical base64 padding`);
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.length === 0) fail(`${label} contains no audio bytes`);
  if (bytes.toString('base64') !== encoded) fail(`${label} failed canonical base64 round-trip validation`);
  return createHash('sha256').update(bytes).digest('hex');
}

function sanitizedAudioRoute(chunks, label) {
  if (!Array.isArray(chunks)) fail(`${label} must be an array`);
  const digests = [];
  let totalSamples = 0;
  let totalDurationSec = 0;
  let totalEncodedBytes = 0;
  chunks.forEach((chunk, index) => {
    const raw = object(chunk, `${label} ${index}`);
    totalSamples += finiteNumber(raw.samples, `${label} ${index} samples`, { integer: true });
    totalDurationSec += finiteNumber(raw.durationSec, `${label} ${index} duration`);
    totalEncodedBytes += finiteNumber(raw.wavDataUrlBytes, `${label} ${index} encoded bytes`, { integer: true });
    digests.push(audioPayloadDigest(raw.wavDataUrl, `${label} ${index} audio`));
  });
  return {
    chunkCount: chunks.length,
    totalSamples,
    totalDurationSec: Number(totalDurationSec.toFixed(4)),
    totalEncodedBytes,
    audioSha256: digests,
  };
}

function sanitizedPrivateResult(row, index) {
  const raw = object(row, `Private exact-buffer result ${index}`);
  if (raw.error) fail(`Private exact-buffer result ${index} is an error result`);
  const mode = enumValue(raw.mode, PRIVATE_MODES, `Private exact-buffer result ${index} mode`);
  return {
    mode,
    fixtureOrdinal: index + 1,
    wordCount: finiteNumber(raw.wordCount, `Private exact-buffer result ${index} word count`, { integer: true }),
    wer: finiteNumber(raw.wer, `Private exact-buffer result ${index} WER`),
    accuracyPct: signedFiniteNumber(raw.accuracyPct, `Private exact-buffer result ${index} accuracy`),
    selectedForSaveWer: finiteNumber(raw.selectedForSaveWer, `Private exact-buffer result ${index} selected WER`),
    selectedForSaveAccuracyPct: signedFiniteNumber(raw.selectedForSaveAccuracyPct, `Private exact-buffer result ${index} selected accuracy`),
    sessionPersisted: boolean(raw.sessionPersisted, `Private exact-buffer result ${index} persisted`),
    historyVisible: boolean(raw.historyVisible, `Private exact-buffer result ${index} history`),
    detailVisible: boolean(raw.detailVisible, `Private exact-buffer result ${index} detail`),
    journeyPass: boolean(raw.journeyPass, `Private exact-buffer result ${index} journey`),
    inputLikelyContaminated: boolean(raw.inputLikelyContaminated, `Private exact-buffer result ${index} contamination`),
    fillerPass: optionalBoolean(raw.fillerPass, `Private exact-buffer result ${index} filler pass`),
    meetsWerThreshold: optionalBoolean(raw.meetsWerThreshold, `Private exact-buffer result ${index} WER threshold`),
    privateRuntime: safeRuntimeToken(raw.privateRuntime, `Private exact-buffer result ${index} runtime`),
    privateProvider: safeRuntimeToken(raw.privateProvider, `Private exact-buffer result ${index} provider`),
    privateWebgpuAvailable: optionalBoolean(raw.privateWebgpuAvailable, `Private exact-buffer result ${index} WebGPU`),
    privateCrossOriginIsolated: optionalBoolean(raw.privateCrossOriginIsolated, `Private exact-buffer result ${index} cross-origin isolation`),
    privateWasmThreadCount: optionalFiniteNumber(raw.privateWasmThreadCount, `Private exact-buffer result ${index} WASM threads`, { integer: true }),
    privateCloudFallbackAttempted: optionalBoolean(raw.privateCloudFallbackAttempted, `Private exact-buffer result ${index} cloud fallback`),
    audioFrameStats: {
      count: finiteNumber(object(raw.audioFrameStats, `Private exact-buffer result ${index} audio frames`).count, `Private exact-buffer result ${index} audio frame count`, { integer: true }),
      maxRms: finiteNumber(raw.audioFrameStats.maxRms, `Private exact-buffer result ${index} max RMS`),
      speechFrames: finiteNumber(raw.audioFrameStats.speechFrames, `Private exact-buffer result ${index} speech frames`, { integer: true }),
    },
    inferenceAudio: sanitizedAudioRoute(raw.privateAudioChunks, `Private exact-buffer result ${index} inference audio`),
    utteranceAudio: sanitizedAudioRoute(raw.privateUtteranceAudioChunks, `Private exact-buffer result ${index} utterance audio`),
    timing: {
      canonicalRtf: optionalFiniteNumber(raw.rtf?.canonicalRtf, `Private exact-buffer result ${index} RTF`),
      capturedAudioMs: optionalFiniteNumber(raw.rtf?.capturedAudioMs, `Private exact-buffer result ${index} captured audio`),
      finalizeDecodeMs: optionalFiniteNumber(raw.rtf?.finalizeDecodeMs, `Private exact-buffer result ${index} decode time`),
      totalFinalizeMs: optionalFiniteNumber(raw.rtf?.totalFinalizeMs, `Private exact-buffer result ${index} finalize time`),
      firstTextMs: optionalFiniteNumber(raw.rtf?.firstTextMs, `Private exact-buffer result ${index} first text time`),
    },
  };
}

export function sanitizePrivateExactBufferProof(rawProof) {
  const raw = object(rawProof, 'Private exact-buffer proof');
  const environment = object(raw.environmentProof, 'Private exact-buffer environment');
  if (!Array.isArray(raw.results) || raw.results.length === 0) fail('Private exact-buffer proof results are missing');
  const results = raw.results.map(sanitizedPrivateResult);
  if (!results.some((result) => result.inferenceAudio.audioSha256.length > 0 || result.utteranceAudio.audioSha256.length > 0)) {
    fail('Private exact-buffer proof contains no replayable audio route');
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    kind: 'private-exact-app-buffer-summary',
    environment: {
      releaseProofEligible: boolean(environment.releaseProofEligible, 'Private exact-buffer release eligibility'),
      authMode: enumValue(environment.authMode, new Set(['real', 'mock']), 'Private exact-buffer auth mode'),
      mockAuth: boolean(environment.mockAuth, 'Private exact-buffer mock auth'),
      cdpSameTab: boolean(environment.cdpSameTab, 'Private exact-buffer CDP identity'),
    },
    configuration: {
      privateEngine: safeRuntimeToken(raw.privateEngine, 'Private exact-buffer configured engine'),
      webgpuDisabledForRun: boolean(raw.webgpuDisabledForRun, 'Private exact-buffer WebGPU disablement'),
      injectedMicAudio: boolean(object(raw.injectedMicAudio, 'Private exact-buffer injected audio').enabled, 'Private exact-buffer injected audio state'),
    },
    runner: {
      runnerPass: boolean(raw.runnerPass, 'Private exact-buffer runner pass'),
      gatePass: boolean(raw.gatePass, 'Private exact-buffer gate pass'),
      pass: boolean(raw.pass, 'Private exact-buffer pass'),
      resultCount: results.length,
    },
    results,
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

export function sanitizeAssemblyAiStreamingFile(inputPath, outputPath) {
  rmSync(resolve(outputPath), { force: true });
  writeSanitizedJson(outputPath, sanitizeAssemblyAiStreamingProof(readJson(inputPath, 'AssemblyAI streaming input')));
}

export function sanitizePrivateExactBufferFile(inputPath, outputPath) {
  rmSync(resolve(outputPath), { force: true });
  writeSanitizedJson(outputPath, sanitizePrivateExactBufferProof(readJson(inputPath, 'Private exact-buffer input')));
}

function usage() {
  fail('Usage: sanitize-ci-artifact.mjs <playwright|merge-playwright|lighthouse|assemblyai-streaming|private-exact-buffer> ...');
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(MODULE_PATH)) {
  try {
    const [, , command, ...args] = process.argv;
    if (command === 'playwright' && args.length === 3) sanitizePlaywrightFile(args[0], args[1], args[2]);
    else if (command === 'merge-playwright' && args.length >= 2) mergePlaywrightFiles(args[0], args.slice(1));
    else if (command === 'lighthouse' && args.length === 2) sanitizeLighthouseDirectory(args[0], args[1]);
    else if (command === 'assemblyai-streaming' && args.length === 2) sanitizeAssemblyAiStreamingFile(args[0], args[1]);
    else if (command === 'private-exact-buffer' && args.length === 2) sanitizePrivateExactBufferFile(args[0], args[1]);
    else usage();
  } catch (error) {
    console.error(`CI artifact sanitization failed: ${error.message}`);
    process.exitCode = 1;
  }
}
