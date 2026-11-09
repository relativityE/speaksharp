// #1760 Increment A: the package importer and adoption staging, driven through the real command functions.
// Codex (7819b055): Moonshine packages must use https upstream pins, but the importer accepted only /models/
// URLs, so no Moonshine package could ever import. Review finding B: an adoption row with any 64-hex
// evidence hash could make a package the production default; staging now writes an inert proposal.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createHash, webcrypto } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { CANDIDATES } from '../../../frontend/src/services/transcription/candidateRegistry';
import { sealModelPackage, type ModelPackage } from '../../../frontend/src/services/transcription/modelPackage';
import { importModelPackage, stagePackageAdoption } from '../../../scripts/model-evaluator/model-package.mjs';
import { configuredAssetDigest } from '../../../scripts/model-evaluator/adapters/candidate-browser';

const repo = resolve(__dirname, '../../..');
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
beforeAll(() => { vi.stubGlobal('crypto', webcrypto); });
afterAll(() => vi.unstubAllGlobals());
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

/** A project root with the real runtime-binding inventory and installed runtimes; nothing else. */
function projectRoot() {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'model-import-')));
    roots.push(root);
    mkdirSync(join(root, 'frontend/src/services/transcription'), { recursive: true });
    writeFileSync(join(root, 'frontend/src/services/transcription/runtimeBindings.json'),
        readFileSync(join(repo, 'frontend/src/services/transcription/runtimeBindings.json')));
    symlinkSync(join(repo, 'node_modules'), join(root, 'node_modules'), 'dir');
    return root;
}

/** Synthetic small components beside the descriptor, so import can prove their bytes offline. */
async function moonshinePackage(host = 'download.moonshine.ai') {
    const base = CANDIDATES['moonshine:streaming-medium'];
    const directory = realpathSync(mkdtempSync(join(tmpdir(), 'moonshine-package-')));
    roots.push(directory);
    const files = ['encoder.ort', 'decoder.ort', 'tokenizer.bin'].map((name, index) => {
        const bytes = Buffer.from(`synthetic ${name} ${index}`);
        writeFileSync(join(directory, name), bytes);
        return { path: name, url: `https://${host}/fixture/${name}`, bytes: bytes.length, sha256: sha(bytes) };
    });
    const pkg = await sealModelPackage({ schemaVersion: 1, kind: 'speaksharp-model-package', id: 'fixture:moonshine-import',
        engine: base.engine, runtime: base.runtime, model: base.model, execution: structuredClone(base.execution),
        assets: { files }, license: 'MIT (fixture declaration; synthetic bytes)' } as never);
    const descriptor = join(directory, 'package.json');
    writeFileSync(descriptor, JSON.stringify(pkg));
    return { pkg, descriptor, directory };
}

