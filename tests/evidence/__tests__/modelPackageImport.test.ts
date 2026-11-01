// Real importModelPackage() over temporary roots. Only the installed-runtime verifier module (which
// hashes node_modules under the given root) and the vendor WASM transcriber are stubbed; no model,
// network, account or browser is used.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, webcrypto } from 'node:crypto';
import { CANDIDATES } from '../../../frontend/src/services/transcription/candidateRegistry';
import { MOONSHINE_PACKAGE_FILES } from '../../../frontend/src/services/transcription/modelPackage';

vi.mock('../../../scripts/model-evaluator/runtime-bindings.mjs', () => ({ verifyProjectRuntimeBindings: vi.fn(async () => undefined) }));
// `open` passes through to the real implementation unless a test arms a partial staging-write failure.
const stagingFault = vi.hoisted(() => ({ armed: false, opened: 0 }));
vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof import('node:fs/promises')>();
  const open = async (...args: Parameters<typeof actual.open>) => {
    const handle = await actual.open(...args);
    if (!stagingFault.armed || !String(args[0]).endsWith('.tmp')) return handle;
    stagingFault.opened += 1;
    return Object.assign(Object.create(handle), {
      writeFile: async (data: string) => { await handle.writeFile(data.slice(0, 12)); throw new Error('simulated partial write'); },
      close: () => handle.close(),
    });
  };
  return { ...actual, open, default: { ...actual, open } };
});
const loadSpy = vi.fn();
vi.mock('@moonshine-ai/moonshine-wasm', () => ({
  ModelArch: { SmallStreaming: 4, MediumStreaming: 5 },
  Transcriber: { load: (options: Record<string, unknown>) => { loadSpy(options); return Promise.resolve({
    transcribe: () => ({ lines: [] }), close: vi.fn(),
    createStream: () => ({ start: vi.fn(), addAudio: vi.fn(), transcribe: () => ({ lines: [] }), stop: vi.fn(), close: vi.fn() }) }); } },
}));

const MEDIUM = CANDIDATES['moonshine:streaming-medium'];
const CATALOG = 'frontend/src/services/transcription/model-packages';
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
// Canonical paths: macOS tmpdir sits under the /var -> /private/var symlink, which would trip the
// importer's symlink refusals for the wrong reason and hide whether the intended symlink was seen.
const tempDir = (prefix: string) => realpathSync(mkdtempSync(join(tmpdir(), prefix)));
let root = '';
let source = '';

beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
  root = tempDir('pkg-import-root-');
  source = tempDir('pkg-import-src-');
  loadSpy.mockClear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  rmSync(root, { recursive: true, force: true });
  rmSync(source, { recursive: true, force: true });
});

/** Writes seven local component files and an unsealed descriptor whose URLs point upstream. */
function moonshineDescriptor({ id = 'dropin:moonshine', fill = 3, url = (f: string) => `https://download.moonshine.ai/dropin/${f}` } = {}) {
  const bodies = MOONSHINE_PACKAGE_FILES.map((file, i) => ({ file, body: new Uint8Array(8 + i).fill(fill) }));
  mkdirSync(join(source, 'weights'), { recursive: true });
  for (const { file, body } of bodies) writeFileSync(join(source, 'weights', file), body);
  const descriptor = join(source, `${id.replace(/:/g, '_')}-${fill}.json`);
  writeFileSync(descriptor, JSON.stringify({ schemaVersion: 1, kind: 'speaksharp-model-package', id,
    engine: MEDIUM.engine, runtime: MEDIUM.runtime, model: MEDIUM.model, execution: MEDIUM.execution,
    assets: { files: bodies.map(({ file, body }) => ({ path: `weights/${file}`, url: url(file), bytes: body.byteLength, sha256: sha(body) })) },
    license: 'MIT (test bytes)' }));
  return { descriptor, bodies };
}
const importer = async () => (await import('../../../scripts/model-evaluator/model-package.mjs')).importModelPackage;
const catalogFiles = () => existsSync(join(root, CATALOG)) ? readdirSync(join(root, CATALOG)) : [];
const publicModels = () => existsSync(join(root, 'frontend/public/models')) ? readdirSync(join(root, 'frontend/public/models'), { recursive: true }) : [];

