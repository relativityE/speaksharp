#!/usr/bin/env node
// READ-ONLY billing-freeze safety check (Beta-50).
//
// Confirms the billing freeze for internal QA / test accounts by enumerating LIVE Stripe state:
//   - no active/trialing/past_due/unpaid/incomplete subscriptions;
//   - no open/draft (scheduled/unpaid) invoices;
//   - no open checkout sessions.
// It ALSO proves the DEPLOYED beta cannot initiate checkout (P0.1): one unauthenticated POST to the
// stripe-checkout Edge Function must be refused before any Stripe call (403 payments_disabled = CLOSED;
// any 2xx checkout URL = OPEN violation). This never creates a Checkout Session.
//
// SAFETY: this script issues Stripe **GET** requests ONLY, plus one non-mutating checkout POST that the
// server fail-closed guard rejects before touching Stripe. It never creates, updates, charges, refunds,
// or cancels anything — no live charge is possible. Exit 0 = clean; 1 = violation(s) found; 2 = misconfig.
//
// Env:
//   STRIPE_SECRET_KEY        live (or test) Stripe secret — read-only use here.
//   BILLING_FREEZE_EMAILS    comma-separated QA/test emails to audit (preferred; keeps emails out of git).
//   PRO_TEST_EMAIL / CHECKOUT_TEST_EMAIL / BASIC_TEST_EMAIL   fallbacks if BILLING_FREEZE_EMAILS is unset.

import { writeFileSync, appendFileSync } from 'node:fs';
import { probeCheckoutClosed, CHECKOUT_PROBE } from './lib/checkout-probe.mjs';

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

// stripeGet error messages embed the full request path, which for the /customers?email=...
// lookup contains the raw (percent-encoded) audited email. Strip any query string before
// this text is persisted anywhere (artifact/summary/logs) so a failure can't leak addresses.
const sanitizeError = (msg) => String(msg ?? '').replace(/\?[^\s]*/g, '').trim();

async function stripeGet(pathname) {
  const res = await fetch(`${STRIPE}${pathname}`, { headers: { Authorization: `Bearer ${key}` } });
  if (!res.ok) throw new Error(`GET ${pathname} -> ${res.status}`);
  return res.json();
}

// Non-destructive deployed-checkout probe (P0.1) — see scripts/lib/checkout-probe.mjs. Fail-closed:
// ONLY a confirmed 403 payments_disabled passes the checkout-closure gate.

// The Checkout Sessions list API has NO email filter, and a session can be created
// with only `customer_email` (no Stripe customer yet) — an abandoned first-time QA
// checkout. So enumerate ALL open sessions and index them by email client-side, so
// accounts with no customer are still audited (not silently passed).
async function listAllOpenSessions() {
  const out = [];
  let startingAfter = null;
  const MAX_PAGES = 20; // 2000 open sessions is pathological for QA; surface if hit
  for (let page = 0; page < MAX_PAGES; page++) {
    const after = startingAfter ? `&starting_after=${startingAfter}` : '';
    const res = await stripeGet(`/checkout/sessions?status=open&limit=100${after}`);
    const data = res.data ?? [];
    // Belt-and-suspenders: filter status client-side in case the query param is ignored.
    out.push(...data.filter((s) => s.status === 'open'));
    if (!res.has_more || data.length === 0) return { data: out, truncated: false };
    startingAfter = data[data.length - 1].id;
  }
  return { data: out, truncated: true };
}

const sessionEmails = (s) =>
  [s.customer_email, s.customer_details?.email]
    .filter(Boolean)
    .map((e) => String(e).toLowerCase());

const ACTIVE_SUB_STATUSES = new Set(['active', 'trialing', 'past_due', 'unpaid', 'incomplete']);
const OPEN_INVOICE_STATUSES = new Set(['open', 'draft']);

const report = [];
let violations = 0;