describe('the importer admits the Moonshine upstream-pin policy the parser requires', () => {
    it('imports a Moonshine package whose pinned components are present locally, without copying or fetching them', async () => {
        const root = projectRoot();
        const { pkg, descriptor } = await moonshinePackage();
        const result = await importModelPackage(root, descriptor);
        expect(result).toMatchObject({ candidateId: 'fixture:moonshine-import', packageDigest: pkg.packageDigest });
        expect(JSON.parse(readFileSync(result.descriptor, 'utf8')).packageDigest).toBe(pkg.packageDigest);
        // Upstream-pinned bytes stay with the runtime's verified, consented fetch; nothing lands in the served tree.
        expect(existsSync(join(root, 'frontend/public/models'))).toBe(false);
    });
    it('refuses an upstream host the reviewed built-in pins do not use', async () => {
        const { descriptor } = await moonshinePackage('models.example.invalid');
        await expect(importModelPackage(projectRoot(), descriptor)).rejects.toThrow('PACKAGE_IMPORT_UPSTREAM_HOST_NOT_APPROVED');
    });
    it('still proves every component byte-for-byte before admitting it', async () => {
        const { descriptor, directory } = await moonshinePackage();
        writeFileSync(join(directory, 'decoder.ort'), 'substituted bytes of equal intent');
        await expect(importModelPackage(projectRoot(), descriptor)).rejects.toThrow('PACKAGE_IMPORT_ASSET_MISMATCH');
    });
    it('keeps the self-hosted Whisper layout: local /models/ components are copied into the served tree', async () => {
        const base = CANDIDATES['v2:base.en'];
        const directory = realpathSync(mkdtempSync(join(tmpdir(), 'whisper-package-')));
        roots.push(directory);
        const localModelId = 'fixture-import-whisper';
        const files = base.assets.files!.map((file, index) => {
            const bytes = Buffer.from(`synthetic ${file.path} ${index}`);
            mkdirSync(join(directory, file.path, '..'), { recursive: true });
            writeFileSync(join(directory, file.path), bytes);
            return { path: file.path, url: `/models/${localModelId}/${file.path}`, bytes: bytes.length, sha256: sha(bytes) };
        });
        const pkg = await sealModelPackage({ schemaVersion: 1, kind: 'speaksharp-model-package', id: 'fixture:whisper-import',
            engine: base.engine, runtime: base.runtime, model: { ...base.model, device: 'wasm' },
            execution: { ...base.execution, localModelId }, assets: { servedFrom: `/models/${localModelId}`, files },
            license: 'MIT (fixture declaration; synthetic bytes)' } as never);
        writeFileSync(join(directory, 'package.json'), JSON.stringify(pkg));
        const root = projectRoot();
        await importModelPackage(root, join(directory, 'package.json'));
        for (const file of files) expect(sha(readFileSync(join(root, 'frontend/public', file.url.slice(1))))).toBe(file.sha256);
    });
});

describe('adoption staging writes an inert proposal, never a selector config', () => {
    it('binds the product report bytes but emits no approvedPackages row and states the activation it still requires', async () => {
        const root = projectRoot();
        const { pkg, descriptor, directory } = await moonshinePackage();
        const report = Buffer.from(JSON.stringify({ qualification: 'PASS', mode: 'product-lifecycle', qualifiedPackages: [pkg.packageDigest] }));
        writeFileSync(join(directory, 'report.json'), report);
        const output = join(directory, 'proposal.json');
        const result = await stagePackageAdoption(root, descriptor, join(directory, 'report.json'), output);
        const proposal = JSON.parse(readFileSync(output, 'utf8'));
        expect(proposal).toEqual({ kind: 'speaksharp-adoption-proposal', candidate: pkg.id, packageDigest: pkg.packageDigest,
            productReportSha256: sha(report), activation: 'REQUIRES_REGISTRY_ACTIVATION_REVIEW' });
        expect(proposal).not.toHaveProperty('approvedPackages');
        expect(result.activation).toBe('REQUIRES_REGISTRY_ACTIVATION_REVIEW');
    });
    it('refuses a report that does not qualify this exact package', async () => {
        const { pkg, descriptor, directory } = await moonshinePackage();
        writeFileSync(join(directory, 'report.json'), JSON.stringify({ qualification: 'PASS', mode: 'product-lifecycle', qualifiedPackages: ['f'.repeat(64)] }));
        await expect(stagePackageAdoption(projectRoot(), descriptor, join(directory, 'report.json'), join(directory, 'p.json')))
            .rejects.toThrow('PACKAGE_NOT_PRODUCT_QUALIFIED');
        expect((pkg as ModelPackage).packageDigest).not.toBe('f'.repeat(64));
    });
});

