import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const root = process.cwd();
const require = createRequire(resolve(root, 'package.json'));
const ts = require('typescript');
const { chromium } = require('playwright');
function compile(source, scope = {}) {
  const module = { exports: {} };
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  runInNewContext(js, { module, exports: module.exports, require, process, console, setTimeout, clearTimeout, ...scope });
  return module.exports;
}
const mic = compile(readFileSync(resolve(root, 'tests/helpers/micControls.ts'), 'utf8'));
const reflex = compile(readFileSync(resolve(root, 'tests/live/helpers/rwtHumanReflex.ts'), 'utf8'));
const helperPath = 'tests/live/helpers/benchmark-utils.ts';
function startFrom(source) {
  const file = ts.createSourceFile(helperPath, source, ts.ScriptTarget.Latest, true);
  const fn = file.statements.find((n) => ts.isFunctionDeclaration(n) && n.name?.text === 'startBenchmarkRecording');
  assert.ok(fn, 'actual helper function must exist');
  return compile(fn.getText(file), { ...mic, activeHumanReflexMs: reflex.activeHumanReflexMs,
    logBenchmarkPhase: async () => undefined,
    collectBenchmarkPreconditionSnapshot: async () => ({ offlineFixture: true }),
  }).startBenchmarkRecording;
}
const baseline = startFrom(execFileSync('git', ['show', '5e69a9d801bf35135b746cf99d1f6080fa0ecfa0:' + helperPath], { cwd: root, encoding: 'utf8' }));
const corrected = startFrom(readFileSync(resolve(root, helperPath), 'utf8'));

test('native Chromium: original actionability race, corrected exclusion and real reflex timing', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const fixture = async () => {
      await page.setContent('<button data-testid="mic-start">Start</button>');
      await page.evaluate(() => {
        document.documentElement.setAttribute('data-model-status', 'ready');
        window.__probeActivations = [];
        document.querySelector('button').addEventListener('click', (event) => window.__probeActivations.push(event.currentTarget.getAttribute('data-testid')));
      });
    };
    await fixture();
    const handle = await page.$('button');
    const proto = Object.getPrototypeOf(handle);
    const nativeClick = proto.click;
    proto.click = async function (...args) {
      await this.evaluate((button) => {
        button.disabled = true;
        setTimeout(() => { button.setAttribute('data-testid', 'mic-retry'); button.disabled = false; }, 50);
      });
      return nativeClick.apply(this, args);
    };
    try {
      await baseline(page, 'native-baseline');
      assert.deepEqual(await page.evaluate(() => window.__probeActivations), ['mic-retry']);
      await fixture();
      await assert.rejects(corrected(page, 'native-corrected'), /identity.*activation/);
      assert.deepEqual(await page.evaluate(() => window.__probeActivations), []);
      console.log('BASELINE native click activated Retry; CORRECTED native click rejected with zero product activations');
    } finally { proto.click = nativeClick; await handle.dispose(); }
    for (const ms of [500, 1000]) {
      await fixture();
      const release = reflex.applyHumanReflex(page, ms);
      try {
        const begin = performance.now();
        await corrected(page, 'native-reflex-' + ms);
        assert.ok(performance.now() - begin >= ms - 10);
        assert.deepEqual(await page.evaluate(() => window.__probeActivations), ['mic-start']);
        console.log('Native pinned Start preserved configured reflex ' + ms + 'ms, exactly one product activation');
      } finally { release(); }
    }
  } finally { await browser.close(); }
});