// Enumerate open Checkout Sessions once and index by email, so the audit covers
// email-only sessions that exist BEFORE any Stripe customer is created.
let openSessionsByEmail = new Map(); // lowercased email -> [session id]
let sessionsTruncated = false;
try {
  const listed = await listAllOpenSessions();
  sessionsTruncated = listed.truncated;
  for (const s of listed.data) {
    for (const e of sessionEmails(s)) {
      if (!openSessionsByEmail.has(e)) openSessionsByEmail.set(e, []);
      openSessionsByEmail.get(e).push(s.id);
    }
  }
} catch (err) {
  // Fail closed: if we cannot enumerate open sessions we cannot confirm the freeze.
  console.error(
    `BILLING_FREEZE_CHECK: could not enumerate open checkout sessions (fail closed): ${sanitizeError(err.message ?? err)}`,
  );
  process.exit(1);
}

for (const email of emails) {
  const emailOpenSessions = openSessionsByEmail.get(email.toLowerCase()) ?? [];
  const masked = maskEmail(email);
  let customers = [];
  try {
    customers = (await stripeGet(`/customers?email=${encodeURIComponent(email)}&limit=100`)).data ?? [];
  } catch (err) {
    report.push({ email: masked, error: sanitizeError(err.message ?? err) });
    violations++; // fail closed: an unreadable account is not "confirmed clean"
    continue;
  }

  if (customers.length === 0) {
    // No Stripe customer yet — but an email-only open Checkout Session can still exist.
    const violation = emailOpenSessions.length > 0;
    if (violation) violations++;
    report.push({
      email: masked,
      noStripeCustomer: true,
      clean: !violation,
      openCheckoutSessions: emailOpenSessions.length,
      openCheckoutSessionSource: 'customer_email (no Stripe customer)',
    });
    continue;
  }

  for (const customer of customers) {
    const subs = (await stripeGet(`/subscriptions?customer=${customer.id}&status=all&limit=100`)).data ?? [];
    const activeSubs = subs.filter((s) => ACTIVE_SUB_STATUSES.has(s.status));
    const invoices = (await stripeGet(`/invoices?customer=${customer.id}&limit=100`)).data ?? [];
    const openInvoices = invoices.filter((i) => OPEN_INVOICE_STATUSES.has(i.status));
    const sessions = (await stripeGet(`/checkout/sessions?customer=${customer.id}&limit=100`)).data ?? [];
    // Union of sessions attached to this customer + email-only sessions not yet
    // attached to any customer id (deduped by session id).
    const openSessionIds = new Set([
      ...sessions.filter((s) => s.status === 'open').map((s) => s.id),
      ...emailOpenSessions,
    ]);

    const violation = activeSubs.length > 0 || openInvoices.length > 0 || openSessionIds.size > 0;
    if (violation) violations++;
    report.push({
      email: masked,
      customer: customer.id,
      clean: !violation,
      activeSubscriptions: activeSubs.length,
      subscriptionStatuses: activeSubs.map((s) => s.status),
      openInvoices: openInvoices.length,
      openCheckoutSessions: openSessionIds.size,
    });
  }
}

if (sessionsTruncated) {
  // Never silently under-count: if the open-session enumeration hit the page cap we
  // cannot prove completeness, so fail closed.
  console.error(
    'BILLING_FREEZE_CHECK: open checkout-session enumeration hit the page cap; cannot confirm completeness — failing closed.',
  );
  violations++;
}

// Non-destructive deployed-checkout probe — FAIL CLOSED. Only a confirmed CLOSED (403 payments_disabled)
// may pass; missing config is NOT RUNNABLE (exit 2); every other outcome fails the freeze.
const checkout = await probeCheckoutClosed({
  baseUrl: process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  anonKey: process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY,
  sanitizeError,
});
if (checkout.classification === CHECKOUT_PROBE.NOT_RUNNABLE) {
  console.error('BILLING_FREEZE_CHECK: checkout probe NOT RUNNABLE — set SUPABASE_URL and SUPABASE_ANON_KEY.');
  process.exit(2);
}
if (checkout.classification !== CHECKOUT_PROBE.CLOSED) {
  console.error(
    `BILLING_FREEZE_CHECK: deployed checkout NOT confirmed closed (classification=${checkout.classification}). ${checkout.detail}`,
  );
  violations++;
}