describe('the evaluator verifies exactly the packages the importer admits (Codex 416770cd)', () => {
    it('an imported Moonshine package with approved upstream pins binds its asset digest instead of being refused', async () => {
        const root = projectRoot();
        const { pkg, descriptor } = await moonshinePackage();
        await importModelPackage(root, descriptor);
        expect(await configuredAssetDigest(root, pkg.id as never, pkg.model.id)).toBe(pkg.assetDigest);
    });
    it('a Moonshine package naming an unapproved upstream host is refused by the evaluator as well', async () => {
        const root = projectRoot();
        const { pkg } = await moonshinePackage('models.example.invalid');
        mkdirSync(join(root, 'frontend/src/services/transcription/model-packages'), { recursive: true });
        writeFileSync(join(root, 'frontend/src/services/transcription/model-packages/rogue.json'), JSON.stringify(pkg));
        await expect(configuredAssetDigest(root, pkg.id as never, pkg.model.id)).rejects.toThrow('diagnostic_package_upstream_host_not_approved');
    });
    it('a self-hosted Whisper package is still verified byte-for-byte from the served tree', async () => {
        const base = CANDIDATES['v2:base.en'];
        const directory = realpathSync(mkdtempSync(join(tmpdir(), 'whisper-eval-')));
        roots.push(directory);
        const localModelId = 'fixture-eval-whisper';
        const files = base.assets.files!.map((file, index) => {
            const bytes = Buffer.from(`synthetic eval ${file.path} ${index}`);
            mkdirSync(join(directory, file.path, '..'), { recursive: true });
            writeFileSync(join(directory, file.path), bytes);
            return { path: file.path, url: `/models/${localModelId}/${file.path}`, bytes: bytes.length, sha256: sha(bytes) };
        });
        const pkg = await sealModelPackage({ schemaVersion: 1, kind: 'speaksharp-model-package', id: 'fixture:whisper-eval',
            engine: base.engine, runtime: base.runtime, model: { ...base.model, device: 'wasm' },
            execution: { ...base.execution, localModelId }, assets: { servedFrom: `/models/${localModelId}`, files },
            license: 'MIT (fixture declaration; synthetic bytes)' } as never);
        writeFileSync(join(directory, 'package.json'), JSON.stringify(pkg));
        const root = projectRoot();
        await importModelPackage(root, join(directory, 'package.json'));
        expect(await configuredAssetDigest(root, pkg.id as never, pkg.model.id)).toBe(pkg.assetDigest);
        writeFileSync(join(root, 'frontend/public', files[0].url.slice(1)), 'tampered served bytes');
        await expect(configuredAssetDigest(root, pkg.id as never, pkg.model.id)).rejects.toThrow('Package local asset bytes differ');
    });
});

/**
 * Release and app-developer reviews of 38253831 (P2): the importer checked collisions only against `CANDIDATES`, which under Node holds the
 * built-ins alone, so a second package reusing an already imported package's cache directory (`localModelId`) was imported
 * too; the bundle's admission then refused one of them, and when the new file sorts first, the previously admitted one.
 * The importer now runs the product's own admission over the existing descriptors plus the new one before any write.
 */
