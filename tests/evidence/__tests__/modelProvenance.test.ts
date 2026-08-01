import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyModelProvenance } from '../modelProvenance';

let root: string;
const REL = ['onnx/a.onnx', 'onnx/b.onnx'];

function seed(dir: string, contents: Record<string, string>) {
    mkdirSync(join(dir, 'onnx'), { recursive: true });
    for (const [rel, body] of Object.entries(contents)) writeFileSync(join(dir, rel), body);
}

beforeAll(() => { root = mkdtempSync(join(tmpdir(), 'modelprov-')); });
afterAll(() => { rmSync(root, { recursive: true, force: true }); });

describe('#1037 verifyModelProvenance — fail-closed model identity', () => {
    it('verdict = identical when every file matches byte-for-byte', () => {
        const hf = join(root, 'hf1'); const prod = join(root, 'prod1');
        seed(hf, { 'onnx/a.onnx': 'AAA', 'onnx/b.onnx': 'BBB' });
        seed(prod, { 'onnx/a.onnx': 'AAA', 'onnx/b.onnx': 'BBB' });
        const r = verifyModelProvenance(hf, prod, REL);
        expect(r.verdict).toBe('identical');
        expect(r.files.every((f) => f.identical)).toBe(true);
    });

    it('verdict = differs when any file differs', () => {
        const hf = join(root, 'hf2'); const prod = join(root, 'prod2');
        seed(hf, { 'onnx/a.onnx': 'AAA', 'onnx/b.onnx': 'BBB' });
        seed(prod, { 'onnx/a.onnx': 'AAA', 'onnx/b.onnx': 'DIFFERENT' });
        expect(verifyModelProvenance(hf, prod, REL).verdict).toBe('differs');
    });

    it('verdict = unverifiable when a file is missing on either side', () => {
        const hf = join(root, 'hf3'); const prod = join(root, 'prod3');
        seed(hf, { 'onnx/a.onnx': 'AAA', 'onnx/b.onnx': 'BBB' });
        seed(prod, { 'onnx/a.onnx': 'AAA' }); // b.onnx absent
        expect(verifyModelProvenance(hf, prod, REL).verdict).toBe('unverifiable');
    });

    it('verdict = unverifiable when no files are requested (never vacuously identical)', () => {
        expect(verifyModelProvenance(root, root, []).verdict).toBe('unverifiable');
    });
});
