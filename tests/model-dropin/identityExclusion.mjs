// Maintained-user exclusion (#1760 handover, "Disposable identity vs empty history"): the bounded comparison logs in only as the
// approved disposable identity, never as a maintained shared account. The approval binds the expected user id; this check refuses when
// the injected login is any maintained account that is visible to the runner, and records which ones it compared. Emails never leave
// this function: the receipt carries variable names only.
export const MAINTAINED_ACCOUNT_VARIABLES = Object.freeze(['FREE_TEST_EMAIL', 'PRO_TEST_EMAIL', 'CHECKOUT_TEST_EMAIL',
  'CANARY_TRIAL_EMAIL', 'CANARY_PAID_EMAIL']);

const normalized = value => (typeof value === 'string' ? value.trim().toLowerCase() : '');

export function assertNotMaintainedIdentity(email, env) {
  const login = normalized(email);
  if (!login) throw Error('bounded_identity_missing');
  const compared = [];
  for (const name of MAINTAINED_ACCOUNT_VARIABLES) {
    const maintained = normalized(env[name]);
    if (!maintained) continue;
    compared.push(name);
    if (maintained === login) throw Error('bounded_identity_is_maintained:' + name);
  }
  // An empty comparison is reported as such, never as proof: the exclusion is only as wide as the variables actually present.
  return { maintainedCompared: compared, maintainedNotVisible: MAINTAINED_ACCOUNT_VARIABLES.filter(n => !compared.includes(n)) };
}
