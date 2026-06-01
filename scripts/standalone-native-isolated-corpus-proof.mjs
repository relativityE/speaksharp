import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const execFileAsync = promisify(execFile);

const OUT = process.env.NATIVE_HARNESS_OUT || `/private/tmp/speaksharp-native-standalone-isolated-harvard10-${Date.now()}.json`;
const USE_FAKE_AUDIO_CAPTURE = process.env.NATIVE_HARNESS_FAKE_AUDIO_CAPTURE === 'true';
const FIXTURES = (process.env.STT_FIXTURES || 'h1_1,h1_2,h1_3,h1_4,h1_5,h1_6,h1_7,h1_8,h1_9,h1_10')
  .split(',')
  .map((fixture) => fixture.trim())
  .filter(Boolean);

function compact(text) {
  return (text || '').replace(/\s+/g, ' ').trim();
}

function normalizeForWer(text) {
  return compact(text)
    .toLowerCase()
    .replace(/[^\w\s']/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function words(text) {
  return normalizeForWer(text).split(/\s+/).filter(Boolean);
}

function truthWordRecall(reference, hypothesis) {
  const refWords = new Set(words(reference));
  if (refWords.size === 0) return 1;
  const hypWords = new Set(words(hypothesis));
  let hits = 0;
  for (const word of refWords) {
    if (hypWords.has(word)) hits += 1;
  }
  return hits / refWords.size;
}

function calculateWordErrorRate(reference, hypothesis) {
  const ref = words(reference);
  const hyp = words(hypothesis);
  if (ref.length === 0) return hyp.length === 0 ? 0 : 1;
  const dp = Array.from({ length: ref.length + 1 }, () => Array(hyp.length + 1).fill(0));
  for (let i = 0; i <= ref.length; i += 1) dp[i][0] = i;
  for (let j = 0; j <= hyp.length; j += 1) dp[0][j] = j;
  for (let i = 1; i <= ref.length; i += 1) {
    for (let j = 1; j <= hyp.length; j += 1) {
      const cost = ref[i - 1] === hyp[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[ref.length][hyp.length] / ref.length;
}

async function loadFixtures() {
  const sourcePath = path.resolve('tests/fixtures/stt-isomorphic/harvard-sentences.ts');
  const source = await readFile(sourcePath, 'utf8');
  const matches = [...source.matchAll(/\{\s*id:\s*'([^']+)'\s*,\s*transcript:\s*"([^"]+)"\s*\}/g)];
  const byId = new Map();
  for (const [, id, transcript] of matches) {
    byId.set(id, {
      id,
      transcript,
      audioPath: path.resolve(`tests/fixtures/stt-isomorphic/audio/${id}.wav`),
    });
  }
  return FIXTURES.map((id) => {
    const fixture = byId.get(id);
    if (!fixture) throw new Error(`Unknown fixture ${id}`);
    return fixture;
  });
}

function average(rows, selector) {
  if (!rows.length) return null;
  return rows.reduce((sum, row) => sum + selector(row), 0) / rows.length;
}

const aggregate = {
  startedAt: new Date().toISOString(),
  mode: 'standalone-native',
  inputRoute: USE_FAKE_AUDIO_CAPTURE
    ? 'chrome-fake-audio-capture'
    : 'real browser getUserMedia with afplay through the physical speaker/mic path',
  fixtureCount: FIXTURES.length,
  rowArtifacts: [],
  results: [],
  stderr: [],
};

for (const fixture of await loadFixtures()) {
  const rowOut = `/private/tmp/speaksharp-native-standalone-isolated-${fixture.id}-${Date.now()}.json`;
  const env = {
    ...process.env,
    HEADLESS: process.env.HEADLESS ?? 'true',
    NATIVE_HARNESS_FAKE_AUDIO_CAPTURE: USE_FAKE_AUDIO_CAPTURE ? 'true' : 'false',
    NATIVE_HARNESS_AUDIO_FILE: fixture.audioPath,
    NATIVE_HARNESS_AUDIO_SOURCE: 'fixture',
    NATIVE_HARNESS_OUT: rowOut,
    NATIVE_HARNESS_POST_AUDIO_WAIT_MS: process.env.NATIVE_HARNESS_POST_AUDIO_WAIT_MS ?? '4000',
    NATIVE_HARNESS_LISTEN_MS: process.env.NATIVE_HARNESS_LISTEN_MS ?? '12000',
  };

  try {
    await execFileAsync('node', ['scripts/standalone-native-webspeech-proof.mjs'], {
      cwd: process.cwd(),
      env,
      timeout: 120_000,
    });
  } catch (error) {
    aggregate.stderr.push({
      fixture: fixture.id,
      error: error instanceof Error ? error.message : String(error),
      stdout: error?.stdout,
      stderr: error?.stderr,
    });
  }

  aggregate.rowArtifacts.push({ fixture: fixture.id, path: rowOut });
  try {
    const row = JSON.parse(await readFile(rowOut, 'utf8'));
    const transcript = compact(row.harness?.visibleTranscript || row.harness?.finalTranscript || '');
    const wer = calculateWordErrorRate(fixture.transcript, transcript);
    const recall = truthWordRecall(fixture.transcript, transcript);
    const transcriptWordCount = words(transcript).length;
    const inputLikelyContaminated = transcriptWordCount > 0 && (
      recall === 0 ||
      (transcriptWordCount >= 6 && recall < 0.35)
    );
    const result = {
      fixture: fixture.id,
      truth: fixture.transcript,
      transcript,
      wer,
      accuracyPct: Number(((1 - wer) * 100).toFixed(2)),
      truthWordRecall: Number(recall.toFixed(4)),
      inputLikelyContaminated,
      pass: row.pass,
      rowArtifact: rowOut,
      consoleEventCount: row.consoleEvents?.length ?? 0,
      pageErrorCount: row.pageErrors?.length ?? 0,
    };
    aggregate.results.push(result);
    console.log(`STANDALONE_NATIVE_ISOLATED_ROW ${JSON.stringify({
      fixture: result.fixture,
      wer: result.wer,
      accuracyPct: result.accuracyPct,
      transcript: result.transcript.slice(0, 160),
    })}`);
  } catch (error) {
    aggregate.results.push({
      fixture: fixture.id,
      rowArtifact: rowOut,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

const validRows = aggregate.results.filter((row) => typeof row.wer === 'number');
const uncontaminatedRows = aggregate.results.filter((row) => typeof row.wer === 'number' && !row.inputLikelyContaminated);
aggregate.finishedAt = new Date().toISOString();
aggregate.validRows = validRows.length;
aggregate.uncontaminatedRows = uncontaminatedRows.length;
aggregate.averageWer = average(validRows, (row) => row.wer);
aggregate.averageAccuracyPct = aggregate.averageWer == null
  ? null
  : Number(((1 - aggregate.averageWer) * 100).toFixed(2));
aggregate.runnerPass = aggregate.results.length === FIXTURES.length && aggregate.results.every((row) => !row.error);
aggregate.gatePass = aggregate.runnerPass && uncontaminatedRows.length === FIXTURES.length;

await writeFile(OUT, JSON.stringify(aggregate, null, 2));
console.log(`STANDALONE_NATIVE_ISOLATED_EVIDENCE ${JSON.stringify({
  out: OUT,
  runnerPass: aggregate.runnerPass,
  gatePass: aggregate.gatePass,
  resultCount: aggregate.results.length,
  averageWer: aggregate.averageWer,
  averageAccuracyPct: aggregate.averageAccuracyPct,
})}`);