const mode = key.startsWith('sk_live') ? 'LIVE' : 'test';

// Sanitized audit report — masked emails only, no secrets/raw emails. Uniform per-account
// fields so it is auditable without grepping truncated logs.
const auditReport = {
  mode,
  emailsAudited: emails.length,
  violations,
  sessionsTruncated,
  checkoutEndpoint: {
    classification: checkout.classification, // PASS requires this === 'CLOSED'
    ...(checkout.status !== undefined ? { status: checkout.status } : {}),
    detail: checkout.detail,
  },
  result: violations === 0 ? 'PASS' : 'FAIL',
  report: report.map((r) => ({
    email: r.email, // already masked (maskEmail)
    noStripeCustomer: r.noStripeCustomer ?? false,
    clean: r.clean ?? false,
    activeSubscriptions: r.activeSubscriptions ?? 0,
    subscriptionStatuses: r.subscriptionStatuses ?? [],
    openInvoices: r.openInvoices ?? 0,
    openCheckoutSessions: r.openCheckoutSessions ?? 0,
    openCheckoutSessionSource:
      r.openCheckoutSessionSource ?? (r.noStripeCustomer ? 'customer_email (no Stripe customer)' : 'customer + customer_email'),
    ...(r.customer ? { customer: r.customer } : {}),
    ...(r.error ? { error: r.error } : {}),
  })),
};

// Durable artifact for the workflow to upload (no raw emails/secrets).
const reportPath = process.env.BILLING_FREEZE_REPORT_PATH;
if (reportPath) {
  try {
    writeFileSync(reportPath, JSON.stringify(auditReport, null, 2));
  } catch (err) {
    console.error(`BILLING_FREEZE_CHECK: could not write report to ${reportPath}: ${String(err.message ?? err)}`);
  }
}

// GitHub step summary — renders on the run page (not truncated like step logs).
const summaryPath = process.env.GITHUB_STEP_SUMMARY;
if (summaryPath) {
  const rows = auditReport.report
    .map((r) =>
      `| \`${r.email}\` | ${r.noStripeCustomer ? 'yes' : 'no'} | ${r.activeSubscriptions} | ${r.openInvoices} | ${r.openCheckoutSessions} | ${r.error ? '⚠️ error' : r.clean ? '✅' : '❌'} |`,
    )
    .join('\n');
  const md = [
    `## Billing Freeze Check — ${mode}`,
    ``,
    `**result: ${auditReport.result}** · violations: ${violations} · emailsAudited: ${emails.length}${sessionsTruncated ? ' · ⚠️ session enumeration truncated (failed closed)' : ''}`,
    ``,
    `| account (masked) | no-customer | active subs | open invoices | open checkout | clean |`,
    `|---|---|---|---|---|---|`,
    rows,
    ``,
  ].join('\n');
  try {
    appendFileSync(summaryPath, md);
  } catch (err) {
    console.error(`BILLING_FREEZE_CHECK: could not write step summary: ${String(err.message ?? err)}`);
  }
}

console.log(`BILLING_FREEZE_CHECK ${JSON.stringify(auditReport, null, 2)}`);
console.log(violations === 0
  ? 'BILLING_FREEZE_CHECK: PASS — Stripe freeze clean AND deployed checkout confirmed CLOSED (403 payments_disabled).'
  : `BILLING_FREEZE_CHECK: FAIL — ${violations} issue(s) (Stripe billing artifacts and/or checkout not confirmed closed). Investigate before GO.`);
process.exit(violations === 0 ? 0 : 1);
