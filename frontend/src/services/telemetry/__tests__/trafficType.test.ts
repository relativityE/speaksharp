import { describe, expect, it } from 'vitest';
import {
    TRAFFIC_TYPES, buildTrafficSignals, resolveTrafficType,
} from '../trafficType';

const CANARY = 'aaaaaaaa-1111-2222-3333-444444444444';
const TESTER = 'po-tester-account-id';
const REAL = 'bbbbbbbb-9999-8888-7777-666666666666';

describe('a canary session CANNOT report itself as a user', () => {
    it('CASUALTY: the canary account resolves to canary, never user', () => {
        // If a canary run can emit traffic_type: user, the field is decorative and the silence problem
        // is simply relocated — our own smoke traffic indistinguishable from the first real testers.
        const t = resolveTrafficType({ accountId: CANARY, canaryClaim: true });
        expect(t).toBe('canary');
        expect(t).not.toBe('user');
    });

    it('CASUALTY: classification does not depend on the harness DECLARING anything', () => {
        // The canary sets no flag; being that account is the signal, so there is nothing to forget.
        // The signals here contain no self-declaration at all.
        const signals = { accountId: CANARY, canaryClaim: true };
        expect(Object.keys(signals)).not.toContain('trafficType');
        expect(resolveTrafficType(signals)).toBe('canary');
    });

    it('matches case-insensitively and ignores surrounding whitespace', () => {
        // An id that differs only by case or padding must not slip through as a user.
        expect(resolveTrafficType({ accountId: `  ${CANARY.toUpperCase()} `, canaryClaim: true }))
            .toBe('canary');
    });
});

describe('user is the FAIL-TOWARD default', () => {
    // These previously asserted that an account ABSENT FROM A CONFIGURED LIST resolves to `user`.
    // That list is gone: it was `VITE_CANARY_ACCOUNT_IDS`, and every `VITE_*` value is compiled into
    // the public browser bundle, so shipping it published the identifiers of our own test accounts to
    // every visitor. The authority is now a server-assigned claim, and the claim IS the signal —
    // so "a real account carrying the claim" is no longer a contradiction to be resolved toward
    // `user`; it is a canary. Rewritten to the contract that actually exists rather than adjusted
    // until green.
    it('an account with no claim is a user', () => {
        expect(resolveTrafficType({ accountId: REAL })).toBe('user');
    });

    it('a signed-out session is a user, even if a claim is somehow present', () => {
        // No account, no classification: the claim is meaningless without the identity it was
        // assigned to.
        expect(resolveTrafficType({ accountId: null, canaryClaim: true })).toBe('user');
    });

    it('CASUALTY: absent or false claims must NOT make everyone canary', () => {
        // Failing toward `canary` would HIDE real users — the error that cannot be detected after the
        // fact. Over-counting our own traffic as real is visible and correctable.
        expect(resolveTrafficType({ accountId: REAL })).toBe('user');
        expect(resolveTrafficType({})).toBe('user');
        expect(resolveTrafficType({ accountId: REAL, canaryClaim: false })).toBe('user');
        // Only an exact `true` classifies; a truthy non-boolean must not.
        expect(resolveTrafficType({ accountId: REAL, canaryClaim: 1 as unknown as boolean })).toBe('user');
    });
});

