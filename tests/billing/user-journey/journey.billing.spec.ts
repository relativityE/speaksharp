import { test, expect, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import sandboxTarget from './sandbox-target.json' with { type: 'json' };
import localStackTarget from './sandbox-target.local.json' with { type: 'json' };
import { runnerPreflight } from './runnerPreflight.mjs';
import { BILLING_JOURNEYS, FULL_MODE_JOURNEYS, selectRunnerJourneys, receipt, requireFact, assertSandboxConfiguration, PENDING_POLICY,
  assertTestPrice, assertInvoice, isCorrelatedDelivery, safeFailureReason, testClockCreateFields, localStackStatus,
  assertFullRefund, isRefundCancellation, assertCheckoutGrantedNothing,
  type RunnerJourney, type BillingEvent } from './contract';
import { cleanupRunOwnedAccount } from '../../live/helpers/runOwnedCleanup';
import { selectBenchmarkMode, preparePrivateModelIfPrompted, startBenchmarkRecording,
  expectBenchmarkRecordingStarted, expectBenchmarkTranscriptOutput, stopBenchmarkRecording,
  waitForBenchmarkSaveCandidate } from '../../live/helpers/benchmark-utils';

// Untrusted provider fields are checked at their assertion boundary before being counted as evidence.
type Obj = {
  id: string; livemode: boolean; status: string; customer: string; subscription: string | { id: string };
  data: unknown; has_more: boolean; deleted: boolean; metadata: Record<string, string>; mode: string;
  client_reference_id: string; success_url: string; payment_status: string; trial_start: number | null;
  trial_end: number | null; latest_invoice: string | { id: string }; current_period_end: number;
  cancel_at_period_end: boolean; canceled_at: number | null; items: { data: { price: Obj }[] };
  trial_started_at: string; trial_expires_at: string; commercial_trial_granted_at: string;
  stripe_customer_id: string; stripe_subscription_id: string; subscription_id: string;
  subscription_status: string; can_start: boolean; is_pro: boolean; trial_active: boolean;
  charge: string | { id: string } | null; amount_paid: number; card: { last4?: string } | null;
};
const env = process.env;
// The disposable local stack (billing-local-stack-journey.yml) selects its own committed loopback target.
// Anything other than the exact value keeps the reviewed hosted-sandbox target.
const useLocalStack = env.BILLING_SANDBOX_TARGET === 'local-disposable-stack';
const committedTarget = useLocalStack ? localStackTarget : sandboxTarget;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const id = (value: unknown): string => typeof value === 'string' ? value
  : value && typeof value === 'object' && 'id' in value ? String(value.id) : '';

/** No POST to stripe-webhook, no signing key, no local replay, and no entitlement writes after fixture setup. */
class SandboxJourney {
  readonly steps = new Set<string>();
  readonly marker = `rwt-journey-billing-${randomUUID()}`;
  readonly email = `${this.marker}@example.com`;
  readonly password = `Test-${randomUUID()}!`;
  readonly targets = assertSandboxConfiguration(env, committedTarget);
  readonly admin: SupabaseClient = createClient(this.targets.api, env.BILLING_SANDBOX_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } });
  readonly member: SupabaseClient = createClient(this.targets.api, env.BILLING_SANDBOX_ANON_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } });
  readonly eventIds = new Set<string>();
  uid = ''; customer = ''; subscription = ''; clock = ''; session = ''; savedSession = '';
  signupAttempted = false;
  uncertainStripeCreate = false;
  stage = 'preflight';
  startedAt = Math.floor(Date.now() / 1000) - 5;
  constructor(readonly journey: RunnerJourney, readonly page: Page) {}

  async stripe(path: string, method = 'GET', fields: Record<string, string> = {}): Promise<Obj> {
    // Paths are private in-memory identifiers. No provider error body is ever emitted.
    let response: Response;
    try {
      response = await fetch(`https://api.stripe.com/v1/${path}`, {
        method, redirect: 'error', signal: AbortSignal.timeout(30_000),
        headers: { Authorization: `Bearer ${env.BILLING_SANDBOX_STRIPE_KEY}`, 'Stripe-Version': '2024-06-20',
          ...(method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded',
            'Idempotency-Key': `${this.marker}-${randomUUID()}` } : {}) },
        ...(method === 'POST' ? { body: new URLSearchParams(fields) } : {}),
      });
    } catch { throw new Error('BILLING_JOURNEY:stripe_transport_uncertain'); }
    requireFact(response.ok, 'stripe_request_failed');
    return response.json();
  }

  async poll<T>(read: () => Promise<T>, accepts: (value: T) => boolean, code: string): Promise<T> {
    const deadline = Date.now() + 120_000;
    do {
      const value = await read();
      if (accepts(value)) return value;
      await sleep(1500);
    } while (Date.now() < deadline);
    throw new Error(`BILLING_JOURNEY:${code}`);
  }

  async profile(): Promise<Obj> {
    const { data, error } = await this.admin.from('user_profiles').select('*').eq('id', this.uid).single();
    requireFact(!error && data, 'profile_read_failed');
    return data;
  }

  async usage(): Promise<Obj> {
    const { data, error } = await this.member.functions.invoke('check-usage-limit');
    requireFact(!error && data, 'usage_read_failed');
    return data;
  }

  async entitlement(paid: boolean): Promise<void> {
    await this.poll(() => this.profile(), p => p.stripe_customer_id === this.customer
      && p.subscription_status === (paid ? 'pro' : 'free')
      && (paid ? p.stripe_subscription_id === this.subscription : true), 'profile_did_not_converge');
    await this.poll(() => this.usage(), u => u.can_start === paid && u.is_pro === paid
      && u.trial_active === false, 'entitlement_did_not_converge');
  }

  async delivery(type: string, objectId: string, extra: (event: BillingEvent) => boolean = () => true): Promise<void> {
    await this.poll(async () => {
      const query = new URLSearchParams({ type, 'created[gte]': String(this.startedAt), limit: '100' });
      const listed = await this.stripe(`events?${query}`);
      requireFact(Array.isArray(listed.data), 'event_list_missing');
      // Bounded shared sandbox: a full page must not hide an unobserved matching event.
      requireFact(listed.has_more === false, 'event_page_incomplete');
      for (const candidate of listed.data as BillingEvent[]) {
        if (candidate.data?.object?.id !== objectId || candidate.data?.object?.customer !== this.customer || !extra(candidate)) continue;
        const event = await this.stripe(`events/${encodeURIComponent(candidate.id)}`) as unknown as BillingEvent;
        const { data, error } = await this.admin.from('processed_webhook_events')
          .select('event_id,event_type,processed_at').eq('event_id', event.id).maybeSingle();
        requireFact(!error, 'event_ledger_read_failed');
        if (isCorrelatedDelivery(event, { type, objectId, customer: this.customer }, data) && extra(event)) {
          this.eventIds.add(event.id);
          return true;
        }
      }
      return false;
    }, Boolean, 'genuine_delivery_not_proven');
  }

  async login(): Promise<void> {
    await this.page.goto(`${this.targets.app}/auth/signin`);
    await this.page.getByTestId('email-input').fill(this.email);
    await this.page.getByTestId('password-input').fill(this.password);
    await this.page.getByTestId('sign-in-submit').click();
    await expect(this.page.getByTestId('nav-account-avatar')).toBeVisible();
  }

  async account(label: RegExp): Promise<void> {
    await this.page.goto(`${this.targets.app}/account`);
    await expect(this.page.getByTestId('membership-status')).toContainText(label);
  }

  async setup(): Promise<void> {
    const balance = await this.stripe('balance');
    requireFact(balance.livemode === false, 'stripe_account_not_test');
    assertTestPrice(await this.stripe(`prices/${encodeURIComponent(env.BILLING_SANDBOX_PRICE_ID!)}`));
    await this.page.goto(`${this.targets.app}/auth/signin`);
    await expect(this.page.getByTestId('auth-form')).toBeVisible();
    const runtime = await this.page.evaluate(() => ({ release: window.__APP_RELEASE__,
      api: window.__APP_RUNTIME_CONFIG__?.supabaseUrl, mockAuth: window.__APP_RUNTIME_CONFIG__?.mockAuth,
      authMode: window.__APP_RUNTIME_CONFIG__?.authMode, stripeKeyClass: window.__APP_RUNTIME_CONFIG__?.stripeKeyClass }));
    // The app reports mockAuth for any non-*.supabase.co URL, so on the loopback stack the check is the
    // explicit real auth mode instead; the real sign-in below still has to succeed against local Auth.
    const realAuth = useLocalStack ? runtime.authMode === 'real' : runtime.mockAuth === false;
    requireFact(runtime.release === env.BILLING_SANDBOX_RELEASE_SHA && runtime.api === this.targets.api
      && realAuth && runtime.stripeKeyClass === 'test', 'served_identity_or_backend_mismatch');

    this.signupAttempted = true;
    const { data, error } = await this.admin.auth.admin.createUser({ email: this.email,
      password: this.password, email_confirm: true });
    requireFact(!error && data.user, 'fixture_signup_failed');
    this.uid = data.user.id;
    const initial = await this.profile();
    const windowDays = (Date.parse(initial.trial_expires_at) - Date.parse(initial.trial_started_at)) / 86_400_000;
    requireFact(initial.commercial_trial_granted_at && Math.abs(windowDays - 30) < 0.01
      && !initial.stripe_customer_id && !initial.stripe_subscription_id && !initial.subscription_id, 'card_free_trial_missing');
    const auth = await this.member.auth.signInWithPassword({ email: this.email, password: this.password });
    requireFact(!auth.error && auth.data.user?.id === this.uid, 'fixture_auth_failed');
    const trial = await this.usage();
    requireFact(trial.trial_active === true && trial.can_start === true, 'trial_access_missing');
    if (this.journey === 'conversion') this.steps.add('trial_granted');
    // Controlled expiry of ONLY this disposable sandbox fixture. Never alter the immutable grant marker.
    const expired = await this.admin.from('user_profiles').update({ trial_expires_at: new Date(Date.now() - 60_000).toISOString() }).eq('id', this.uid);
    requireFact(!expired.error, 'fixture_expiry_failed');
    const after = await this.profile();
    requireFact(after.commercial_trial_granted_at === initial.commercial_trial_granted_at, 'trial_grant_changed');
    const usage = await this.usage();
    requireFact(usage.trial_active === false && usage.can_start === false && usage.is_pro === false, 'expired_access_not_blocked');
    if (this.journey === 'conversion' || this.journey === 'failed_checkout') this.steps.add('trial_expired');

    // Clock-backed customers keep each branch independent; unsupported sandbox capabilities fail closed.
    this.uncertainStripeCreate = true;
    const clock = await this.stripe('test_helpers/test_clocks', 'POST', testClockCreateFields(this.marker, Math.floor(Date.now() / 1000)));
    requireFact(typeof clock.id === 'string' && clock.id.startsWith('clock_'), 'clock_identity_missing');
    this.clock = clock.id;
    this.uncertainStripeCreate = false;
    this.uncertainStripeCreate = true;
    const customer = await this.stripe('customers', 'POST', { test_clock: this.clock,
      'metadata[speaksharp_test]': this.marker });
    requireFact(customer.livemode === false && typeof customer.id === 'string', 'customer_identity_missing');
    this.customer = customer.id;
    this.uncertainStripeCreate = false;
    const seeded = await this.admin.from('user_profiles').update({ stripe_customer_id: this.customer }).eq('id', this.uid);
    requireFact(!seeded.error, 'fixture_customer_binding_failed');
    await this.login();
  }

  /** Fills Stripe's hosted card form (Checkout or the portal) and submits. Never reads or reports its content. */
  async fillCard(card: string, withEmail: boolean): Promise<void> {
    const fill = async (selector: string, value: string) => {
      for (let attempt = 0; attempt < 40; attempt++) {
        for (const frame of this.page.frames()) {
          const field = frame.locator(selector).first();
          if (await field.isVisible()) { await field.fill(value); return; }
        }
        await sleep(500);
      }
      throw new Error('BILLING_JOURNEY:hosted_field_unavailable');
    };
    if (withEmail) await fill('input[type="email"]', this.email);
    await fill('input[autocomplete="cc-number"],input[name="cardNumber"]', card);
    await fill('input[autocomplete="cc-exp"],input[name="cardExpiry"]', '1234');
    await fill('input[autocomplete="cc-csc"],input[name="cardCvc"]', '123');
    for (const frame of this.page.frames()) {
      for (const [selector, value] of [['input[autocomplete="cc-name"]', 'SpeakSharp Test'],
        ['input[autocomplete="postal-code"]', '94105']] as const) {
        const field = frame.locator(selector).first();
        if (await field.isVisible()) await field.fill(value);
      }
    }
  }

  async payOnHostedPage(card: string): Promise<void> {
    await this.fillCard(card, true);
    await this.page.locator('button[type="submit"]').click();
  }

  /** Nothing paid: no subscription of any status for this customer, no paid access, no Pro profile. */
  async noPaidAccess(): Promise<void> {
    const subscriptions = await this.stripe(`subscriptions?${new URLSearchParams({ customer: this.customer, status: 'all', limit: '10' })}`);
    requireFact(Array.isArray(subscriptions.data) && subscriptions.has_more === false && subscriptions.data.length === 0,
      'failed_checkout_subscribed');
    requireFact((await this.usage()).can_start === false, 'failed_checkout_granted_access');
    requireFact((await this.profile()).subscription_status !== 'pro', 'failed_checkout_granted_access');
  }

  async checkout(): Promise<void> {
    this.stage = 'hosted_checkout';
    // Use the real server checkout route; hosted payment and return are browser-driven.
    const invoke = async (): Promise<string | null> => {
      const { data, error } = await this.member.functions.invoke('stripe-checkout', { body: {
        plan: 'pro', conversionSource: 'billing_user_journey',
      } });
      return !error && typeof data?.checkoutUrl === 'string' ? data.checkoutUrl : null;
    };
    const sessionOf = (raw: string) => new URL(raw).pathname.match(/cs_test_[A-Za-z0-9]+/)?.[0] ?? '';
    const customerSessions = async (): Promise<string[]> => {
      const listed = await this.stripe(`checkout/sessions?${new URLSearchParams({ customer: this.customer, limit: '10' })}`);
      requireFact(Array.isArray(listed.data) && listed.has_more === false, 'checkout_session_list_unreadable');
      return (listed.data as Obj[]).map(session => String(session.id));
    };
    let checkoutUrl: string | null;
    if (this.journey === 'conversion') {
      // Repeated click: two requests at the same moment lead to ONE Checkout session. A request refused while
      // the other holds the reservation is allowed; a second session is not.
      const answers = (await Promise.all([invoke(), invoke()])).filter((answer): answer is string => Boolean(answer));
      requireFact(answers.length >= 1, 'checkout_unavailable');
      const once = new Set(answers.map(sessionOf));
      requireFact(once.size === 1 && !once.has(''), 'repeated_click_two_sessions');
      const [only] = once;
      requireFact((await customerSessions()).join(',') === only, 'repeated_click_two_sessions');
      this.steps.add('repeated_click_one_session');

      // Cancel on the hosted Checkout page with Stripe's own back link: back in the app, nothing charged,
      // no subscription, still no paid access.
      await this.page.goto(answers[0]);
      const back = this.page.locator(`a[href^="${this.targets.app}/pricing?checkout=cancelled"]`).first();
      await expect(back).toBeVisible({ timeout: 30_000 }).catch(() => { throw new Error('BILLING_JOURNEY:hosted_cancel_link_unavailable'); });
      await back.click();
      await this.page.waitForURL(url => url.origin === this.targets.app && url.searchParams.get('checkout') === 'cancelled', { timeout: 60_000 });
      const subscriptions = await this.stripe(`subscriptions?${new URLSearchParams({ customer: this.customer, status: 'all', limit: '10' })}`);
      requireFact(Array.isArray(subscriptions.data) && subscriptions.data.length === 0, 'cancelled_checkout_subscribed');
      const stillOpen = await this.stripe(`checkout/sessions/${only}`);
      requireFact(stillOpen.status === 'open' && stillOpen.payment_status === 'unpaid', 'cancelled_checkout_not_open');
      requireFact((await this.usage()).can_start === false, 'cancelled_checkout_granted_access');
      requireFact((await this.profile()).subscription_status !== 'pro', 'cancelled_checkout_granted_access');
      this.steps.add('checkout_cancelled');

      // Retry after cancel: the still-open session is reused, never a second one.
      checkoutUrl = await invoke();
      requireFact(checkoutUrl && sessionOf(checkoutUrl) === only, 'retry_did_not_reuse_session');
      requireFact((await customerSessions()).join(',') === only, 'retry_created_second_session');
      this.steps.add('checkout_retried');
    } else if (this.journey === 'failed_checkout') {
      // A declined card: Stripe shows the decline on its own page, nothing is paid, nothing is granted.
      const first = await invoke();
      requireFact(first, 'checkout_unavailable');
      const declined = sessionOf(first);
      requireFact(declined, 'test_checkout_required');
      await this.page.goto(first);
      await this.payOnHostedPage('4000000000000002');
      await expect(this.page.getByText(/declined/i).first()).toBeVisible({ timeout: 60_000 })
        .catch(() => { throw new Error('BILLING_JOURNEY:decline_not_shown'); });
      requireFact(new URL(this.page.url()).origin === 'https://checkout.stripe.com', 'decline_left_checkout');
      assertCheckoutGrantedNothing(await this.stripe(`checkout/sessions/${declined}`), 'open');
      this.steps.add('declined_checkout');
      await this.noPaidAccess();
      this.steps.add('no_access_after_decline');
      // Abandoned: the customer walks away and the session expires (expired here instead of waiting 24 hours).
      await this.stripe(`checkout/sessions/${declined}/expire`, 'POST');
      assertCheckoutGrantedNothing(await this.stripe(`checkout/sessions/${declined}`), 'expired');
      this.steps.add('abandoned_checkout');
      await this.noPaidAccess();
      this.steps.add('no_access_after_abandon');
      // Retry: the server reconciles the expired session and issues a new one.
      checkoutUrl = await invoke();
      requireFact(checkoutUrl && sessionOf(checkoutUrl) && sessionOf(checkoutUrl) !== declined, 'retry_checkout_refused');
    } else {
      checkoutUrl = await invoke();
    }
    requireFact(checkoutUrl, 'checkout_unavailable');
    const data = { checkoutUrl };
    const url = new URL(data.checkoutUrl);
    requireFact(url.origin === 'https://checkout.stripe.com', 'checkout_origin');
    this.session = url.pathname.match(/cs_test_[A-Za-z0-9]+/)?.[0] ?? '';
    requireFact(this.session, 'test_checkout_required');
    const pending = await this.stripe(`checkout/sessions/${this.session}`);
    requireFact(pending.livemode === false && pending.mode === 'subscription' && pending.customer === this.customer
      && pending.client_reference_id === this.uid && pending.metadata?.userId === this.uid, 'checkout_identity');
    requireFact(new URL(pending.success_url).origin === this.targets.app, 'checkout_return_origin');
    requireFact((await this.usage()).can_start === false, 'checkout_granted_before_payment');
    await this.page.goto(data.checkoutUrl);
    await this.payOnHostedPage('4242424242424242');
    await this.page.waitForURL(url => url.origin === this.targets.app && url.searchParams.get('checkout') === 'success', { timeout: 90_000 });
    const complete = await this.stripe(`checkout/sessions/${this.session}`);
    requireFact(complete.livemode === false && complete.status === 'complete' && complete.payment_status === 'paid'
      && complete.customer === this.customer && complete.client_reference_id === this.uid, 'checkout_not_complete');
    this.subscription = id(complete.subscription);
    requireFact(this.subscription.startsWith('sub_'), 'subscription_missing');
    this.steps.add('hosted_checkout');
    const sub = await this.stripe(`subscriptions/${this.subscription}`);
    requireFact(sub.livemode === false && sub.customer === this.customer && sub.status === 'active'
      && sub.trial_start == null && sub.trial_end == null, 'second_trial_or_wrong_subscription');
    requireFact(sub.items?.data?.length === 1 && sub.items.data[0].price.id === env.BILLING_SANDBOX_PRICE_ID, 'subscription_price_identity');
    assertTestPrice(sub.items.data[0].price);
    assertInvoice(await this.stripe(`invoices/${id(sub.latest_invoice)}`), this.customer, this.subscription, 'subscription_create');
    this.steps.add('first_invoice');
    this.stage = 'stripe_delivery';
    await this.delivery('checkout.session.completed', this.session);
    this.steps.add('stripe_delivery');
    await this.entitlement(true);
    // There must be exactly one profile for the Stripe customer, and it must be this account.
    const owners = await this.admin.from('user_profiles').select('id').eq('stripe_customer_id', this.customer);
    requireFact(!owners.error && owners.data?.length === 1 && owners.data[0].id === this.uid, 'wrong_account_entitlement');
    this.steps.add('paid_entitlement');
  }

  async record(): Promise<void> {
    await this.page.goto(`${this.targets.app}/practice`);
    await this.page.getByTestId('practice-card-freeform').click();
    await selectBenchmarkMode(this.page, 'private');
    const setup = await preparePrivateModelIfPrompted(this.page, 180_000);
    if (!setup.recordingAlreadyStarted) await startBenchmarkRecording(this.page, 'billing-journey');
    await expectBenchmarkRecordingStarted(this.page, 'billing-journey');
    await expectBenchmarkTranscriptOutput(this.page, 'billing-journey', 60_000, 3);
    await stopBenchmarkRecording(this.page, 'billing-journey');
    await waitForBenchmarkSaveCandidate(this.page, 'billing-journey', 120_000);
    this.savedSession = await this.poll(() => this.page.evaluate(() =>
      document.documentElement.getAttribute('data-session-persisted') === 'true'
        ? document.documentElement.getAttribute('data-session-persisted-id') ?? '' : ''), Boolean, 'recording_not_persisted');
    const row = await this.admin.from('sessions').select('id,user_id,status,transcript,engine')
      .eq('id', this.savedSession).eq('user_id', this.uid).single();
    requireFact(!row.error && row.data?.status === 'completed' && row.data.engine === 'private'
      && row.data.transcript?.trim(), 'paid_recording_not_proven');
    // data-session-persisted and sessions.engine are advisory; only the server-recorded attrib_v1 authority
    // row proves the saved recording is Private (same check as private-recording-proof.live.spec.ts).
    const authority = await this.admin.from('session_attribution_authority').select('engine_class,authority_version')
      .eq('session_id', this.savedSession).eq('user_id', this.uid).single();
    requireFact(!authority.error && authority.data?.authority_version === 'attrib_v1'
      && authority.data.engine_class === 'private', 'paid_recording_attribution_not_verified');
  }

  async advance(seconds: number): Promise<void> {
    await this.stripe(`test_helpers/test_clocks/${this.clock}/advance`, 'POST', { frozen_time: String(seconds) });
    await this.poll(() => this.stripe(`test_helpers/test_clocks/${this.clock}`), value => value.status === 'ready', 'clock_not_ready');
  }

  async run(): Promise<void> {
    // Before ANY Stripe call, and independently of the app's payment gate: test keys only, the same key and
    // price the local Edge functions were served with, and a loopback stack that answers (runnerPreflight.mjs).
    if (useLocalStack) await runnerPreflight(env);
    await this.setup();
    await this.checkout();
    this.stage = this.journey;
    if (this.journey === 'conversion') {
      requireFact(new URL(this.page.url()).origin === this.targets.app, 'return_missing');
      this.steps.add('returned_to_app');
      await this.account(/Pro · Active/); this.steps.add('paid_ui');
      await this.page.reload();
      await expect(this.page.getByTestId('membership-status')).toContainText('Pro · Active');
      await this.entitlement(true); this.steps.add('reload');
      // A fresh browser context proves a real new sign-in instead of clearing selected storage keys.
      const fresh = await this.page.context().browser()!.newContext({ baseURL: this.targets.app });
      try {
        const other = await fresh.newPage();
        await other.goto('/auth/signin');
        await other.getByTestId('email-input').fill(this.email);
        await other.getByTestId('password-input').fill(this.password);
        await other.getByTestId('sign-in-submit').click();
        await expect(other.getByTestId('nav-account-avatar')).toBeVisible();
        await other.goto('/account');
        await expect(other.getByTestId('membership-status')).toContainText('Pro · Active');
      } finally { await fresh.close(); }
      this.steps.add('sign_in_again');
      await this.record(); this.steps.add('next_recording');
    } else if (this.journey === 'renewal_recovery') {
      let sub = await this.stripe(`subscriptions/${this.subscription}`);
      const firstInvoice = id(sub.latest_invoice);
      await this.advance(sub.current_period_end + 3600);
      sub = await this.poll(() => this.stripe(`subscriptions/${this.subscription}`),
        s => id(s.latest_invoice) !== firstInvoice && s.status === 'active', 'renewal_not_created');
      const renewal = await this.poll(() => this.stripe(`invoices/${id(sub.latest_invoice)}`), i => i.status === 'paid', 'renewal_not_paid');
      assertInvoice(renewal, this.customer, this.subscription, 'subscription_cycle');
      this.steps.add('renewal_paid');
      await this.delivery('invoice.payment_succeeded', renewal.id);
      await this.entitlement(true); this.steps.add('renewal_delivery');
      const { failedInvoice } = await this.failRenewal();
      const good = await this.stripe('payment_methods/pm_card_visa/attach', 'POST', { customer: this.customer });
      await this.stripe(`subscriptions/${this.subscription}`, 'POST', { default_payment_method: good.id });
      // API recovery here; portal_recovery proves the member's own path through Manage billing.
      await this.recovered(await this.stripe(`invoices/${failedInvoice}/pay`, 'POST', { payment_method: good.id }), failedInvoice);
    } else if (this.journey === 'failed_checkout') {
      // A declined then abandoned Checkout and a paid retry leave exactly one subscription.
      const all = await this.stripe(`subscriptions?${new URLSearchParams({ customer: this.customer, status: 'all', limit: '10' })}`);
      requireFact(Array.isArray(all.data) && all.has_more === false && all.data.length === 1
        && all.data[0].id === this.subscription, 'more_than_one_subscription');
      this.steps.add('single_subscription');
    } else if (this.journey === 'portal_recovery') {
      const { failedInvoice, badCard } = await this.failRenewal();
      // The member repairs billing themselves in Manage billing (the Stripe portal). No API payment here:
      // if the portal cannot pay the past-due invoice, the branch fails closed.
      await this.page.goto(`${this.targets.app}/account`);
      const manage = this.page.getByRole('button', { name: 'Manage billing', exact: true });
      await expect(manage).toBeVisible({ timeout: 30_000 }).catch(() => { throw new Error('BILLING_JOURNEY:manage_billing_unavailable'); });
      await manage.click();
      await this.page.waitForURL(url => url.origin === 'https://billing.stripe.com');
      this.steps.add('portal_opened');
      const add = this.page.getByRole('link', { name: /Add payment method/i }).or(this.page.getByRole('button', { name: /Add payment method/i })).first();
      await expect(add).toBeVisible({ timeout: 30_000 }).catch(() => { throw new Error('BILLING_JOURNEY:portal_add_card_unavailable'); });
      await add.click();
      await this.fillCard('4242424242424242', false);
      await this.page.getByRole('button', { name: /^(Add|Save)/i }).last().click();
      const added = await this.poll(() => this.stripe(`payment_methods?${new URLSearchParams({ customer: this.customer, type: 'card', limit: '10' })}`),
        listed => Array.isArray(listed.data) && (listed.data as Obj[]).some(pm => pm.id !== badCard && pm.card?.last4 === '4242'),
        'portal_card_not_added');
      requireFact(added.has_more === false, 'payment_method_page_incomplete');
      this.steps.add('portal_payment_method_updated');
      const pay = this.page.getByRole('button', { name: /^Pay\b/i }).or(this.page.getByRole('link', { name: /^Pay\b/i })).first();
      await expect(pay).toBeVisible({ timeout: 30_000 }).catch(() => { throw new Error('BILLING_JOURNEY:portal_recovery_pay_unavailable'); });
      await pay.click();
      const confirm = this.page.getByRole('button', { name: /^Pay\b/i }).last();
      if (await confirm.isVisible()) await confirm.click();
      await this.recovered(await this.poll(() => this.stripe(`invoices/${failedInvoice}`), i => i.status === 'paid',
        'portal_recovery_not_paid'), failedInvoice);
    } else if (this.journey === 'portal_expiry') {
      await this.record();
      await this.account(/Pro · Active/);
      await this.page.getByRole('button', { name: 'Cancel membership', exact: true }).click();
      await this.page.waitForURL(url => url.origin === 'https://billing.stripe.com');
      await expect(this.page.getByRole('button', { name: /Cancel (plan|subscription)/i }).last()).toBeVisible();
      this.steps.add('portal_opened');
      await this.page.getByRole('button', { name: /Cancel (plan|subscription)/i }).last().click();
      const ending = await this.poll(() => this.stripe(`subscriptions/${this.subscription}`),
        s => s.cancel_at_period_end === true && s.status === 'active', 'portal_did_not_schedule_cancellation');
      this.steps.add('portal_cancelled');
      await this.paidUntilPeriodEnd(ending);
    } else {
      // refund_period_end (Akin, 2026-11-12): a full refund; the customer keeps Pro for the rest of the
      // month and is never charged again.
      const first = await this.stripe(`subscriptions/${this.subscription}`);
      const firstInvoice = id(first.latest_invoice);
      const charge = id((await this.stripe(`invoices/${firstInvoice}`)).charge);
      requireFact(charge.startsWith('ch_'), 'first_charge_missing');
      // No amount: a refund is always the whole charge.
      const refund = await this.stripe('refunds', 'POST', { charge, 'metadata[speaksharp_test]': this.marker });
      assertFullRefund(refund, charge);
      this.steps.add('refund_issued');
      const refundEventId = await this.poll(async () => {
        const listed = await this.stripe(`events?${new URLSearchParams({ type: 'charge.refunded', 'created[gte]': String(this.startedAt), limit: '100' })}`);
        requireFact(Array.isArray(listed.data) && listed.has_more === false, 'event_page_incomplete');
        return String((listed.data as BillingEvent[]).find(e => e.livemode === false && e.data?.object?.id === charge)?.id ?? '');
      }, Boolean, 'refund_event_missing');
      // The cancellation must be the webhook's own follow-up to THIS refund event, not any other change.
      await this.poll(async () => {
        const listed = await this.stripe(`events?${new URLSearchParams({ type: 'customer.subscription.updated', 'created[gte]': String(this.startedAt), limit: '100' })}`);
        requireFact(Array.isArray(listed.data) && listed.has_more === false, 'event_page_incomplete');
        return (listed.data as unknown[]).some(e => isRefundCancellation(e, { subscription: this.subscription, customer: this.customer, refundEventId }));
      }, Boolean, 'refund_did_not_schedule_cancellation');
      const ending = await this.poll(() => this.stripe(`subscriptions/${this.subscription}`),
        s => s.cancel_at_period_end === true && s.status === 'active', 'refund_did_not_schedule_cancellation');
      this.steps.add('refund_cancellation_scheduled');
      await this.paidUntilPeriodEnd(ending);
      const invoices = await this.stripe(`invoices?${new URLSearchParams({ subscription: this.subscription, limit: '10' })}`);
      requireFact(Array.isArray(invoices.data) && invoices.has_more === false
        && (invoices.data as Obj[]).every(i => i.id === firstInvoice || i.amount_paid === 0), 'second_charge_after_refund');
      this.steps.add('no_second_charge');
    }
  }

  /** A renewal on a card that declines: the invoice is past due and paid access is withdrawn. */
  async failRenewal(): Promise<{ failedInvoice: string; badCard: string }> {
    const before = await this.stripe(`subscriptions/${this.subscription}`);
    const previous = id(before.latest_invoice);
    const bad = await this.stripe('payment_methods/pm_card_chargeCustomerFail/attach', 'POST', { customer: this.customer });
    await this.stripe(`subscriptions/${this.subscription}`, 'POST', { default_payment_method: bad.id });
    await this.advance(before.current_period_end + 3600);
    const sub = await this.poll(() => this.stripe(`subscriptions/${this.subscription}`), s => s.status === 'past_due', 'failure_not_observed');
    const failedInvoice = id(sub.latest_invoice);
    requireFact(failedInvoice !== previous, 'failure_invoice_not_new');
    this.steps.add('failure_observed');
    await this.delivery('invoice.payment_failed', failedInvoice); this.steps.add('failure_delivery');
    await this.entitlement(false); this.steps.add('access_revoked');
    return { failedInvoice, badCard: bad.id };
  }

  /** The past-due invoice is paid, Stripe tells the app, and paid access returns. */
  async recovered(invoice: Obj, failedInvoice: string): Promise<void> {
    assertInvoice(invoice, this.customer, this.subscription, 'subscription_cycle');
    this.steps.add('recovery_paid');
    await this.delivery('invoice.payment_succeeded', failedInvoice); this.steps.add('recovery_delivery');
    await this.entitlement(true); await this.account(/Pro · Active/); this.steps.add('access_restored');
  }

  /** A scheduled cancellation: Pro to the end of the paid period, then the period ends. */
  async paidUntilPeriodEnd(ending: Obj): Promise<void> {
    await this.delivery('customer.subscription.updated', this.subscription, e => e.data.object.cancel_at_period_end === true);
    this.steps.add('cancellation_delivery');
    await this.entitlement(true); await this.account(/Pro · Ending/); this.steps.add('paid_until_period_end');
    await this.periodEnd(ending);
  }

  /**
   * The period ends at Stripe. Data is kept whatever the end-of-access policy, so it is read from the database
   * only. What the member can do afterwards (access_expired, history_retained) stays PENDING_POLICY until Akin
   * confirms the end-of-access policy with Sam: nothing here signs in or reads access after the end.
   */
  async periodEnd(ending: Obj): Promise<void> {
    await this.advance(ending.current_period_end + 3600);
    const cancelled = await this.poll(() => this.stripe(`subscriptions/${this.subscription}`), s => s.status === 'canceled', 'subscription_not_expired');
    requireFact(cancelled.cancel_at_period_end === true || cancelled.canceled_at != null, 'cancellation_unconfirmed');
    await this.delivery('customer.subscription.deleted', this.subscription); this.steps.add('expiry_delivery');
    const user = await this.admin.auth.admin.getUserById(this.uid);
    requireFact(!user.error && user.data.user?.id === this.uid, 'account_deleted_by_cancellation');
    if (this.savedSession) {
      const saved = await this.admin.from('sessions').select('id').eq('id', this.savedSession).eq('user_id', this.uid).single();
      requireFact(!saved.error && saved.data, 'history_deleted_by_cancellation');
    }
    this.steps.add('account_retained');
  }

  async cleanup(): Promise<void> {
    // Test Clock deletion owns its customer/subscriptions; confirm the customer is marked deleted.
    let stripeClean = !this.clock && !this.customer;
    let stripeFailed = false;
    let accountFailed = false;
    try {
      if (this.clock) {
        const deleted = await this.stripe(`test_helpers/test_clocks/${this.clock}`, 'DELETE');
        requireFact(deleted.deleted === true && deleted.id === this.clock, 'clock_cleanup_not_proven');
        stripeClean = true;
        if (this.customer) {
          const customer = await this.stripe(`customers/${this.customer}`);
          requireFact(customer.deleted === true, 'customer_cleanup_not_proven');
        }
      }
    } catch { stripeFailed = true; }
    // Shared cleanup checks auth/profile/session residue and exact fixture ownership.
    try {
      if (this.signupAttempted) await cleanupRunOwnedAccount({ admin: this.admin as never,
        capturedUid: this.uid, createdEmail: this.email, runOwnedPrefix: 'rwt-journey-billing-' });
    } catch { accountFailed = true; }
    // Billing lifecycle records do not cascade with auth deletion. Missing permissions/counts are
    // NOT zero. A reviewed sandbox cleanup path must settle and remove these fixtures without
    // bypassing the account-deletion/save-obligation guards before cleanup can ever be qualified.
    // The disposable local stack does NOT count these rows: migrations revoke all access to the three
    // tables from service_role (account_closure_tokens, pending_completion_journal), so the read can only
    // error, and permissions are not widened to make it pass. The receipt says the rows were NOT read, and
    // the workflow must separately prove the whole stack (database volume included) was destroyed.
    if (this.uid && !useLocalStack) {
      for (const table of ['account_billing_fences', 'account_checkout_operations', 'account_save_obligations']) {
        const readback = await this.admin.from(table).select('*', { count: 'exact', head: true }).eq('user_id', this.uid);
        if (readback.error || readback.count !== 0) accountFailed = true;
      }
    }
    requireFact(!stripeFailed && !accountFailed && stripeClean && !this.uncertainStripeCreate, 'cleanup_unproven');
    this.steps.add('cleanup');
  }
}

