import { describe, it, expect } from 'vitest';
import { PROGRESS_READ_CODES, progressReadDiagnostic } from '../progressReadDiagnostic';

/** #1258 F3 — the classifier keeps a closed code and drops everything else the database said. */
describe('progressReadDiagnostic', () => {
    it.each([
        [{ code: 'PGRST201', message: 'Could not embed', details: 'x', hint: 'y' }, 'PGRST201'],
        [{ code: '42501', message: 'permission denied for table sessions' }, '42501'],
        [{ code: 'PGRST116', message: 'multiple rows' }, 'PGRST116'],
        [{ code: '', message: 'TypeError: fetch failed' }, 'network'],
        [{ code: '', message: 'TypeError: Failed to fetch' }, 'network'],
        [{ code: '', message: 'TypeError: Load failed' }, 'network'],
        [{ code: 'P0001', message: 'raise: secret row value' }, 'other'],
        [{ code: 42501, message: 'numeric code is not a listed string' }, 'other'],
        [{ message: 'no code at all' }, 'other'],
        ['a bare string', 'other'],
        [null, 'empty'],
        [undefined, 'empty'],
    ])('%j → %s', (error, code) => {
        const diagnostic = progressReadDiagnostic('history_prior', error);
        expect(diagnostic).toEqual({ stage: 'history_prior', code });
        expect(PROGRESS_READ_CODES).toContain(diagnostic.code);
        expect(Object.keys(diagnostic).sort()).toEqual(['code', 'stage']);
    });
});
