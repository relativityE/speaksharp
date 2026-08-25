// #1306 — BEHAVIOURAL tests for the read-authority classifier.
//
// The previous guard was an `[advisory]` source scan: it checked that a denylist regex appeared in the
// spec. That proved the text existed, not that the classification was correct — and the denylist was
// wrong anyway, since a replica on an unlisted hostname passed it. These EXECUTE the classifier.
import { describe, it, expect } from 'vitest';
import { classifyReadEndpoint } from '../helpers/readEndpointAuthority';

const PRIMARY = 'https://abcdefgh.supabase.co';

describe('read endpoint authority', () => {
    it('PROVES primary only when the read host matches a separately configured primary', () => {
        const v = classifyReadEndpoint(PRIMARY, PRIMARY);
        expect(v.authority).toBe('primary-proven');
        expect(v.maxClaim).toBe('persistence-defect');
    });

    it('accepts a bare host as the configured primary', () => {
        expect(classifyReadEndpoint(PRIMARY, 'abcdefgh.supabase.co').authority).toBe('primary-proven');
    });

    it('is UNKNOWN when no primary is configured — a read cannot vouch for itself', () => {
        for (const cfg of [undefined, null, '', '   ']) {
            const v = classifyReadEndpoint(PRIMARY, cfg);
            expect(v.authority, `cfg=${JSON.stringify(cfg)}`).toBe('unknown');
            expect(v.maxClaim).toBe('read-path-disagreement-authority-unknown');
        }
    });

    it('is UNKNOWN when the read host differs from the configured primary', () => {
        const v = classifyReadEndpoint('https://replica-xyz.supabase.co', PRIMARY);
        expect(v.authority).toBe('unknown');
        expect(v.reason).toMatch(/does not match/);
    });

    it('THE DENYLIST HOLE: an unlisted replica hostname must NOT be called primary', () => {
        // The exact defect this replaces. `db-ro-eu-west-1.example.com` matches none of
        // pooler./read-replica/-replica/.lb. and would have passed the old hostname denylist.
        const sneaky = 'https://db-ro-eu-west-1.example.com';
        expect(classifyReadEndpoint(sneaky, undefined).authority).toBe('unknown');
        expect(classifyReadEndpoint(sneaky, PRIMARY).authority).toBe('unknown');
        expect(/pooler\.|read-replica|-replica|\.lb\./i.test(new URL(sneaky).hostname),
            'and it genuinely evades the old denylist').toBe(false);
    });

    it('unparseable inputs fail to UNKNOWN, never to proven', () => {
        expect(classifyReadEndpoint('not a url', PRIMARY).authority).toBe('unknown');
        expect(classifyReadEndpoint(PRIMARY, 'http://').authority).toBe('unknown');
    });

    it('every UNKNOWN verdict caps the claim, and only a proven one permits "persistence defect"', () => {
        const cases = [
            classifyReadEndpoint(PRIMARY, undefined),
            classifyReadEndpoint('https://other.supabase.co', PRIMARY),
            classifyReadEndpoint('not a url', PRIMARY),
        ];
        for (const v of cases) expect(v.maxClaim).toBe('read-path-disagreement-authority-unknown');
        expect(classifyReadEndpoint(PRIMARY, PRIMARY).maxClaim).toBe('persistence-defect');
    });
});
