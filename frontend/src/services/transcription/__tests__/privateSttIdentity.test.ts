/**
 * ATTRIBUTION THROUGH THE REAL BOUNDARY.
 *
 * `PrivateSTT.getMetadata()` reported the model from `PRIV_STT_V4_DEFAULT_VARIANT`, so a session that
 * resolved a different variant was saved naming a model that never ran.
 *
 * These tests deliberately do NOT reimplement `getMetadata`. A harness that recomputes the rule passes
 * whatever the source does, which is how a mutant survives. Instead they exercise the REAL mapping
 * functions, and assert on the REAL source that the wiring uses the resolved variant and that no hop in
 * the delegation chain narrows the type.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
    CANDIDATES, UnknownCandidateError, candidateForRuntime, identityOf, isCompleteIdentity,
} from '../candidateRegistry';

const REPO_ROOT = (() => {
    let dir = dirname(fileURLToPath(import.meta.url));
    for (let i = 0; i < 12; i++) {
        if (existsSync(join(dir, 'pnpm-lock.yaml'))) return dir;
        dir = dirname(dir);
    }
    throw new Error('repo root not found');
})();
const src = (p: string): string => readFileSync(join(REPO_ROOT, p), 'utf8');
const PRIVATE_STT = 'frontend/src/services/transcription/engines/PrivateSTT.ts';

/** The text of the getMetadata method only — file-wide assertions let a reverted body survive. */
const getMetadataBodyOf = (file: string): string => {
    const at = file.indexOf('public getMetadata(');
    expect(at, 'getMetadata not found').toBeGreaterThan(-1);
    return file.slice(at, at + 1800);
};
const WHISPER = 'frontend/src/services/transcription/modes/PrivateWhisper.ts';
const SERVICE = 'frontend/src/services/transcription/TranscriptionService.ts';

describe('a completed session is attributable to the EXACT candidate', () => {
    it('CASUALTY: a v4 session that resolved distil_q4 is NOT attributed to base_q4', () => {
        const id = candidateForRuntime({ engineType: 'transformers-js-v4', variant: 'distil_q4' });
        expect(id).toBe('v4:distil:q4');
        expect(id).not.toBe('v4:base:q4');
        expect(identityOf(CANDIDATES[id]).configuredModel.id).toBe('onnx-community/distil-small.en');
    });

    it('POSITIVE CONTROL: base_q4 and the v2 default attribute completely', () => {
        for (const [engine, variant, dtype, expected] of [
            ['transformers-js-v4', 'base_q4', 'q4', 'v4:base:q4'],
            ['transformers-js-v4', 'base_int8', 'int8', 'v4:base:int8'],
            ['transformers-js', null, null, 'v2:base.en'],
        ] as const) {
            const id = candidateForRuntime({ engineType: engine, variant, decoderDtype: dtype });
            expect(id).toBe(expected);
            expect(isCompleteIdentity(identityOf(CANDIDATES[id]))).toBe(true);
        }
    });

    it('CASUALTY: unrecognised runtime state is REFUSED, so no identity can be guessed', () => {
        expect(() => candidateForRuntime({ engineType: 'transformers-js-v4', variant: null })).toThrow(UnknownCandidateError);
    });
});

