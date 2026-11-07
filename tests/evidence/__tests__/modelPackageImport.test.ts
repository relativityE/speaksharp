// #1760 Increment A: the package importer and adoption staging, driven through the real command functions.
// Codex (7819b055): Moonshine packages must use https upstream pins, but the importer accepted only /models/
// URLs, so no Moonshine package could ever import. Sam/Bezos finding B: an adoption row with any 64-hex
// evidence hash could make a package the production default; staging now writes an inert proposal.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createHash, webcrypto } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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
