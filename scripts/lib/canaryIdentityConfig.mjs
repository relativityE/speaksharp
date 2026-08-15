const PROHIBITED_DOMAINS = new Set(['speaksharp.app']);

const normalizeEmail = (value) => typeof value === 'string' ? value.trim().toLowerCase() : '';

const emailDomain = (email) => {
  const match = /^[^@\s]+@([^@\s]+)$/.exec(email);
  return match?.[1] ?? null;
};

const isProhibitedDomain = (domain) => [...PROHIBITED_DOMAINS]
  .some((blocked) => domain === blocked || domain.endsWith(`.${blocked}`));

const isPresentSecret = (value) => typeof value === 'string' && value.trim().length > 0;

export const CANARY_LANES = Object.freeze(['active-trial', 'paid-continuation']);

/**
 * #1294 sourcing split — enforce that canary EMAILS (identifiers, resolved from repository Variables) are
 * fully wired, and that ONLY the SELECTED lane's PASSWORD (a Secret) is present — before the canary flow
 * runs. Email distinctness/domain is a config invariant validated for BOTH identities regardless of lane;
 * the password requirement is scoped to the running lane, so a routine active-trial run never depends on
 * CANARY_PAID_PASSWORD (and vice-versa). The guard is content-free: it never reads, compares, or logs a
 * password value — it asserts PRESENCE only, failing closed on a mis-sourced/absent secret so the problem
 * is caught here rather than as an opaque downstream sign-in failure.
 *
 * @param {object} args
 * @param {string} args.trialEmail   CANARY_TRIAL_EMAIL (Variable)
 * @param {string} args.paidEmail    CANARY_PAID_EMAIL (Variable)
 * @param {string} args.lane         the selected lane ('active-trial' | 'paid-continuation')
 * @param {string} args.lanePassword the SELECTED lane's password Secret (only this one is required)
 */
export function validateCanaryIdentityConfig({ trialEmail, paidEmail, lane, lanePassword }) {
  const trial = normalizeEmail(trialEmail);
  const paid = normalizeEmail(paidEmail);
  const trialDomain = emailDomain(trial);
  const paidDomain = emailDomain(paid);

  // Both emails are always validated — distinctness/domain is a config invariant independent of the lane.
  if (!trialDomain || !paidDomain) throw new Error('protected canary identities are missing or invalid');
  if (trial === paid) throw new Error('protected canary identities must be distinct');
  if (isProhibitedDomain(trialDomain) || isProhibitedDomain(paidDomain)) {
    throw new Error('protected canary identity uses a prohibited domain');
  }

  if (!CANARY_LANES.includes(lane)) throw new Error('unknown canary lane');
  // Only the SELECTED lane's password is required (Secret; PRESENCE only, never the value/name).
  if (!isPresentSecret(lanePassword)) {
    throw new Error(`protected canary password secret is missing for lane ${lane}`);
  }

  return Object.freeze({ valid: true, distinct: true, prohibited_domain: false, lane, lane_password_present: true });
}
