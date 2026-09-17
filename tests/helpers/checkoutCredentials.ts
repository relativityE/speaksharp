/**
 * #1294 / #1492 — THE PAID CHECKOUT PROOF USES ITS OWN IDENTITY, OR IT FAILS.
 *
 * `stripe-checkout-readiness` used to resolve its identity through two INDEPENDENT fallback chains:
 *
 *   email    = CHECKOUT_TEST_EMAIL    ?? FREE_TEST_EMAIL    ?? E2E_FREE_EMAIL    ?? PRO_TEST_EMAIL    ?? ...
 *   password = CHECKOUT_TEST_PASSWORD ?? FREE_TEST_PASSWORD ?? E2E_FREE_PASSWORD ?? PRO_TEST_PASSWORD ?? ...
 *
 * Two defects followed from that shape, and the second is the worse one.
 *
 * Wrong role: the proof exists to exercise a dedicated clean live-mode Stripe customer. Falling back to
 * the FREE reviewer leaves live-mode customer state on an account whose purpose is to be a clean Free
 * tier, and drops the dedicated identity from the billing-freeze audit that reads the same name.
 *
 * MIXED IDENTITY: because the chains are resolved independently, the email and the password could come
 * from DIFFERENT accounts — `CHECKOUT_TEST_EMAIL` with `FREE_TEST_PASSWORD`, for instance. That pair
 * authenticates as nobody, so the proof fails for a reason that has nothing to do with checkout, and the
 * failure points at Stripe rather than at configuration.
 *
 * The fix is to stop treating the two halves as independently substitutable. A credential is a PAIR, and
 * this proof accepts exactly one pair. When either member is absent the answer is a failure, never a
 * skip: a skipped release gate reports green having proven nothing, which is the same "absence read as
 * pass" defect the canary work exists to remove.
 */

export interface CheckoutCredentialEnv {
    CHECKOUT_TEST_EMAIL?: string;
    CHECKOUT_TEST_PASSWORD?: string;
}

export type CheckoutCredentialResolution =
    | { ok: true; email: string; password: string }
    | { ok: false; reason: string; missing: readonly ('CHECKOUT_TEST_EMAIL' | 'CHECKOUT_TEST_PASSWORD')[] };

const present = (value: unknown): value is string =>
    typeof value === 'string' && value.trim().length > 0;

/**
 * The ONLY accepted source for this proof's identity. Both members come from the checkout role or the
 * call fails; there is no fallback list to extend, so a future edit cannot quietly reintroduce one.
 */
export const resolveCheckoutCredentials = (
    env: CheckoutCredentialEnv = process.env as CheckoutCredentialEnv,
): CheckoutCredentialResolution => {
    const missing: ('CHECKOUT_TEST_EMAIL' | 'CHECKOUT_TEST_PASSWORD')[] = [];
    if (!present(env.CHECKOUT_TEST_EMAIL)) missing.push('CHECKOUT_TEST_EMAIL');
    if (!present(env.CHECKOUT_TEST_PASSWORD)) missing.push('CHECKOUT_TEST_PASSWORD');

    if (missing.length > 0) {
        return {
            ok: false,
            missing,
            reason:
                `the paid checkout proof requires its dedicated credential pair and will not substitute another role: ${missing.join(' and ')} `
                + 'absent. Configure the checkout identity rather than allowing this gate to run as the Free or Pro reviewer.',
        };
    }

    return {
        ok: true,
        email: env.CHECKOUT_TEST_EMAIL!.trim(),
        password: env.CHECKOUT_TEST_PASSWORD!.trim(),
    };
};
