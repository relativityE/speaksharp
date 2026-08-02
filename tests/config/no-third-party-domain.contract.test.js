import { describe, it, expect } from 'vitest';
import { scanText, FORBIDDEN } from '../../scripts/no-third-party-domain-scan.mjs';

// #1148 — validates the generic deny/allow authority model of the zero-reference scanner WITHOUT this test
// file ever containing the forbidden contiguous domain. Every forbidden sample is assembled from fragments.
const BRAND = 'speak' + 'sharp';
const TLD = 'a' + 'pp';
const forbidden = (dot = '.') => `${BRAND}${dot}${TLD}`; // brand immediately joined to TLD = the third party

describe('#1148 no-third-party-domain scanner — deny/allow authority', () => {
    it('DENIES the bare forbidden host', () => {
        expect(scanText(`visit https://${forbidden()}/session`).length).toBe(1);
        expect(FORBIDDEN.test(forbidden())).toBe(true);
    });

    it('DENIES www and sub-domain prefixes (they contain the forbidden substring)', () => {
        expect(scanText(`www.${forbidden()}`).length).toBe(1);
        expect(scanText(`alpha.${forbidden()}`).length).toBe(1);
    });

    it('DENIES email-domain form and common URL/HTML dot encodings', () => {
        expect(scanText(`canary@${forbidden()}`).length).toBe(1);
        expect(scanText(`${forbidden('%2e')}`).length).toBe(1);
        expect(scanText(`${forbidden('&#46;')}`).length).toBe(1);
        expect(scanText(forbidden().toUpperCase()).length).toBe(1); // case-insensitive
    });

    it('DENIES regex-escaped and JavaScript hostname dot escapes (\\., \\u002e, \\x2e)', () => {
        expect(scanText(forbidden('\\.')).length).toBe(1);       // RegExp-source escaped dot
        expect(scanText(forbidden('\\u002e')).length).toBe(1);   // JS unicode escape
        expect(scanText(forbidden('\\x2e')).length).toBe(1);     // JS hex escape
        expect(scanText(forbidden('\\u002E')).length).toBe(1);   // case-insensitive
        // Allowed control: separate tokens with no joining dot must NOT match.
        expect(scanText(`${BRAND} ${TLD} store`).length).toBe(0);
    });

    it('ALLOWS the approved Vercel release-proof host (brand not immediately followed by the dot+TLD)', () => {
        expect(scanText('https://speaksharp-public.vercel.app/session').length).toBe(0);
        expect(FORBIDDEN.test('speaksharp-public.vercel.app')).toBe(false);
    });

    it('ALLOWS the reserved test domain and unrelated brand mentions', () => {
        expect(scanText('first-time-tester@example.com').length).toBe(0);
        expect(scanText('The SpeakSharp product is great.').length).toBe(0);
    });
});
