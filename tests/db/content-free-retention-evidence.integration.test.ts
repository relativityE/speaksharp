// @vitest-environment node
// Real migration execution on a synthetic PGlite fixture; no hosted or provider target.
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bootstrapSql, candidate, cases, mutants } from './content-free-retention-evidence.realpg.mjs';

let db: PGlite;
const causalEvidence: object[] = [];
beforeAll(async () => {
    db = new PGlite();
    await db.exec(bootstrapSql());
    await db.exec(`SET ROLE closure_owner; ${candidate()} RESET ROLE;`);
}, 30_000);
afterAll(async () => {
    await db?.close();
    const output = join(mkdtempSync(join(tmpdir(), 'retention-causal-')), 'evidence.json');
    writeFileSync(output, JSON.stringify({ sourceSha256: createHash('sha256').update(candidate()).digest('hex'),
        controls: causalEvidence }, null, 2) + '\n');
    console.info(`retention causal evidence: ${output}`);
});

describe('successful replacement removes old plaintext while preserving numeric evidence', () => {
    for (const [name, body] of Object.entries(cases)) {
        it(`contract: ${name}`, async () => {
            expect(await body(db)).toBe(true);
        }, 30_000);
    }
});

describe('bad code must fail at the intended policy assertion', () => {
    for (const mutant of mutants) {
        it(`causal control: ${mutant.name}`, async () => {
            const original = candidate();
            expect(original.split(mutant.from)).toHaveLength(2);
            const changed = original.replace(mutant.from, mutant.to);
            const isolated = new PGlite();
            try {
                // Install/setup is outside the expected assertion failure: a syntax/permission error is RED setup.
                await isolated.exec(bootstrapSql());
                await isolated.exec(`SET ROLE closure_owner; ${changed} RESET ROLE;`);
                let caught: { code?: string; name?: string; message?: string; stack?: string; actual?: unknown; expected?: unknown; operator?: string } | undefined;
                try { await cases[mutant.exercise](isolated); }
                catch (error) { caught = error as typeof caught; }
                expect(caught?.code, 'only a real policy assertion qualifies as a killed mutant').toBe('ERR_ASSERTION');
                // Match the specific causal counterexample, never a different permission/setup failure.
                const required: Record<string, object> = {
                    pendingAndDelayed: { actual: 0, expected: 2, operator: 'strictEqual' },
                    snapshotUnavailable: { actual: expect.any(String), expected: null, operator: 'strictEqual' },
                    mismatchedCopies: { actual: undefined, operator: 'rejects', message: expect.stringMatching(/Missing expected rejection/) },
                    distinct501: { actual: undefined, operator: 'rejects', message: expect.stringMatching(/Missing expected rejection/) },
                    lateDerivedWrite: { actual: expect.objectContaining({ version: 'gemini_coaching_v1' }), expected: null, operator: 'strictEqual' },
                };
                expect({ actual: caught?.actual, expected: caught?.expected, operator: caught?.operator,
                    message: caught?.message }).toMatchObject(required[mutant.exercise]);
                causalEvidence.push({ mutant: mutant.name, sqlSha256: createHash('sha256').update(changed).digest('hex'),
                    assertion: { name: caught?.name, code: caught?.code, message: caught?.message, stack: caught?.stack,
                        actual: caught?.actual, expected: caught?.expected, operator: caught?.operator }, status: 'ASSERTION_RED' });
                console.info(JSON.stringify({ mutant: mutant.name, sqlSha256: createHash('sha256').update(changed).digest('hex'),
                    assertion: caught, status: 'ASSERTION_RED' }));
            } finally { await isolated.close(); }
        }, 30_000);
    }
    it('restores exact candidate bytes and the positive delayed-evidence control', async () => {
        expect(await cases.pendingAndDelayed(db)).toBe(true);
        causalEvidence.push({ restoredSha256: createHash('sha256').update(candidate()).digest('hex'), status: 'RESTORED_GREEN' });
        console.info(JSON.stringify({ restoredSha256: createHash('sha256').update(candidate()).digest('hex'), status: 'RESTORED_GREEN' }));
    });
});