describe('a Moonshine weights package imports as a descriptor only', () => {
  it('imports through the real CLI function, reaches the Node catalog and loads only the verified bytes', async () => {
    const { descriptor, bodies } = moonshineDescriptor();
    const result = await (await importer())(root, descriptor);
    expect(catalogFiles()).toEqual(['dropin_moonshine.json']);
    expect(publicModels(), 'upstream weights are never stored in the repository').toEqual([]);

    const { readCandidateCatalog } = await import('../../../scripts/model-evaluator/product-campaign');
    const rejected: Array<{ file: string; code: string }> = [];
    const candidate = readCandidateCatalog(root, rejected)[result.candidateId];
    expect(rejected).toEqual([]);
    expect(candidate).toMatchObject({ engine: 'moonshine-streaming', comparisonReady: false, activationReady: false });
    expect(candidate.modelPackage?.digest).toBe(result.packageDigest);

    // Consent TERMS only: the quoted maximum is the package total. Enforcement is the product's gate.
    const { consentTermsFor } = await import('../../../frontend/src/services/transcription/modelConsent');
    expect(consentTermsFor(candidate).maxBytes).toBe(bodies.reduce((n, { body }) => n + body.byteLength, 0));

    const fetchImpl = vi.fn(async (url: string) => {
      const hit = bodies.find(({ file }) => url === `https://download.moonshine.ai/dropin/${file}`);
      if (!hit) throw new Error(`unexpected fetch to ${url}`);
      return { ok: true, status: 200, arrayBuffer: async () => hit.body.slice().buffer } as unknown as Response;
    });
    vi.stubGlobal('fetch', fetchImpl);
    const { MoonshineStreamingEngine } = await import('../../../frontend/src/services/transcription/engines/MoonshineStreamingEngine');
    const engine = new MoonshineStreamingEngine({ candidateId: 'moonshine:streaming-medium', modelArch: 'MOONSHINE_STREAMING_MEDIUM',
      candidateSource: () => candidate });
    expect((await engine.init()).isOk).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(MOONSHINE_PACKAGE_FILES.length);
    const files = (loadSpy.mock.calls[0][0] as { files: Record<string, Uint8Array> }).files;
    for (const { file, body } of bodies) expect(sha(files[file])).toBe(sha(body));
  });

  it('accepts an identical reimport and preserves the original against a changed digest', async () => {
    const run = await importer();
    const first = moonshineDescriptor();
    const imported = await run(root, first.descriptor);
    await expect(run(root, first.descriptor)).resolves.toMatchObject({ packageDigest: imported.packageDigest });
    const original = readFileSync(join(root, CATALOG, 'dropin_moonshine.json'), 'utf8');
    const changed = moonshineDescriptor({ fill: 4 });
    await expect(run(root, changed.descriptor)).rejects.toThrow();
    expect(readFileSync(join(root, CATALOG, 'dropin_moonshine.json'), 'utf8')).toBe(original);
    expect(catalogFiles(), 'no staging file survives').toEqual(['dropin_moonshine.json']);
  });
});

describe('import refusals leave nothing behind', () => {
  it('a tampered LAST component publishes no descriptor and copies nothing', async () => {
    const { descriptor } = moonshineDescriptor();
    writeFileSync(join(source, 'weights', 'tokenizer.bin'), new Uint8Array(14).fill(9));
    await expect((await importer())(root, descriptor)).rejects.toThrow('PACKAGE_IMPORT_ASSET_MISMATCH');
    expect(catalogFiles()).toEqual([]);
    expect(publicModels()).toEqual([]);
  });

  it.each([
    ['plain HTTP', (f: string) => `http://download.moonshine.ai/dropin/${f}`],
    ['a self-hosted traversal', (f: string) => `/models/../escape/${f}`],
  ])('refuses %s component URLs', async (_, url) => {
    const { descriptor } = moonshineDescriptor({ url });
    await expect((await importer())(root, descriptor)).rejects.toThrow();
    expect(catalogFiles()).toEqual([]);
  });

  it('refuses a symlinked source component', async () => {
    const { descriptor } = moonshineDescriptor();
    const outside = join(source, 'outside.bin');
    writeFileSync(outside, readFileSync(join(source, 'weights', 'tokenizer.bin')));
    rmSync(join(source, 'weights', 'tokenizer.bin'));
    symlinkSync(outside, join(source, 'weights', 'tokenizer.bin'));
    await expect((await importer())(root, descriptor)).rejects.toThrow('PACKAGE_IMPORT_PATH_INVALID');
    expect(catalogFiles()).toEqual([]);
  });

  it('refuses a symlinked catalog destination and writes nothing through it', async () => {
    const { descriptor } = moonshineDescriptor();
    const elsewhere = tempDir('pkg-import-elsewhere-');
    try {
      mkdirSync(join(root, 'frontend/src/services/transcription'), { recursive: true });
      symlinkSync(elsewhere, join(root, CATALOG));
      await expect((await importer())(root, descriptor)).rejects.toThrow('PACKAGE_IMPORT_SYMLINK_DESTINATION');
      expect(readdirSync(elsewhere)).toEqual([]);
    } finally { rmSync(elsewhere, { recursive: true, force: true }); }
  });

  it('keeps refusing an upstream asset for an engine whose package can carry executable runtime bytes', async () => {
    const parakeet = CANDIDATES['parakeet:tdt-v3:int8'];
    const files = parakeet.assets.files!.map(f => {
      if (/\.(?:[cm]?js|wasm)$/i.test(f.path)) return { ...f, url: f.url! };
      const body = new TextEncoder().encode(`fixture ${f.path}`);
      writeFileSync(join(source, f.path), body);
      return { ...f, url: f.url!, bytes: body.byteLength, sha256: sha(body) };
    });
    const descriptor = join(source, 'parakeet.json');
    writeFileSync(descriptor, JSON.stringify({ schemaVersion: 1, kind: 'speaksharp-model-package', id: 'dropin:parakeet',
      engine: parakeet.engine, runtime: parakeet.runtime, model: parakeet.model, execution: parakeet.execution,
      assets: { files }, license: 'fixture only' }));
    await expect((await importer())(root, descriptor)).rejects.toThrow('PACKAGE_IMPORT_REQUIRES_LOCAL_ASSETS');
    expect(catalogFiles()).toEqual([]);
    expect(publicModels()).toEqual([]);
  });
});

