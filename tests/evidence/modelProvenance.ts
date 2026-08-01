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
