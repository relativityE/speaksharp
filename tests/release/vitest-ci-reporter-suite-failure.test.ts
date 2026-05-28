import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import VitestCIReporter from '../../scripts/vitest-ci-reporter.mjs';

describe('Vitest CI reporter failure accounting', () => {
    const cwdSpy = vi.spyOn(process, 'cwd');
    const tempDirs: string[] = [];
    const originalProcessSend = process.send;

    afterEach(() => {
        cwdSpy.mockReset();
        Object.defineProperty(process, 'send', {
            value: originalProcessSend,
            configurable: true,
            writable: true,
        });
        tempDirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }));
    });

    const runReporter = (files: unknown[]) => {
        const tempDir = mkdtempSync(join(tmpdir(), 'speaksharp-vitest-reporter-'));
        tempDirs.push(tempDir);
        cwdSpy.mockReturnValue(tempDir);
        Object.defineProperty(process, 'send', {
            value: undefined,
            configurable: true,
            writable: true,
        });

        new VitestCIReporter().onFinished(files);

        return JSON.parse(readFileSync(join(tempDir, 'test-results/unit/results.json'), 'utf8'));
    };

    it('counts a failed suite/import task when no child test failure exists', () => {
        const results = runReporter([
            {
                name: 'frontend/src/components/landing/__tests__/Landing.test.tsx',
                filepath: '/repo/frontend/src/components/landing/__tests__/Landing.test.tsx',
                type: 'suite',
                result: {
                    state: 'fail',
                    duration: 17,
                    errors: [{ message: 'No "ShieldCheck" export is defined on the lucide-react mock' }],
                },
                tasks: [],
            },
        ]);

        expect(results.numFailedTests).toBe(1);
        expect(results.numFailedSuites).toBe(1);
        expect(results.numTotalTests).toBe(1);
        expect(results.failures).toEqual([
            expect.objectContaining({
                type: 'suite',
                title: 'frontend/src/components/landing/__tests__/Landing.test.tsx',
                error: expect.stringContaining('ShieldCheck'),
            }),
        ]);
    });

    it('does not double-count a failed suite that already contains a failed child test', () => {
        const results = runReporter([
            {
                name: 'parent suite',
                type: 'suite',
                result: {
                    state: 'fail',
                    errors: [{ message: 'suite cleanup failed after child failure' }],
                },
                tasks: [
                    {
                        name: 'child test',
                        type: 'test',
                        result: {
                            state: 'fail',
                            duration: 4,
                            errors: [{ message: 'child assertion failed' }],
                        },
                        file: {
                            filepath: '/repo/tests/example.test.ts',
                        },
                    },
                ],
            },
        ]);

        expect(results.numFailedTests).toBe(1);
        expect(results.numFailedSuites).toBe(0);
        expect(results.numTotalTests).toBe(1);
        expect(results.failures).toHaveLength(1);
        expect(results.failures[0]).toEqual(expect.objectContaining({
            type: 'test',
            title: 'parent suite > child test',
            error: 'child assertion failed',
        }));
    });
});
