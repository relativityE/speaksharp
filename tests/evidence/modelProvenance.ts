/**
 * #1037 Lane A — prove (or refute) that the pinned HF model files the corpus harness runs are
 * byte-identical to the product's self-hosted `/models/whisper-base.en` assets. The corpus lane FAILS
 * CLOSED unless the verdict is `identical`: a `differs`/`unverifiable` model must never emit admissible
 * evidence under the production model's name.
 */
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const sha256 = (buf: Buffer): string => createHash('sha256').update(buf).digest('hex');

export interface ModelProvenanceFile {
    file: string;
    hfSha256: string | null;
    prodSha256: string | null;
    identical: boolean;
}

export interface ModelProvenance {
    verdict: 'identical' | 'differs' | 'unverifiable';
    files: ModelProvenanceFile[];
}

export interface ExpectedModelManifest {
    schemaVersion: 1;
    modelId: string;
    modelRevision: string;
    files: Record<string, string>;
}

export interface ManifestModelProvenanceFile {
    file: string;
    expectedSha256: string;
    actualSha256: string | null;
    identical: boolean;
}

export interface ManifestModelProvenance {
    modelId: string;
    modelRevision: string;
    verdict: 'identical' | 'differs' | 'unverifiable';
    files: ManifestModelProvenanceFile[];
}

const SHA256_RE = /^[0-9a-f]{64}$/i;

/**
 * Bind a self-hosted/production-build model directory to an immutable expected-hash manifest.
 * Invalid paths, malformed hashes, missing files, and an empty manifest fail closed.
 */
export function verifyModelAgainstManifest(
    modelDir: string,
    manifest: ExpectedModelManifest,
): ManifestModelProvenance {
    const entries = Object.entries(manifest.files ?? {});
    let malformed = entries.length === 0;
    const files = entries.map(([file, expectedSha256]) => {
        const unsafePath = file.startsWith('/') || file.split('/').includes('..');
        const expectedValid = SHA256_RE.test(expectedSha256);
        if (unsafePath || !expectedValid) malformed = true;
        const actualPath = unsafePath ? '' : resolve(modelDir, file);
        const actualSha256 = actualPath && existsSync(actualPath) ? sha256(readFileSync(actualPath)) : null;
        return {
            file,
            expectedSha256,
            actualSha256,
            identical: expectedValid && actualSha256 !== null && actualSha256 === expectedSha256,
        };
    });
    const verdict: ManifestModelProvenance['verdict'] = malformed || files.some(file => file.actualSha256 === null)
        ? 'unverifiable'
        : files.every(file => file.identical) ? 'identical' : 'differs';
    return {
        modelId: manifest.modelId,
        modelRevision: manifest.modelRevision,
        verdict,
        files,
    };
}

/**
 * @param hfModelDir   directory of the pinned HF revision (…/Xenova/whisper-base.en/<sha>)
 * @param prodModelDir directory of the self-hosted production assets (frontend/public/models/whisper-base.en)
 * @param relFiles     the model files that must match (relative to each dir)
 */
export function verifyModelProvenance(hfModelDir: string, prodModelDir: string, relFiles: string[]): ModelProvenance {
    const files: ModelProvenanceFile[] = relFiles.map((f) => {
        const hfPath = resolve(hfModelDir, f);
        const prodPath = resolve(prodModelDir, f);
        const hfSha = existsSync(hfPath) ? sha256(readFileSync(hfPath)) : null;
        const prodSha = existsSync(prodPath) ? sha256(readFileSync(prodPath)) : null;
        return { file: f, hfSha256: hfSha, prodSha256: prodSha, identical: hfSha !== null && hfSha === prodSha };
    });
    const verdict: ModelProvenance['verdict'] = files.length === 0 || files.some((f) => f.hfSha256 === null || f.prodSha256 === null)
        ? 'unverifiable'
        : files.every((f) => f.identical) ? 'identical' : 'differs';
    return { verdict, files };
}
