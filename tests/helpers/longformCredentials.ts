/**
 * #1500 — THE PRIVATE LONG-FORM PROOF USES ITS CONFIGURED IDENTITY, OR IT FAILS.
 *
 * `private-longform-timing.live.spec.ts` resolved its reusable account as a checked-in email plus
 * `PRIVATE_LONGFORM_REUSE_PASSWORD ?? <checked-in password>`. The repository is public, so that pair was a
 * public credential: the spec signs UP before it signs in, so any environment it ran against gained an
 * account anyone could sign into. The fallback also hid misconfiguration — a missing secret never failed,
 * it silently selected the public credential (the #1492 defect class).
 *
 * Same shape as `resolveCheckoutCredentials()`: one atomic pair from configuration (email from a
 * repository Variable, password from a Secret, per the #1294 sourcing split), no fallback list, and a
 * missing member is a FAILURE naming the variable — never a skip, never a substitute, never the value.
 */

export type LongformCredentialVariable = 'PRIVATE_LONGFORM_REUSE_EMAIL' | 'PRIVATE_LONGFORM_REUSE_PASSWORD';

export type LongformCredentialEnv = Partial<Record<LongformCredentialVariable, string>>;

export type LongformCredentialResolution =
    | { ok: true; email: string; password: string }
    | { ok: false; reason: string; missing: readonly LongformCredentialVariable[] };

const present = (value: unknown): value is string =>
    typeof value === 'string' && value.trim().length > 0;

/** The ONLY accepted source for this proof's identity. There is no fallback list to extend. */
export const resolveLongformCredentials = (
    env: LongformCredentialEnv = process.env as LongformCredentialEnv,
): LongformCredentialResolution => {
    const missing: LongformCredentialVariable[] = [];
    if (!present(env.PRIVATE_LONGFORM_REUSE_EMAIL)) missing.push('PRIVATE_LONGFORM_REUSE_EMAIL');
    if (!present(env.PRIVATE_LONGFORM_REUSE_PASSWORD)) missing.push('PRIVATE_LONGFORM_REUSE_PASSWORD');

    if (missing.length > 0) {
        return {
            ok: false,
            missing,
            reason:
                `configuration defect: the Private long-form proof requires its credential pair and has no fallback: ${missing.join(' and ')} `
                + 'absent. Set the email as a repository Variable and the password as a Secret.',
        };
    }

    return {
        ok: true,
        // The email is an identifier, so surrounding whitespace is configuration noise.
        email: env.PRIVATE_LONGFORM_REUSE_EMAIL!.trim(),
        // The password is returned exactly as configured (see #1492): trimming would authenticate with a
        // different string than the one set on the account.
        password: env.PRIVATE_LONGFORM_REUSE_PASSWORD!,
    };
};
