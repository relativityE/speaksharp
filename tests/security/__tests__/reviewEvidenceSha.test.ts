import { describe, expect, it } from 'vitest';
import { verifyReviewEvidenceSha } from '../../../scripts/verify-review-evidence-sha.mjs';

const SHA = '0123456789abcdef0123456789abcdef01234567';

describe('#1132 review evidence SHA binding', () => {
    it('accepts only the canonical full SHA that is actually checked out', () => {
        expect(verifyReviewEvidenceSha(SHA, { resolveHead: () => SHA })).toBe(SHA);
    });

    it.each([
        '',
        '0123456',
        '0123456789ABCDEF0123456789ABCDEF01234567',
        'g123456789abcdef0123456789abcdef01234567',
        `${SHA} `,
    ])('rejects malformed reviewed_sha input: %j', (candidate) => {
        expect(() => verifyReviewEvidenceSha(candidate, { resolveHead: () => SHA }))
            .toThrow(/canonical lowercase 40-character Git SHA/);
    });

    it('rejects an artifact label SHA that differs from checked-out HEAD', () => {
        const differentHead = '89abcdef0123456789abcdef0123456789abcdef';
        expect(() => verifyReviewEvidenceSha(SHA, { resolveHead: () => differentHead }))
            .toThrow(/does not match checked-out HEAD/);
    });
});
