const PROHIBITED_DOMAINS = new Set(['speaksharp.app']);

const normalizeEmail = (value) => typeof value === 'string' ? value.trim().toLowerCase() : '';

const emailDomain = (email) => {
  const match = /^[^@\s]+@([^@\s]+)$/.exec(email);
  return match?.[1] ?? null;
};

const isProhibitedDomain = (domain) => [...PROHIBITED_DOMAINS]
  .some((blocked) => domain === blocked || domain.endsWith(`.${blocked}`));

export function validateCanaryIdentityConfig({ trialEmail, paidEmail }) {
  const trial = normalizeEmail(trialEmail);
  const paid = normalizeEmail(paidEmail);
  const trialDomain = emailDomain(trial);
  const paidDomain = emailDomain(paid);

  if (!trialDomain || !paidDomain) throw new Error('protected canary identities are missing or invalid');
  if (trial === paid) throw new Error('protected canary identities must be distinct');
  if (isProhibitedDomain(trialDomain) || isProhibitedDomain(paidDomain)) {
    throw new Error('protected canary identity uses a prohibited domain');
  }

  return Object.freeze({ valid: true, distinct: true, prohibited_domain: false });
}