describe('PrivateSTT wires identity to the RESOLVED variant, not a default', () => {
    it('CASUALTY: the model identity is read from runtimePath, not PRIV_STT_V4_DEFAULT_VARIANT', () => {
        // SCOPED to the getMetadata body. A file-wide search passed while the body was reverted to the
        // default constant, because `this.runtimePath?.v4Variant` also appears in unrelated telemetry —
        // a real surviving mutant caused by asserting over the whole file.
        const body = getMetadataBodyOf(src(PRIVATE_STT));
        expect(body).toMatch(/this\.runtimePath\?\.v4Variant/);
        expect(body).toMatch(/candidateForRuntime\(/);
        // The identity must not be derived from the default constant anywhere in this body.
        expect(body).not.toMatch(/resolvedVariant\s*=\s*PRIV_STT_V4_DEFAULT_VARIANT/);
        expect(body).not.toMatch(/const\s+model\s*=\s*isV4\s*\?\s*PRIV_STT_V4_DEFAULT_VARIANT\s*:/);
    });

    it('an unmappable state leaves identity ABSENT rather than defaulted', () => {
        const s = src(PRIVATE_STT);
        // The catch must not substitute a fallback candidate.
        const catchBlock = s.slice(s.indexOf('candidateForRuntime('));
        expect(catchBlock).not.toMatch(/catch[\s\S]{0,200}candidateId\s*=\s*['"]/);
    });
});

describe('the identity survives the delegation chain', () => {
    it('CASUALTY: no hop restates a narrow getMetadata type', () => {
        // TranscriptionService asks the OUTER strategy (PrivateWhisper), which delegates to PrivateSTT.
        // A hand-copied 3-field signature on either hop type-strips candidateId/modelIdentity on the way
        // to the saved row — a hole that typechecks and passes every engine-level test.
        const narrow = /\{\s*engineVersion:\s*string;\s*modelName:\s*string;\s*deviceType:\s*string;?\s*\}/;
        // Scoped to the getMetadata bodies. TranscriptionService legitimately keeps that narrow shape
        // for its own `metadata` FALLBACK field, which serves non-Private strategies that have no
        // candidate identity at all — asserting over the whole file would fail on correct code.
        const bodyAt = (file: string, marker: string): string => {
            const at = file.indexOf(marker);
            expect(at, `${marker} not found`).toBeGreaterThan(-1);
            return file.slice(at, at + 700);
        };
        expect(narrow.test(bodyAt(src(WHISPER), 'public getMetadata(')), 'PrivateWhisper narrow').toBe(false);
        expect(narrow.test(bodyAt(src(SERVICE), 'public getMetadata(')), 'Service narrow').toBe(false);
    });

    it('both hops DERIVE the return type from the engine contract', () => {
        expect(src(WHISPER)).toMatch(/ReturnType<IPrivateSTT\['getMetadata'\]>/);
        expect(src(SERVICE)).toMatch(/ReturnType<IPrivateSTT\['getMetadata'\]>/);
    });
});

describe('decoder precision is part of the identity', () => {
    it('CASUALTY: base_int8 is attributed to v4:base:int8, NEVER to v4:base:q4', () => {
        // The two share a repo and an encoder and differ only in decoder precision. A mapping keyed on
        // the variant name alone collapsed them, which would make an int8 human test untrustworthy in
        // exactly the way the original PRIV_STT_V4_DEFAULT_VARIANT bug did.
        const id = candidateForRuntime({
            engineType: 'transformers-js-v4', variant: 'base_int8', decoderDtype: 'int8',
        });
        expect(id).toBe('v4:base:int8');
        expect(id).not.toBe('v4:base:q4');
    });

    it('CASUALTY: the resolved dtype WINS over a variant name that disagrees', () => {
        // If the resolver reports base_q4 while the run is configured int8, the bytes decide.
        expect(candidateForRuntime({
            engineType: 'transformers-js-v4', variant: 'base_q4', decoderDtype: 'int8',
        })).toBe('v4:base:int8');
    });

    it('CASUALTY: an unknown decoder precision is REFUSED, not defaulted to q4', () => {
        expect(() => candidateForRuntime({
            engineType: 'transformers-js-v4', variant: 'base_fp32', decoderDtype: 'fp32',
        })).toThrow(/refusing to attribute the session to a default precision/);
        expect(() => candidateForRuntime({
            engineType: 'transformers-js-v4', variant: 'base_q4', decoderDtype: null,
        })).not.toThrow();   // variant name still implies q4 when no dtype was resolved
    });

    it('PrivateSTT passes the resolved decoder dtype, not just the variant name', () => {
        const body = getMetadataBodyOf(src(PRIVATE_STT));
        expect(body).toMatch(/decoderDtype:/);
        expect(body).toMatch(/decoder_model_merged/);
    });
});
