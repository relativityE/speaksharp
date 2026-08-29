import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync, existsSync, writeFileSync, mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { planResume, validateCompleteness, identityMismatch, type RunIdentity } from '../checkpoint';
import { atomicWriteFileSync } from '../atomicWrite';
import { SELECTION_EXECUTION_SET, NOT_EXECUTED_REASONS, REQUIRED_MATRIX_ROWS } from '../arms/registry';

const ID: RunIdentity = {
    productBaseline: '808ebf9e', executionSha: 'aaaaaaaa', policySha: 'bbbbbbbb',
    corpusDigest: 'cccccccc', normalizerId: 'norm_v2', registryDigest: 'dddddddd',
    assetDigest: 'eeeeeeee', setName: 'corpus', evidenceClass: 'selection',
};
const cp = (rows: { id: string }[], identity: RunIdentity = ID) => ({ partial: true as const, identity, rows });

const dirs: string[] = [];
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'cp-')); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

describe('#1304 checkpoint resume — accepts only an identical experiment', () => {
    it('resumes when every identity field matches', () => {
        const d = planResume(cp([{ id: 'v2:tiny.en' }]), ID);
        expect(d.kind).toBe('resume');
        expect(d.kind === 'resume' && d.completed).toEqual(['v2:tiny.en']);
    });

    it.each([
        ['executionSha', 'ffffffff'], ['policySha', 'ffffffff'], ['corpusDigest', 'ffffffff'],
        ['normalizerId', 'norm_v1'], ['registryDigest', 'ffffffff'], ['assetDigest', 'ffffffff'],
        ['productBaseline', 'ffffffff'], ['setName', 'harvard'], ['evidenceClass', 'smoke'],
    ] as const)('starts clean when %s differs', (field, value) => {
        // MISMATCHED RESUME IDENTITY. Splicing rows measured under a different scorer, corpus, policy or
        // tree produces a table that reads as one experiment and is not one.
        const stale = { ...ID, [field]: value } as RunIdentity;
        const d = planResume(cp([{ id: 'v2:tiny.en' }], stale), ID);
        expect(d.kind).toBe('start-clean');
        expect(d.kind === 'start-clean' && d.reason).toContain(field);
    });

    it('refuses to extend a FINAL artifact', () => {
        // A final artifact is immutable evidence, not a work buffer.
        const d = planResume({ identity: ID, rows: [{ id: 'v2:tiny.en' }] }, ID);
        expect(d).toEqual({ kind: 'start-clean', reason: 'not a partial checkpoint' });
    });

    it('starts clean on a DUPLICATE arm — nothing can say which measurement is authoritative', () => {
        const d = planResume(cp([{ id: 'v2:tiny.en' }, { id: 'v2:tiny.en' }]), ID);
        expect(d.kind).toBe('start-clean');
        expect(d.kind === 'start-clean' && d.reason).toContain('duplicate arm');
    });

    it.each([
        ['no checkpoint', null],
        ['checkpoint carries no rows', { partial: true, identity: ID }],
        ['checkpoint carries no identity', { partial: true, rows: [] }],
        ['checkpoint row without an id', { partial: true, identity: ID, rows: [{ wer: 0.1 }] }],
    ])('starts clean: %s', (reason, input) => {
        expect(planResume(input, ID)).toEqual({ kind: 'start-clean', reason });
    });

    it('identityMismatch names the FIRST differing field rather than just failing', () => {
        expect(identityMismatch(ID, { ...ID, normalizerId: 'norm_v1' })).toContain('normalizerId');
        expect(identityMismatch(ID, ID)).toBeNull();
    });
});