describe('the importer refuses a package that collides with an already imported package', () => {
    const packagesOf = (root: string) => join(root, 'frontend/src/services/transcription/model-packages');
    async function whisperPackage(id: string, localModelId: string, seed = localModelId, license = 'MIT (fixture declaration; synthetic bytes)') {
        const base = CANDIDATES['v2:base.en'];
        const directory = realpathSync(mkdtempSync(join(tmpdir(), 'whisper-collision-')));
        roots.push(directory);
        const files = base.assets.files!.map((file, index) => {
            const bytes = Buffer.from(`synthetic ${seed} ${file.path} ${index}`);
            mkdirSync(join(directory, file.path, '..'), { recursive: true });
            writeFileSync(join(directory, file.path), bytes);
            return { path: file.path, url: `/models/${localModelId}/${file.path}`, bytes: bytes.length, sha256: sha(bytes) };
        });
        const pkg = await sealModelPackage({ schemaVersion: 1, kind: 'speaksharp-model-package', id,
            engine: base.engine, runtime: base.runtime, model: { ...base.model, device: 'wasm' },
            execution: { ...base.execution, localModelId }, assets: { servedFrom: `/models/${localModelId}`, files },
            license } as never);
        writeFileSync(join(directory, 'package.json'), JSON.stringify(pkg));
        return join(directory, 'package.json');
    }
    const snapshot = (root: string) => Object.fromEntries(
        (existsSync(packagesOf(root)) ? readdirSync(packagesOf(root)) : []).map(name => [name, readFileSync(join(packagesOf(root), name), 'utf8')]));

    // The copy reuses the first package's cache directory and its exact bytes, so every asset copy is a no-op: only
    // admission can refuse it. Both orders matter: the bundle admits in path order, so a copy that sorts first would
    // otherwise displace the package that was already admitted.
    for (const [first, second] of [['fixture:b-whisper', 'fixture:a-whisper'], ['fixture:a-whisper', 'fixture:b-whisper']]) {
        it(`refuses ${second} after ${first} when both use one cache directory, leaving the first package unchanged`, async () => {
            const root = projectRoot();
            await importModelPackage(root, await whisperPackage(first, 'fixture-shared-cache', 'shared'));
            const before = snapshot(root);
            await expect(importModelPackage(root, await whisperPackage(second, 'fixture-shared-cache', 'shared')))
                .rejects.toThrow('PACKAGE_IDENTITY_COLLISION');
            expect(snapshot(root)).toEqual(before);
        });
    }
    it('refuses before copying anything when the colliding package brings different bytes', async () => {
        const root = projectRoot();
        await importModelPackage(root, await whisperPackage('fixture:b-whisper', 'fixture-shared-cache', 'first'));
        const served = join(root, 'frontend/public/models/fixture-shared-cache');
        const servedBefore = Object.fromEntries(readdirSync(served, { recursive: true }).map(String).sort()
            .filter(name => statSync(join(served, name)).isFile()).map(name => [name, sha(readFileSync(join(served, name)))]));
        await expect(importModelPackage(root, await whisperPackage('fixture:a-whisper', 'fixture-shared-cache', 'second')))
            .rejects.toThrow('PACKAGE_IDENTITY_COLLISION');
        for (const [name, digest] of Object.entries(servedBefore)) expect(sha(readFileSync(join(served, name)))).toBe(digest);
    });
    // App-developer review of c1585147 (P3): the bundle's 1 MiB limit applies to the descriptor text it loads, which is the
    // pretty-printed file the importer writes. Admission checked the compact form, so a descriptor just under the limit
    // compact but over it pretty was imported and then refused by the product.
    it('admits the exact descriptor text it writes, so a file the bundle would refuse as too large is never imported', async () => {
        const probe = JSON.parse(readFileSync(await whisperPackage('fixture:large-whisper', 'fixture-large-cache'), 'utf8'));
        const compact = JSON.stringify(probe).length, pretty = JSON.stringify(probe, null, 2).length + 1;
        expect(pretty - compact).toBeGreaterThan(2);
        const target = 1_048_576 - Math.floor((pretty - compact) / 2); // compact under the limit, pretty over it
        const license = probe.license + ' ' + 'x'.repeat(target - compact - 1);
        const descriptor = await whisperPackage('fixture:large-whisper', 'fixture-large-cache', 'fixture-large-cache', license);
        const sealed = JSON.parse(readFileSync(descriptor, 'utf8'));
        expect(JSON.stringify(sealed).length).toBeLessThanOrEqual(1_048_576);
        expect(JSON.stringify(sealed, null, 2).length + 1).toBeGreaterThan(1_048_576);
        const root = projectRoot();
        await expect(importModelPackage(root, descriptor)).rejects.toThrow('PACKAGE_DESCRIPTOR_TOO_LARGE');
        expect(snapshot(root)).toEqual({});
        expect(existsSync(join(root, 'frontend/public/models/fixture-large-cache'))).toBe(false);
    });
    // Review of 29c088e4: an id already imported with different content replaced that descriptor in the proposed catalogue,
    // passed admission and copied its assets before the descriptor write failed with a raw EEXIST.
    it('refuses an already imported id with different content before copying anything', async () => {
        const root = projectRoot();
        await importModelPackage(root, await whisperPackage('fixture:x-whisper', 'fixture-cache-one'));
        const before = snapshot(root);
        await expect(importModelPackage(root, await whisperPackage('fixture:x-whisper', 'fixture-cache-two')))
            .rejects.toThrow('PACKAGE_DUPLICATE_ID');
        expect(snapshot(root)).toEqual(before);
        expect(existsSync(join(root, 'frontend/public/models/fixture-cache-two'))).toBe(false);
    });
    it('still imports packages with distinct cache directories, and a repeated identical import stays idempotent', async () => {
        const root = projectRoot();
        const first = await whisperPackage('fixture:b-whisper', 'fixture-cache-one');
        await importModelPackage(root, first);
        await importModelPackage(root, await whisperPackage('fixture:a-whisper', 'fixture-cache-two'));
        await importModelPackage(root, first);
        expect(Object.keys(snapshot(root)).sort()).toEqual(['fixture_a-whisper.json', 'fixture_b-whisper.json']);
    });
});