// Not serial: one failed branch cannot suppress collection/execution of the others. No skips or retries.
// No mode keeps today's three journeys; BILLING_RUNNER_MODE=smoke or full selects the runner's branches.
const { journeys: RUN_JOURNEYS } = selectRunnerJourneys(env.BILLING_RUNNER_MODE);
function journeyTest(journey: RunnerJourney): void {
  test(`billing ${journey}: genuine Stripe sandbox delivery`, async ({ page }, info) => {
    let run: SandboxJourney | undefined;
    let failed = false;
    let reason: string | null = null;
    let cleanupFailed = false;
    try { run = new SandboxJourney(journey, page); await run.run(); }
    catch (error) { failed = true; reason = safeFailureReason(error); }
    finally {
      if (run) { try { await run.cleanup(); } catch { cleanupFailed = true; } }
      const result = receipt(journey, run?.steps ?? new Set());
      // On the local stack the receipt never says PASSED/VERIFIED by itself; the workflow finalises it only
      // after the checked teardown and destruction proof (localStackReceipt.mjs).
      const status = localStackStatus(failed || cleanupFailed ? 'INCOMPLETE' : result.result,
        cleanupFailed ? 'UNPROVEN' : run?.steps.has('cleanup') ? 'VERIFIED' : 'NOT_RUN', useLocalStack);
      await info.attach('billing-user-journey.json', { body: JSON.stringify({ ...result,
        result: status.result,
        failureStage: failed ? run?.stage ?? 'preflight' : null,
        reason,
        cleanup: status.cleanup,
        // Never reported as checked on the local stack; only the workflow's destruction proof covers them.
        billingRowResidue: useLocalStack ? 'NOT_READ_REQUIRES_STACK_DESTRUCTION_PROOF' : 'COUNTED_ZERO_OR_FAILED',
        testedRelease: env.BILLING_SANDBOX_RELEASE_SHA?.match(/^[a-f0-9]{40}$/)?.[0] ?? null,
        // Binds this receipt to this run's disposable stack; the finalizer refuses any other run's receipt.
        stackRun: useLocalStack ? env.LOCAL_STACK_PROJECT?.match(/^billing-local-stack-[0-9]{1,20}-[0-9]{1,6}$/)?.[0] ?? null : null,
      }), contentType: 'application/json' });
      requireFact(failed || cleanupFailed || result.result !== PENDING_POLICY, 'access_after_end_policy_pending');
      requireFact(!failed && !cleanupFailed && result.result === 'PASSED', 'journey_incomplete_see_sanitized_receipt');
    }
  });
}
// The three lifecycle branches first, then the full-mode branches, each only when the mode selects it.
for (const journey of BILLING_JOURNEYS) if (RUN_JOURNEYS.includes(journey)) journeyTest(journey);
for (const journey of FULL_MODE_JOURNEYS) if (RUN_JOURNEYS.includes(journey)) journeyTest(journey);
