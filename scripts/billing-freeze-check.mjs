#!/usr/bin/env node
// READ-ONLY billing-freeze safety check (Beta-50).
//
// Confirms the billing freeze for internal QA / test accounts by enumerating LIVE Stripe state:
//   - no active/trialing/past_due/unpaid/incomplete subscriptions;
//   - no open/draft (scheduled/unpaid) invoices;
//   - no open checkout sessions.
//
// SAFETY: this script issues Stripe **GET** requests ONLY. It never creates, updates, charges, refunds,
// or cancels anything — no live charge is possible. Exit 0 = clean; 1 = violation(s) found; 2 = misconfig.
//
// Env:
//   STRIPE_SECRET_KEY        live (or test) Stripe secret — read-only use here.
//   BILLING_FREEZE_EMAILS    comma-separated QA/test emails to audit (preferred; keeps emails out of git).
//   PRO_TEST_EMAIL / CHECKOUT_TEST_EMAIL / BASIC_TEST_EMAIL   fallbacks if BILLING_FREEZE_EMAILS is unset.

const STRIPE = 'https://api.stripe.com/v1';
const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.error('BILLING_FREEZE_CHECK: STRIPE_SECRET_KEY is required (read-only).');
  process.exit(2);
}

const emails = (
  process.env.BILLING_FREEZE_EMAILS ||
  [process.env.PRO_TEST_EMAIL, process.env.CHECKOUT_TEST_EMAIL, process.env.BASIC_TEST_EMAIL]
    .filter(Boolean)
    .join(',')
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

if (emails.length === 0) {
  console.error('BILLING_FREEZE_CHECK: no emails to audit (set BILLING_FREEZE_EMAILS).');
  process.exit(2);
}

const maskEmail = (email) => {
  const [user, domain] = String(email).split('@');
  if (!domain) return '***';
  return `${user.slice(0, 1)}***@${domain}`;
};

async function stripeGet(pathname) {
  const res = await fetch(`${STRIPE}${pathname}`, { headers: { Authorization: `Bearer ${key}` } });
  if (!res.ok) throw new Error(`GET ${pathname} -> ${res.status}`);
  return res.json();
}

const ACTIVE_SUB_STATUSES = new Set(['active', 'trialing', 'past_due', 'unpaid', 'incomplete']);
const OPEN_INVOICE_STATUSES = new Set(['open', 'draft']);

const report = [];
let violations = 0;

for (const email of emails) {
  const masked = maskEmail(email);
  let customers = [];
  try {
    customers = (await stripeGet(`/customers?email=${encodeURIComponent(email)}&limit=100`)).data ?? [];
  } catch (err) {
    report.push({ email: masked, error: String(err.message ?? err) });
    violations++; // fail closed: an unreadable account is not "confirmed clean"
    continue;
  }

  if (customers.length === 0) {
    report.push({ email: masked, noStripeCustomer: true });
    continue;
  }

  for (const customer of customers) {
    const subs = (await stripeGet(`/subscriptions?customer=${customer.id}&status=all&limit=100`)).data ?? [];
    const activeSubs = subs.filter((s) => ACTIVE_SUB_STATUSES.has(s.status));
    const invoices = (await stripeGet(`/invoices?customer=${customer.id}&limit=100`)).data ?? [];
    const openInvoices = invoices.filter((i) => OPEN_INVOICE_STATUSES.has(i.status));
    const sessions = (await stripeGet(`/checkout/sessions?customer=${customer.id}&limit=100`)).data ?? [];
    const openSessions = sessions.filter((s) => s.status === 'open');

    const violation = activeSubs.length > 0 || openInvoices.length > 0 || openSessions.length > 0;
    if (violation) violations++;
    report.push({
      email: masked,
      customer: customer.id,
      clean: !violation,
      activeSubscriptions: activeSubs.length,
      subscriptionStatuses: activeSubs.map((s) => s.status),
      openInvoices: openInvoices.length,
      openCheckoutSessions: openSessions.length,
    });
  }
}

const mode = key.startsWith('sk_live') ? 'LIVE' : 'test';
console.log(
  `BILLING_FREEZE_CHECK ${JSON.stringify({ mode, emailsAudited: emails.length, violations, report }, null, 2)}`,
);
console.log(violations === 0
  ? 'BILLING_FREEZE_CHECK: PASS — no active subscriptions / open invoices / open checkout sessions for audited accounts.'
  : `BILLING_FREEZE_CHECK: FAIL — ${violations} account(s) have live billing artifacts. Investigate before GO.`);
process.exit(violations === 0 ? 0 : 1);
