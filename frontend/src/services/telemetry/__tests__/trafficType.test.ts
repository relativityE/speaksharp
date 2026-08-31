import { describe, expect, it } from 'vitest';
import {
    TRAFFIC_TYPES, buildTrafficSignals, parseCanaryAccountIds, resolveTrafficType,
} from '../trafficType';

const CANARY = 'aaaaaaaa-1111-2222-3333-444444444444';
const REAL = 'bbbbbbbb-9999-8888-7777-666666666666';

describe('a canary session CANNOT report itself as a user', () => {
    it('CASUALTY: the canary account resolves to canary, never user', () => {
        // If a canary run can emit traffic_type: user, the field is decorative and the silence problem
        // is simply relocated — our own smoke traffic indistinguishable from the first real testers.
        const t = resolveTrafficType({ accountId: CANARY, canaryAccountIds: [CANARY] });
        expect(t).toBe('canary');
        expect(t).not.toBe('user');
    });

    it('CASUALTY: classification does not depend on the harness DECLARING anything', () => {
        // The canary sets no flag; being that account is the signal, so there is nothing to forget.
        // The signals here contain no self-declaration at all.
        const signals = { accountId: CANARY, canaryAccountIds: [CANARY] };
        expect(Object.keys(signals)).not.toContain('trafficType');
        expect(resolveTrafficType(signals)).toBe('canary');
    });

    it('matches case-insensitively and ignores surrounding whitespace', () => {
        // An id that differs only by case or padding must not slip through as a user.
        expect(resolveTrafficType({ accountId: `  ${CANARY.toUpperCase()} `, canaryAccountIds: [CANARY] }))
            .toBe('canary');
    });
});

describe('user is the FAIL-TOWARD default', () => {
    it('an unknown account is a user', () => {
        expect(resolveTrafficType({ accountId: REAL, canaryAccountIds: [CANARY] })).toBe('user');
    });

    it('a signed-out session is a user, not a canary', () => {
        expect(resolveTrafficType({ accountId: null, canaryAccountIds: [CANARY] })).toBe('user');
    });

    it('CASUALTY: no configured canary list must NOT make everyone canary', () => {
        // Failing toward `canary` would HIDE real users — the error that cannot be detected after the
        // fact. Over-counting our own traffic as real is visible and correctable.
        expect(resolveTrafficType({ accountId: REAL })).toBe('user');
        expect(resolveTrafficType({})).toBe('user');
        expect(resolveTrafficType({ accountId: REAL, canaryAccountIds: [] })).toBe('user');
    });
});

describe('internal comes from the BUILD, not a runtime toggle', () => {
    it('an internal build reports internal even for an ordinary account', () => {
        expect(resolveTrafficType({ internalBuild: true, accountId: REAL })).toBe('internal');
    });

    it('internal outranks canary — an internal build is our traffic either way', () => {
        expect(resolveTrafficType({ internalBuild: true, accountId: CANARY, canaryAccountIds: [CANARY] }))
            .toBe('internal');
    });

    it('CASUALTY: a non-boolean internal signal does not enable internal', () => {
        // Only an explicit true. A truthy string from a mis-set env must not reclassify traffic.
        expect(resolveTrafficType({ internalBuild: 'true' as unknown as boolean, accountId: REAL })).toBe('user');
    });
});

describe('the value is a closed enum, and build signals are read from env', () => {
    it('every resolvable value is in the closed vocabulary', () => {
        const values = [
            resolveTrafficType({ internalBuild: true }),
            resolveTrafficType({ accountId: CANARY, canaryAccountIds: [CANARY] }),
            resolveTrafficType({}),
        ];
        for (const v of values) expect(TRAFFIC_TYPES).toContain(v);
        expect([...TRAFFIC_TYPES]).toEqual(['user', 'canary', 'internal']);
    });

    it('a malformed canary list yields NO known accounts rather than a guess', () => {
        expect(parseCanaryAccountIds(undefined)).toEqual([]);
        expect(parseCanaryAccountIds('')).toEqual([]);
        expect(parseCanaryAccountIds(' , , ')).toEqual([]);
        expect(parseCanaryAccountIds(`${CANARY}, ${REAL}`)).toEqual([CANARY, REAL]);
    });

    it('build signals come from env, and the account is supplied separately', () => {
        const s = buildTrafficSignals(
            { VITE_INTERNAL_BUILD: 'true', VITE_CANARY_ACCOUNT_IDS: CANARY },
            REAL,
        );
        expect(s.internalBuild).toBe(true);
        expect(s.canaryAccountIds).toEqual([CANARY]);
        expect(s.accountId).toBe(REAL);
        expect(resolveTrafficType(s)).toBe('internal');
    });

    it('CASUALTY: an absent env does not silently mark traffic internal', () => {
        const s = buildTrafficSignals({}, REAL);
        expect(s.internalBuild).toBe(false);
        expect(resolveTrafficType(s)).toBe('user');
    });
});