/**
 * Code review of 403e2cda (P2, confirmed by the release review): package admission only refused JavaScript and WASM
 * extensions, so a Whisper package could ship an HTML or SVG document with an inline script. The importer copies every
 * local asset into frontend/public/models, which is served on the application origin, so opening that URL would run the
 * script with the signed-in user's storage. Assets are now limited to inert model formats (and the reviewed runtime pins).
 */
describe('the importer refuses active documents in an inert model package', () => {
    async function whisperWithExtra(extraPath: string, extraBytes: Buffer) {
        const base = CANDIDATES['v2:base.en'];
        const directory = realpathSync(mkdtempSync(join(tmpdir(), 'whisper-active-')));
        roots.push(directory);
        const localModelId = 'fixture-active-document';
        const entries = [...base.assets.files!.map((file, index) => ({ path: file.path, bytes: Buffer.from(`synthetic ${file.path} ${index}`) })),
            { path: extraPath, bytes: extraBytes }];
        const files = entries.map(({ path, bytes }) => {
            mkdirSync(join(directory, path, '..'), { recursive: true });
            writeFileSync(join(directory, path), bytes);
            return { path, url: `/models/${localModelId}/${path}`, bytes: bytes.length, sha256: sha(bytes) };
        });
        return { directory, localModelId, files, base };
    }
    for (const extra of ['open.html', 'icon.svg', 'page.xhtml', 'legacy.htm', 'feed.xml', 'notes/readme.md', 'LICENSE']) {
        it(`refuses ${extra} at sealing and never copies anything into the served tree`, async () => {
            const { directory, localModelId, files, base } = await whisperWithExtra(extra,
                Buffer.from('<html><body><script>fetch("/x?"+localStorage.length)</script></body></html>'));
            const draft = { schemaVersion: 1, kind: 'speaksharp-model-package', id: 'fixture:active-document',
                engine: base.engine, runtime: base.runtime, model: { ...base.model, device: 'wasm' },
                execution: { ...base.execution, localModelId }, assets: { servedFrom: `/models/${localModelId}`, files },
                license: 'MIT (fixture declaration; synthetic bytes)' };
            await expect(sealModelPackage(draft as never)).rejects.toThrow('UNSUPPORTED_PACKAGE_ASSET_TYPE');
            // The importer seals an unsealed descriptor itself; it refuses on the asset type, before any copy.
            writeFileSync(join(directory, 'package.json'), JSON.stringify(draft));
            const root = projectRoot();
            await expect(importModelPackage(root, join(directory, 'package.json'))).rejects.toThrow('UNSUPPORTED_PACKAGE_ASSET_TYPE');
            expect(existsSync(join(root, 'frontend/public/models', localModelId))).toBe(false);
        });
    }
    it('still admits the supported inert formats', async () => {
        const { localModelId, files, base } = await whisperWithExtra('extra/added_tokens.json', Buffer.from('{}'));
        await expect(sealModelPackage({ schemaVersion: 1, kind: 'speaksharp-model-package', id: 'fixture:inert-extra',
            engine: base.engine, runtime: base.runtime, model: { ...base.model, device: 'wasm' },
            execution: { ...base.execution, localModelId }, assets: { servedFrom: `/models/${localModelId}`, files },
            license: 'MIT (fixture declaration; synthetic bytes)' } as never)).resolves.toMatchObject({ id: 'fixture:inert-extra' });
    });
});

