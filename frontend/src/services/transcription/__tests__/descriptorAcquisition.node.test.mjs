import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';

// Execute the facade's actual acquisition/adoption/termination methods with a child acquisition
// double. Base-class scheduling is synchronous here; this is not a browser or base lifecycle test.
async function harness({ holdConstructor = false, releaseFails = false } = {}) {
  const file = 'frontend/src/services/transcription/engines/PrivateSTT.ts';
  const source = process.env.FACADE_SOURCE_REF
    ? execFileSync('git', ['show', `${process.env.FACADE_SOURCE_REF}:${file}`], { encoding: 'utf8' })
    : await readFile(new URL('../engines/PrivateSTT.ts', import.meta.url), 'utf8');
  const cleanup = source.slice(source.indexOf('    protected async onDestroy()'),
    source.indexOf('    public async transcribe('));
  const init = source.slice(source.indexOf('    private async initDescriptorEngine('),
    source.indexOf('    private async initSafeEngine('));
  const terminate = source.slice(source.indexOf('    async terminate()'), source.indexOf('\n}\n\nexport function createPrivateSTT'));
  const base = await readFile(new URL('../../../contracts/STTEngine.ts', import.meta.url), 'utf8');
  const destroy = base.slice(base.indexOf('  async destroy()'), base.indexOf('  protected abstract onDestroy()'));
  const abort = new AbortController();
  let releases = 0, starts = 0, resolveConstructor;
  const constructorBarrier = new Promise(resolve => { resolveConstructor = resolve; });
  const child = {
    async init() {
      starts++;
      await new Promise(resolve => abort.signal.addEventListener('abort', resolve, { once: true }));
      return { isOk: false, error: new Error('acquisition aborted') };
    },
    async terminate() { releases++; abort.abort(); if (releaseFails) throw new Error('release failed'); },
  };
  const code = `class Facade {
    acquiringEngines = new Set(); engineReleases = new WeakMap();
    lifecycleGeneration = 0; isTerminated = false; engine = null; _engineType = null;
    options = {}; failure = null;
    resolvedSelection() { return { candidate: { id: 'granite:turboctc-q4f16', engine: 'granite-ctc', execution: {} } }; }
    beginTermination() { this.lifecycleGeneration++; this.isTerminated = true; return true; }
    runTeardown(work) { return work(); } async awaitTeardown() {} async stop() {}
    recordReleaseFailure(error) { this.failure = error; } retainedReleaseFailure() { return this.failure; }
    ${cleanup} ${init} ${terminate} ${destroy}
  }; new Facade()`;
  const facade = runInNewContext(stripTypeScriptTypes(code), {
    Error, Promise, Set, WeakMap,
    logger: { info() {}, warn() {} },
    MOONSHINE_ARCH_BY_CANDIDATE: {}, validateEngine() {}, assertEngineCanDecode() {},
    constructPrivateEngine: async () => { if (holdConstructor) await constructorBarrier; return child; },
    Result: { ok: data => ({ isOk: true, data }), err: error => ({ isOk: false, error }) },
  });
  return { facade, abort, child, resolveConstructor, releases: () => releases, starts: () => starts };
}

test('facade termination aborts pending descriptor acquisition before it can finish or adopt', async () => {
  const h = await harness();
  const pending = h.facade.initDescriptorEngine('granite-ctc');
  await new Promise(resolve => setImmediate(resolve));
  await h.facade.terminate();
  const abortedByFacade = h.abort.signal.aborted;
  // Let the unchanged old implementation settle too, so the negative control cannot hang.
  if (!abortedByFacade) h.abort.abort();
  const result = await pending;
  assert.equal(abortedByFacade, true);
  assert.equal(result.isOk, false);
  assert.equal(h.releases(), 1);
  assert.equal(h.facade.engine, null);
  assert.equal(h.facade._engineType, null);
});

test('termination during async construction prevents acquisition from starting', async () => {
  const h = await harness({ holdConstructor: true });
  const pending = h.facade.initDescriptorEngine('granite-ctc');
  await h.facade.terminate();
  h.resolveConstructor();
  assert.equal((await pending).isOk, false);
  assert.equal(h.starts(), 0);
  assert.equal(h.releases(), 1);
});

test('inherited destroy also aborts pending acquisition through the facade cleanup hook', async () => {
  const h = await harness();
  const pending = h.facade.initDescriptorEngine('granite-ctc');
  await new Promise(resolve => setImmediate(resolve));
  await h.facade.destroy();
  assert.equal(h.abort.signal.aborted, true);
  assert.equal((await pending).isOk, false);
  assert.equal(h.releases(), 1);
});

test('failed pending-child release is reported and retained, never retried as successful', async () => {
  const h = await harness({ releaseFails: true });
  const pending = h.facade.initDescriptorEngine('granite-ctc');
  await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(h.facade.terminate(), /release uncertain/);
  assert.equal((await pending).isOk, false);
  assert.equal(h.releases(), 1);
  assert.match(h.facade.failure.message, /release failed/);
});