describe('internal comes from the BUILD, not a runtime toggle', () => {
    it('an internal build reports internal even for an ordinary account', () => {
        expect(resolveTrafficType({ internalBuild: true, accountId: REAL })).toBe('internal');
    });

    it('internal outranks canary — an internal build is our traffic either way', () => {
        expect(resolveTrafficType({ internalBuild: true, accountId: CANARY, canaryClaim: true }))
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
            resolveTrafficType({ accountId: CANARY, canaryClaim: true }),
            resolveTrafficType({ accountId: TESTER, internalTesterClaim: true }),
            resolveTrafficType({}),
        ];
        for (const v of values) expect(TRAFFIC_TYPES).toContain(v);
        expect([...TRAFFIC_TYPES]).toEqual(['user', 'canary', 'internal_test', 'internal']);
    });

    describe('#1259 — internal_test: a SERVER-ISSUED claim, never a shipped allowlist', () => {
        it('classifies a claimed account distinctly from a customer', () => {
            // The PO's Production session read `user` — indistinguishable from a real customer in
            // every funnel. That is what this value fixes.
            expect(resolveTrafficType({ accountId: TESTER, internalTesterClaim: true }))
                .toBe('internal_test');
            expect(resolveTrafficType({ accountId: REAL, internalTesterClaim: false }))
                .toBe('user');
        });

        it('only the BOOLEAN true grants it — a truthy value is not a claim', () => {
            // The producer already narrows to `=== true`, so this is defence at the classifier itself:
            // a malformed session, a string "false", or a stray object must never classify traffic as
            // internal. Every one of those is truthy, and every one of them would hide real traffic.
            for (const truthy of ['true', 'false', 1, {}, []] as unknown[]) {
                expect(
                    resolveTrafficType({ accountId: TESTER, internalTesterClaim: truthy as boolean }),
                    `truthy value ${JSON.stringify(truthy)} must not grant internal_test`,
                ).toBe('user');
            }
        });

        it('a claim WITHOUT an authenticated account is ignored — it has no issuer', () => {
            // The claim travels inside the session. Honouring it with nobody signed in would accept a
            // classification that nothing issued.
            expect(resolveTrafficType({ accountId: null, internalTesterClaim: true })).toBe('user');
        });

        it('is NOT folded into canary — collapsing them corrupts both buckets', () => {
            // A dashboard excluding `canary` would silently absorb human dogfood takes, and "how did
            // the automated canary do this week?" would be answered with hand-typed data.
            expect(resolveTrafficType({ accountId: TESTER, internalTesterClaim: true }))
                .not.toBe('canary');
        });

        it('canary outranks the claim when an account is somehow both', () => {
            expect(resolveTrafficType({
                accountId: CANARY, canaryClaim: true, internalTesterClaim: true,
            })).toBe('canary');
        });

        it('an internal BUILD still outranks every account-based class', () => {
            expect(resolveTrafficType({
                internalBuild: true, accountId: TESTER, internalTesterClaim: true,
            })).toBe('internal');
        });

        it('NO BUILD-TIME VARIABLE can grant it — the allowlist is gone from the bundle', () => {
            // The first version read `VITE_INTERNAL_TEST_ACCOUNT_IDS`, and every `VITE_*` value is
            // compiled into the public browser bundle — publishing the tester account ids to every
            // visitor. Env can no longer produce this classification at all.
            const signals = buildTrafficSignals(
                { VITE_INTERNAL_TEST_ACCOUNT_IDS: `${TESTER},other-id` } as Record<string, string>,
                TESTER,
            );
            expect(resolveTrafficType(signals)).toBe('user');
            expect(Object.keys(signals)).not.toContain('internalTestAccountIds');
        });

        it('the claim reaches the classifier only when the SERVER supplied it', () => {
            expect(resolveTrafficType(buildTrafficSignals({}, TESTER, true))).toBe('internal_test');
            expect(resolveTrafficType(buildTrafficSignals({}, TESTER, false))).toBe('user');
        });

        it('an absent claim classifies nobody — no default tester', () => {
            expect(resolveTrafficType(buildTrafficSignals({}, TESTER))).toBe('user');
        });
    });

    it('#1259 NO account allowlist reaches the bundle — for the canary either', () => {
        // `VITE_CANARY_ACCOUNT_IDS` is gone along with its parser. Fixing the internal-tester list
        // while keeping this one would have left the identical defect under a different name: every
        // `VITE_*` value is compiled into the public browser bundle, so configuring it published the
        // canary's account id to every visitor. Env can no longer produce `canary` at all.
        const s = buildTrafficSignals(
            { VITE_CANARY_ACCOUNT_IDS: CANARY } as Record<string, string>,
            CANARY,
        );
        expect(resolveTrafficType(s)).toBe('user');
        expect(Object.keys(s)).not.toContain('canaryAccountIds');
    });

    it('build signals come from env, and the account is supplied separately', () => {
        const s = buildTrafficSignals({ VITE_INTERNAL_BUILD: 'true' }, REAL);
        expect(s.internalBuild).toBe(true);
        expect(s.accountId).toBe(REAL);
        expect(resolveTrafficType(s)).toBe('internal');
    });

    it('#1259 the canary is a SERVER claim now, and still outranks internal_test', () => {
        expect(resolveTrafficType({ accountId: CANARY, canaryClaim: true })).toBe('canary');
        expect(resolveTrafficType({
            accountId: CANARY, canaryClaim: true, internalTesterClaim: true,
        })).toBe('canary');
        // Strict, like the other claim: a truthy value is not a claim.
        expect(resolveTrafficType({
            accountId: CANARY, canaryClaim: 'yes' as unknown as boolean,
        })).toBe('user');
    });

    it('CASUALTY: an absent env does not silently mark traffic internal', () => {
        const s = buildTrafficSignals({}, REAL);
        expect(s.internalBuild).toBe(false);
        expect(resolveTrafficType(s)).toBe('user');
    });
});
