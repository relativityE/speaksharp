const PROHIBITED_DOMAINS = new Set(['speaksharp.app']);

const normalizeEmail = (value) => typeof value === 'string' ? value.trim().toLowerCase() : '';

const emailDomain = (email) => {
  const match = /^[^@\s]+@([^@\s]+)$/.exec(email);
  return match?.[1] ?? null;
};

const isProhibitedDomain = (domain) => [...PROHIBITED_DOMAINS]
  .some((blocked) => domain === blocked || domain.endsWith(`.${blocked}`));

const isPresentSecret = (value) => typeof value === 'string' && value.trim().length > 0;

/**
 * #1294 sourcing split — enforce that canary EMAILS (identifiers, resolved from repository Variables) and
 * canary PASSWORDS (credentials, resolved from Secrets) are BOTH fully wired before the canary/admin flow
 * runs. The guard is content-free: it validates the email identifiers (present, syntactically valid,
 * distinct, not the unaffiliated speaksharp.app apex/subdomain) and asserts each password is present —
 * WITHOUT ever reading, comparing, or logging a password value. A missing password fails closed here so a
 * mis-sourced secret is caught at the guard, not as an opaque downstream sign-in failure.
 */
export function validateCanaryIdentityConfig({ trialEmail, paidEmail, trialPassword, paidPassword }) {
  const trial = normalizeEmail(trialEmail);
  const paid = normalizeEmail(paidEmail);
  const trialDomain = emailDomain(trial);
  const paidDomain = emailDomain(paid);

  if (!trialDomain || !paidDomain) throw new Error('protected canary identities are missing or invalid');
  if (trial === paid) throw new Error('protected canary identities must be distinct');
  if (isProhibitedDomain(trialDomain) || isProhibitedDomain(paidDomain)) {
    throw new Error('protected canary identity uses a prohibited domain');
  }
  // Passwords are Secrets: assert PRESENCE only (never the value). A blank password means the Secret is
  // absent/mis-sourced — fail closed with a content-free message that never names which value was seen.
  if (!isPresentSecret(trialPassword) || !isPresentSecret(paidPassword)) {
    throw new Error('protected canary password secret is missing');
  }

  return Object.freeze({ valid: true, distinct: true, prohibited_domain: false, passwords_present: true });
}
