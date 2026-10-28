import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, resolve, basename, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool';
import process from 'node:process';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const dependencies = '/Users/fibonacci/.cache/codex-runtimes/codex-primary-runtime/dependencies';
const python = `${dependencies}/python/bin/python3`;
const office = `${dependencies}/bin/override/soffice`;
const workbookPath = 'product_release/work_items/financial-analysis/SpeakSharp_Updated_Financial_Model_2026-10-12.xlsx';
const sourceHead = '764890c3f475825e8b2b194331522be6840f5e5c';
const source = '/private/tmp/cli-dev-1599-evidence/source-764890c3.xlsx';
const final = resolve(repo, workbookPath);
const output = await fs.mkdtemp('/private/tmp/cli-dev-1599-evidence/native-');
await fs.writeFile(source, execFileSync(`${dependencies}/bin/fallback/git`, ['-C', repo, 'show', `${sourceHead}:${workbookPath}`]));
const read = file => JSON.parse(execFileSync(python, [join(here, 'inspect-native.py'), file], { encoding: 'utf8' }));
const receipts = [];
async function recalc(file, label) {
  const directory = join(output, label); await fs.mkdir(directory, { recursive: true });
  execFileSync(office, [`-env:UserInstallation=${pathToFileURL(join(directory, 'profile')).href}`,
    '--headless', '--convert-to', 'xlsx', '--outdir', directory, file],
  { encoding: 'utf8', timeout: 90_000, maxBuffer: 1024 * 1024 });
  const recalculated = join(directory, basename(file));
  const result = read(recalculated);
  receipts.push({ label, status: result.values['Checks!A18'], linkedStatus: result.values['Key!C62'],
    formulaCount: result.formulaCount, errors: result.errors.length });
  return { ...result, file: recalculated };
}
async function variant(input, label, edits) {
  const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(input));
  for (const [sheet, address, value, formula = false] of edits) {
    const range = workbook.worksheets.getItem(sheet).getRange(address);
    if (formula) range.formulas = [[value]];
    else if (value === null) range.clear({ applyTo: 'contents' });
    else range.values = [[value]];
  }
  workbook.recalculate();
  const file = join(output, `${label}.xlsx`);
  await (await SpreadsheetFile.exportXlsx(workbook)).save(file);
  return file;
}
function status(result, expected) {
  assert.equal(result.values['Checks!A18'], `MODEL STATUS: ${expected}`);
  assert.equal(result.values['Key!C62'], `MODEL STATUS: ${expected}`);
}
function sameValues(a, b) {
  assert.deepEqual(Object.keys(a.values).sort(), Object.keys(b.values).sort());
  for (const [key, value] of Object.entries(a.values)) {
    const other = b.values[key];
    if (typeof value === 'number' && typeof other === 'number') {
      assert.ok(Math.abs(value - other) <= 1e-8 * Math.max(1, Math.abs(value)), `${key}: ${value} != ${other}`);
    } else assert.equal(other, value, key);
  }
}

test('1599 status correction: native recalculation and preserved scenario outputs', async t => {
  const baseline = await recalc(source, 'source-default');
  const corrected = await recalc(final, 'fixed-default');
  await t.test('default remains PASS, all formula results unchanged with zero errors', () => {
    status(baseline, 'PASS'); status(corrected, 'PASS');
    assert.equal(corrected.errors.length, 0); assert.equal(corrected.formulaCount, baseline.formulaCount);
    sameValues(baseline, corrected);
  });
  const edits = [['Assumptions', 'B33', 'bad']];
  const brokenSource = await recalc(await variant(source, 'source-text', edits), 'source-text-recalc');
  const brokenFixed = await recalc(await variant(final, 'fixed-text', edits), 'fixed-text-recalc');
  await t.test('original text B33 falsely passes; corrected status FAILs in both places', () => {
    status(brokenSource, 'PASS'); status(brokenFixed, 'FAIL');
    assert.ok(brokenFixed.errors.includes('Checks!F32'));
    assert.ok(brokenFixed.errors.includes('Price Sensitivity!B76'));
  });
  for (const [label, changes] of [
    ['blank-check', [['Checks', 'F5', null]]],
    ['error-check', [['Checks', 'F32', '=1/0', true]]],
    ['unrecognized-check', [['Checks', 'F5', 'SKIP']]],
    ['literal-fail', [['Checks', 'F5', 'FAIL']]],
    ['swapped-months', [['Forecast 12M', 'B3', 2], ['Forecast 12M', 'C3', 1]]],
    ['equal-sum-duplicate', [['Forecast 12M', 'B3', 2], ['Forecast 12M', 'C3', 2], ['Forecast 12M', 'D3', 2]]],
    ['blank-month', [['Forecast 12M', 'B3', null]]],
    ['cap-below-paying', [['Launch Cap Plan', 'B8', 1]]],
    ['two-month-trial', [['Assumptions', 'B12', 2]]],
  ]) {
    await t.test(`${label} cannot PASS`, async () => {
      status(await recalc(await variant(final, label, changes), label + '-recalc'), 'FAIL');
    });
  }
  for (const [label, choice] of [['tools20', 'One at $20'], ['tools40', 'Two at $20'], ['tools-excluded', 'Exclude']]) {
    await t.test(`${label} preserves every native output and restores PASS`, async () => {
      const edits = [['Assumptions', 'B50', choice]];
      const oldResult = await recalc(await variant(source, label + '-source', edits), label + '-source-recalc');
      const newResult = await recalc(await variant(final, label + '-fixed', edits), label + '-fixed-recalc');
      status(oldResult, 'PASS'); status(newResult, 'PASS');
      assert.equal(newResult.errors.length, 0); sameValues(oldResult, newResult);
    });
  }
  await t.test('requested openpyxl save/recalculate round-trip preserves all outputs', async () => {
    const roundtrip = join(output, 'roundtrip.xlsx');
    execFileSync(python, ['-c', 'import openpyxl,sys; openpyxl.load_workbook(sys.argv[1]).save(sys.argv[2])', final, roundtrip]);
    const result = await recalc(roundtrip, 'roundtrip-recalc');
    status(result, 'PASS'); assert.equal(result.errors.length, 0); sameValues(corrected, result);
  });
  await fs.writeFile(join(here, 'native-receipts.json'), JSON.stringify({ sourceHead,
    sourceSha256: createHash('sha256').update(await fs.readFile(source)).digest('hex'),
    correctedSha256: createHash('sha256').update(await fs.readFile(final)).digest('hex'),
    testedAt: new Date().toISOString(), receipts }, null, 2));
  process.stdout.write(`Native receipts saved; ${receipts.length} recalculations.\n`);
});
