import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const readReleaseDoc = (name: string) =>
    readFileSync(resolve(process.cwd(), 'product_release', name), 'utf8');

describe('soft release tester instructions', () => {
    it('do not send testers looking for removed promo-code flows', () => {
        const instructions = readReleaseDoc('SOFT_RELEASE_TESTER_INSTRUCTIONS.md');

        expect(instructions).not.toMatch(/promo\s*code|promo-code|redeem/i);
    });

    it('keeps Cloud STT out of the no-cost Tester A task list', () => {
        const instructions = readReleaseDoc('SOFT_RELEASE_TESTER_INSTRUCTIONS.md');

        expect(instructions).toMatch(/Cloud STT is reserved for paid Pro accounts/i);
        expect(instructions).not.toMatch(/optionally try cloud/i);
    });
});