/** A self-hosted Whisper package with small local component files under the source directory. */
function whisperDescriptor() {
  const base = CANDIDATES['v2:base.en'];
  const files = base.assets.files!.map(f => {
    const body = new TextEncoder().encode(`whisper ${f.path}`);
    mkdirSync(join(source, f.path, '..'), { recursive: true });
    writeFileSync(join(source, f.path), body);
    return { path: f.path, url: `/models/dropin-whisper/${f.path}`, bytes: body.byteLength, sha256: sha(body) };
  });
  const descriptor = join(source, 'whisper.json');
  writeFileSync(descriptor, JSON.stringify({ schemaVersion: 1, kind: 'speaksharp-model-package', id: 'dropin:whisper',
    engine: base.engine, runtime: base.runtime, model: { ...base.model, device: 'wasm' },
    execution: { ...base.execution, localModelId: 'dropin-whisper' },
    assets: { servedFrom: '/models/dropin-whisper', files }, license: 'fixture only' }));
  return { descriptor, files };
}

// An existing final destination counts only as a regular file reached without following a link.
// Matching CONTENT behind a symlink is the dangerous case: it would otherwise pass as identical.
describe('existing destinations are never read through a symlink', () => {
  it('refuses a matching-content descriptor that is a symlink out of the catalog', async () => {
    const run = await importer();
    const { descriptor } = moonshineDescriptor();
    await run(root, descriptor);
    const published = join(root, CATALOG, 'dropin_moonshine.json');
    const outside = join(source, 'outside-descriptor.json');
    writeFileSync(outside, readFileSync(published));
    rmSync(published);
    symlinkSync(outside, published);
    await expect(run(root, descriptor)).rejects.toThrow('PACKAGE_IMPORT_SYMLINK_DESTINATION');
    expect(catalogFiles(), 'no staging residue beside the link').toEqual(['dropin_moonshine.json']);
  });

  it('refuses a matching-content asset file that is a symlink, copying and publishing nothing', async () => {
    const { descriptor, files } = whisperDescriptor();
    const [first] = files;
    const destination = join(root, 'frontend/public', first.url.slice(1));
    const outside = join(source, 'outside-asset');
    writeFileSync(outside, readFileSync(join(source, first.path)));
    mkdirSync(join(destination, '..'), { recursive: true });
    symlinkSync(outside, destination);
    await expect((await importer())(root, descriptor)).rejects.toThrow('PACKAGE_IMPORT_SYMLINK_DESTINATION');
    expect(catalogFiles()).toEqual([]);
    // No other component was copied: the refusal happened during verification, before any write.
    for (const f of files.slice(1)) expect(existsSync(join(root, 'frontend/public', f.url.slice(1)))).toBe(false);
  });
});

describe('a failed staging write leaves no descriptor and no residue', () => {
  it('removes only its own partially written staging file', async () => {
    const { descriptor } = moonshineDescriptor();
    stagingFault.armed = true; stagingFault.opened = 0;
    try {
      await expect((await importer())(root, descriptor)).rejects.toThrow('simulated partial write');
    } finally { stagingFault.armed = false; }
    expect(stagingFault.opened, 'the fault reached the staging write').toBe(1);
    expect(catalogFiles(), 'neither a descriptor nor a .tmp file remains').toEqual([]);
  });
});

describe('self-hosted Whisper import is unchanged', () => {
  it('still verifies and copies every /models component before publishing', async () => {
    const { descriptor, files } = whisperDescriptor();
    await (await importer())(root, descriptor);
    for (const f of files) {
      expect(sha(readFileSync(join(root, 'frontend/public', f.url.slice(1))))).toBe(f.sha256);
    }
    expect(catalogFiles()).toEqual(['dropin_whisper.json']);
  });
});