describe('#1304 completeness — every arm accounted for, measured or named', () => {
    const allRows = REQUIRED_MATRIX_ROWS.map(id => ({ id }));

    it('accepts the full matrix', () => {
        expect(validateCompleteness(allRows, REQUIRED_MATRIX_ROWS)).toEqual({ ok: true });
    });

    it('rejects a MISSING arm — a hole reads as "not applicable", not "unknown"', () => {
        const v = validateCompleteness(allRows.slice(1), REQUIRED_MATRIX_ROWS);
        expect(v.ok).toBe(false);
        expect(v).toMatchObject({ reason: 'missing_arms' });
    });

    it('rejects a DUPLICATE arm', () => {
        const v = validateCompleteness([...allRows, allRows[0]], REQUIRED_MATRIX_ROWS);
        expect(v).toMatchObject({ ok: false, reason: 'duplicate_arms' });
    });

    it('rejects an arm that is not in the registry at all', () => {
        const v = validateCompleteness([...allRows, { id: 'v9:invented' }], REQUIRED_MATRIX_ROWS);
        expect(v).toMatchObject({ ok: false, reason: 'unexpected_arms', detail: 'v9:invented' });
    });
});

describe('#1304 selection execution set — measured vs preserved', () => {
    it('measures exactly the ten distinct candidates', () => {
        expect([...SELECTION_EXECUTION_SET]).toHaveLength(10);
    });

    it('accounts for every registry arm exactly once, measured or named', () => {
        const measured = new Set<string>(SELECTION_EXECUTION_SET);
        const named = new Set(Object.keys(NOT_EXECUTED_REASONS));
        const overlap = [...measured].filter(id => named.has(id));
        expect(overlap, 'an arm cannot be both measured and not-executed').toEqual([]);
        const covered = new Set([...measured, ...named]);
        expect([...REQUIRED_MATRIX_ROWS].filter(id => !covered.has(id)).sort()).toEqual([]);
        expect([...covered].filter(id => !REQUIRED_MATRIX_ROWS.includes(id)).sort()).toEqual([]);
    });

    it('never spends selection compute on an alias, a diagnostic duplicate, or SwiftShader', () => {
        for (const id of [
            'v4:base:q8-decoder:cpu', 'v4:base:q4-decoder:cpu',
            'v4:base:q4-decoder:webgpu', 'v4:distil-small.en:q4-decoder:webgpu',
        ]) {
            expect(SELECTION_EXECUTION_SET, `${id} must not be measured`).not.toContain(id);
            expect(NOT_EXECUTED_REASONS[id], `${id} must carry a named reason`).toBeTruthy();
        }
        expect(NOT_EXECUTED_REASONS['v4:base:q4-decoder:webgpu']).toBe('not_run_hardware_unrepresentative');
        expect(NOT_EXECUTED_REASONS['v4:base:q8-decoder:cpu']).toBe('alias_of_int8');
    });
});

describe('#1304 atomic write — an interrupted write never corrupts the checkpoint', () => {
    it('replaces the previous file wholly, leaving no temp file behind', () => {
        const d = tmp(); const p = join(d, 'run.partial.json');
        atomicWriteFileSync(p, JSON.stringify({ v: 1 }));
        atomicWriteFileSync(p, JSON.stringify({ v: 2 }));
        expect(JSON.parse(readFileSync(p, 'utf8'))).toEqual({ v: 2 });
        expect(readdirSync(d).filter(f => f.includes('.tmp-'))).toEqual([]);
    });

    it('INTERRUPTED WRITE: the previous checkpoint survives intact', () => {
        // Simulates a crash mid-write. A truncating writeFileSync would leave unparseable JSON here;
        // the temp-file + rename never touches the original until the new content is complete.
        const d = tmp(); const p = join(d, 'run.partial.json');
        atomicWriteFileSync(p, JSON.stringify(cp([{ id: 'v2:tiny.en' }])));
        writeFileSync(`${p}.tmp-99999`, '{"partial":true,"rows":[{"id":"v2:base'); // half-written, abandoned
        const recovered = JSON.parse(readFileSync(p, 'utf8'));
        expect(planResume(recovered, ID).kind).toBe('resume');
    });

    it('does not leave a temp file when the write itself fails', () => {
        const d = tmp();
        expect(() => atomicWriteFileSync(join(d, 'sub', 'x.json'), 'x')).not.toThrow();
        expect(existsSync(join(d, 'sub', 'x.json'))).toBe(true);
    });
});
