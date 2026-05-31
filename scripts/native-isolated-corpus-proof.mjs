import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const execFileAsync = promisify(execFile);

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:5174';
const OUT = process.env.STT_CORPUS_OUT || `/private/tmp/speaksharp-native-isolated-harvard10-${Date.now()}.json`;
const FIXTURES = (process.env.STT_FIXTURES || 'h1_1,h1_2,h1_3,h1_4,h1_5,h1_6,h1_7,h1_8,h1_9,h1_10')
  .split(',')
  .map((fixture) => fixture.trim())
  .filter(Boolean);

function average(rows, selector) {
  if (!rows.length) return null;
  return rows.reduce((sum, row) => sum + selector(row), 0) / rows.length;
}

const aggregate = {
  startedAt: new Date().toISOString(),
  baseUrl: BASE_URL,
  mode: 'native',
  inputRoute: 'chrome-fake-audio-capture',
  fixtureCount: FIXTURES.length,
  rowArtifacts: [],
  results: [],
  stdout: [],
  stderr: [],
};

for (const fixture of FIXTURES) {
  const audioPath = path.resolve(`tests/fixtures/stt-isomorphic/audio/${fixture}.wav`);
  const rowOut = `/private/tmp/speaksharp-native-isolated-${fixture}-${Date.now()}.json`;
  const env = {
    ...process.env,
    BASE_URL,
    HEADLESS: process.env.HEADLESS ?? 'true',
    STT_AUTH: process.env.STT_AUTH ?? 'existing',
    STT_MODES: 'native',
    STT_FIXTURES: fixture,
    STT_USE_FAKE_AUDIO_CAPTURE: 'true',
    STT_FAKE_AUDIO_FILE: audioPath,
    STT_CORPUS_OUT: rowOut,
    STT_POST_PLAYBACK_WAIT_MS: process.env.STT_POST_PLAYBACK_WAIT_MS ?? '4000',
    STT_FIRST_TEXT_TIMEOUT_MS: process.env.STT_FIRST_TEXT_TIMEOUT_MS ?? '15000',
  };

  try {
    const { stdout, stderr } = await execFileAsync('node', ['scripts/manual-stt-corpus-proof.mjs'], {
      cwd: process.cwd(),
      env,
      timeout: 180_000,
    });
    aggregate.stdout.push({ fixture, stdout });
    if (stderr) aggregate.stderr.push({ fixture, stderr });
  } catch (error) {
    aggregate.stderr.push({
      fixture,
      error: error instanceof Error ? error.message : String(error),
      stdout: error?.stdout,
      stderr: error?.stderr,
    });
  }

  aggregate.rowArtifacts.push({ fixture, path: rowOut });
  try {
    const rowEvidence = JSON.parse(await readFile(rowOut, 'utf8'));
    const result = rowEvidence.results?.[0] ?? {
      fixture,
      error: 'row_artifact_missing_result',
    };
    aggregate.results.push({
      ...result,
      rowArtifact: rowOut,
      rowRunnerPass: rowEvidence.runnerPass,
      rowGatePass: rowEvidence.gatePass,
    });
    console.log(`NATIVE_ISOLATED_ROW ${JSON.stringify({
      fixture,
      wer: result.wer,
      accuracyPct: result.accuracyPct,
      firstTextMs: result.firstText?.timestampMs,
      transcript: result.transcript?.slice(0, 160),
      journeyPass: result.journeyPass,
      verdict: result.verdict,
    })}`);
  } catch (error) {
    aggregate.results.push({
      fixture,
      rowArtifact: rowOut,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

const validRows = aggregate.results.filter((row) => typeof row.wer === 'number' && !row.inputLikelyContaminated);
aggregate.finishedAt = new Date().toISOString();
aggregate.validRows = validRows.length;
aggregate.averageWer = average(validRows, (row) => row.wer);
aggregate.averageAccuracyPct = aggregate.averageWer == null
  ? null
  : Number(((1 - aggregate.averageWer) * 100).toFixed(2));
aggregate.journeyPassCount = aggregate.results.filter((row) => row.journeyPass).length;
aggregate.runnerPass = aggregate.results.length === FIXTURES.length && aggregate.results.every((row) => !row.error);
aggregate.gatePass = aggregate.runnerPass && validRows.length === FIXTURES.length && aggregate.journeyPassCount === FIXTURES.length;

await writeFile(OUT, JSON.stringify(aggregate, null, 2));
console.log(`NATIVE_ISOLATED_EVIDENCE ${JSON.stringify({
  out: OUT,
  runnerPass: aggregate.runnerPass,
  gatePass: aggregate.gatePass,
  resultCount: aggregate.results.length,
  validRows: aggregate.validRows,
  averageWer: aggregate.averageWer,
  averageAccuracyPct: aggregate.averageAccuracyPct,
})}`);