/**
 * Independent review of 54a8afb6 (P2): the importer names the served file from the asset URL, and only Whisper required the
 * URL to match the path, so a Parakeet or Granite asset declared as model data could be served under an .html (or .js)
 * name. The served name must now pass the type rule and equal the path's file name for every local asset.
 */
describe('a local asset is served under its own, inert file name on every engine', () => {
    function runtimeBytes(engine: 'parakeet' | 'granite', path: string) {
        return engine === 'parakeet' ? readFileSync(join(repo, 'frontend/public/models/parakeet-runtime/1.4.4-ort1.24.1', path.split('/').pop()!)) : null;
    }
    for (const engine of ['parakeet', 'granite'] as const) {
        for (const [label, served] of [['an .html URL', '.html'], ['a .js URL', '.js']] as const) {
            it(`${engine}: a model-data path served under ${label} is refused at sealing`, async () => {
                const base = CANDIDATES[engine === 'parakeet' ? 'parakeet:tdt-v3:int8' : 'granite:turboctc-q4f16'];
                const target = base.assets.files!.findIndex(file => /\.(?:json|txt)$/.test(file.path));
                const files = base.assets.files!.map((file, index) => {
                    const executable = /\.(?:[cm]?js|wasm)$/i.test(file.path);
                    const name = index === target ? file.path.replace(/\.[a-z]+$/, served) : file.path;
                    return executable ? { path: file.path, url: `/models/fixture-${engine}/${file.path}`, bytes: file.bytes, sha256: file.sha256 }
                        : { path: file.path, url: `/models/fixture-${engine}/${name}`, bytes: 10, sha256: 'a'.repeat(64) };
                });
                await expect(sealModelPackage({ schemaVersion: 1, kind: 'speaksharp-model-package', id: `fixture:served-${engine}`,
                    engine: base.engine, runtime: base.runtime, model: base.model, execution: structuredClone(base.execution),
                    assets: { files }, license: 'MIT (fixture declaration; synthetic bytes)' } as never))
                    .rejects.toThrow(served === '.html' ? 'UNSUPPORTED_PACKAGE_ASSET_TYPE' : 'PACKAGE_ASSET_NAME_MISMATCH');
            });
        }
    }
    it('parakeet end to end: an importer given a vocab.txt served as vocab.html refuses and writes nothing', async () => {
        const base = CANDIDATES['parakeet:tdt-v3:int8'];
        const directory = realpathSync(mkdtempSync(join(tmpdir(), 'parakeet-served-')));
        roots.push(directory);
        const files = base.assets.files!.map(file => {
            const bytes = /\.(?:[cm]?js|wasm)$/i.test(file.path) ? runtimeBytes('parakeet', file.path)!
                : Buffer.from(file.path === 'vocab.txt' ? '<html><body><script>alert(document.domain)</script></body></html>' : `synthetic ${file.path}`);
            writeFileSync(join(directory, file.path), bytes);
            const url = `/models/fixture-parakeet-served/${file.path === 'vocab.txt' ? 'vocab.html' : file.path}`;
            return { path: file.path, url, bytes: bytes.length, sha256: sha(bytes) };
        });
        writeFileSync(join(directory, 'package.json'), JSON.stringify({ schemaVersion: 1, kind: 'speaksharp-model-package',
            id: 'fixture:parakeet-served', engine: base.engine, runtime: base.runtime, model: base.model,
            execution: structuredClone(base.execution), assets: { files }, license: 'MIT (fixture declaration; synthetic bytes)' }));
        const root = projectRoot();
        await expect(importModelPackage(root, join(directory, 'package.json'))).rejects.toThrow('UNSUPPORTED_PACKAGE_ASSET_TYPE');
        expect(existsSync(join(root, 'frontend/public/models/fixture-parakeet-served'))).toBe(false);
    });
});

