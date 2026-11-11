import { test, expect, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import sandboxTarget from './sandbox-target.json' with { type: 'json' };
import localStackTarget from './sandbox-target.local.json' with { type: 'json' };
import { requireFact, assertSandboxConfiguration, assertTestPrice, assertInvoice, isCorrelatedDelivery,
  safeFailureReason, type BillingEvent } from './contract';
import { paidValueLoopReceipt, assertSavedTake, assertEligibleEvaluation, savedCoaching, coachingShownAsSaved,
  assertRecommendation, comparisonExpectation, assertComparisonShown } from './paidValueLoop';
import { PROGRESS_FORMULA, LEGACY_PHRASE, type PanelObservation, type ServerAttempt, type ServerEvidence }
  from '../../live/helpers/repeatMetricWording';
import { cleanupRunOwnedAccount } from '../../live/helpers/runOwnedCleanup';
import { selectBenchmarkMode, preparePrivateModelIfPrompted, startBenchmarkRecording, expectBenchmarkRecordingStarted,
  expectBenchmarkDraftActivity, stopBenchmarkRecording, waitForBenchmarkSaveCandidate, expectFinalizedTranscriptOutput }
  from '../../live/helpers/benchmark-utils';

/**
 * OUTCOME 8 / PAID-01 — the paid value loop on ONE genuinely paid TEST-MODE identity. DRAFT: never run.
 *
 * Conversion is the same contract as `journey.billing.spec.ts` (#1795): an expired card-free trial, the real
 * `stripe-checkout` route, hosted test Checkout with a test card, a genuine Stripe event matched to the deployed
 * processing ledger, and paid access from the server. That class is not exported, so its conversion and cleanup steps
 * are repeated here, unchanged in substance; once #1795 lands they should be extracted and shared rather than kept twice.
 *
 * Then, on the SAME signed-in account: an eligible Private Open Mic take, its saved coaching rendered as stored, a
 * server recommendation bound to it, the review's LINKED "Practice again" and a saved repeat bound to that
 * recommendation, the comparison naming the measured metric and stored outcome, and a fresh sign-in that reads all of it
 * back on a still-active paid account. Checks are the pure functions in `paidValueLoop.ts`.
 *
 * Same safety contract as the billing journeys: committed target only, `sk_test_` only, no synthetic webhook, no retries
 * or skips, trace/video/screenshots off, content-free receipt, fail-closed cleanup.
 */
type Obj = {
  id: string; livemode: boolean; status: string; customer: string; subscription: string | { id: string };
  data: unknown; has_more: boolean; deleted: boolean; metadata: Record<string, string>; mode: string;
  client_reference_id: string; success_url: string; payment_status: string; trial_start: number | null;
  trial_end: number | null; latest_invoice: string | { id: string }; items: { data: { price: Obj }[] };
  trial_started_at: string; trial_expires_at: string; commercial_trial_granted_at: string;
  stripe_customer_id: string; stripe_subscription_id: string; subscription_id: string;
  subscription_status: string; can_start: boolean; is_pro: boolean; trial_active: boolean;
};
const env = process.env;
const useLocalStack = env.BILLING_SANDBOX_TARGET === 'local-disposable-stack';
const committedTarget = useLocalStack ? localStackTarget : sandboxTarget;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const id = (value: unknown): string => typeof value === 'string' ? value
  : value && typeof value === 'object' && 'id' in value ? String(value.id) : '';
/** Progress eligibility needs at least 30 s and 75 words; the fixture is 65.8 s of unique speech, so 45 s never wraps. */
const ELIGIBLE_TAKE_MS = 45_000;
const UUID = /^[0-9a-f-]{36}$/i;

class PaidValueLoop {
  readonly steps = new Set<string>();
  readonly marker = `rwt-journey-billing-${randomUUID()}`;
  readonly email = `${this.marker}@example.com`;
  readonly password = `Test-${randomUUID()}!`;
  readonly targets = assertSandboxConfiguration(env, committedTarget);
  readonly admin: SupabaseClient = createClient(this.targets.api, env.BILLING_SANDBOX_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } });
  readonly member: SupabaseClient = createClient(this.targets.api, env.BILLING_SANDBOX_ANON_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } });
  uid = ''; customer = ''; subscription = ''; clock = ''; session = '';
  firstTake = ''; repeatTake = ''; recommendation = '';
  signupAttempted = false;
  uncertainStripeCreate = false;
  stage = 'preflight';
  startedAt = Math.floor(Date.now() / 1000) - 5;
  constructor(readonly page: Page) {}

  // ── Conversion: same contract as journey.billing.spec.ts ────────────────────────────────────────────────

  async stripe(path: string, method = 'GET', fields: Record<string, string> = {}): Promise<Obj> {
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

  async poll<T>(read: () => Promise<T>, accepts: (value: T) => boolean, code: string, ms = 120_000): Promise<T> {
    const deadline = Date.now() + ms;
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

  async paidAccess(): Promise<void> {
    await this.poll(() => this.profile(), p => p.stripe_customer_id === this.customer && p.subscription_status === 'pro'
      && p.stripe_subscription_id === this.subscription, 'profile_did_not_converge');
    await this.poll(() => this.usage(), u => u.can_start === true && u.is_pro === true && u.trial_active === false,
      'entitlement_did_not_converge');
  }

  async delivery(type: string, objectId: string): Promise<void> {
    await this.poll(async () => {
      const query = new URLSearchParams({ type, 'created[gte]': String(this.startedAt), limit: '100' });
      const listed = await this.stripe(`events?${query}`);
      requireFact(Array.isArray(listed.data), 'event_list_missing');
      requireFact(listed.has_more === false, 'event_page_incomplete');
      for (const candidate of listed.data as BillingEvent[]) {
        if (candidate.data?.object?.id !== objectId || candidate.data?.object?.customer !== this.customer) continue;
        const event = await this.stripe(`events/${encodeURIComponent(candidate.id)}`) as unknown as BillingEvent;
        const { data, error } = await this.admin.from('processed_webhook_events')
          .select('event_id,event_type,processed_at').eq('event_id', event.id).maybeSingle();
        requireFact(!error, 'event_ledger_read_failed');
        if (isCorrelatedDelivery(event, { type, objectId, customer: this.customer }, data)) return true;
      }
      return false;
    }, Boolean, 'genuine_delivery_not_proven');
  }

  async signIn(page: Page): Promise<void> {
    await page.goto(`${this.targets.app}/auth/signin`);
    await page.getByTestId('email-input').fill(this.email);
    await page.getByTestId('password-input').fill(this.password);
    await page.getByTestId('sign-in-submit').click();
    await expect(page.getByTestId('nav-account-avatar')).toBeVisible();
  }

  async convert(): Promise<void> {
    const balance = await this.stripe('balance');
    requireFact(balance.livemode === false, 'stripe_account_not_test');
    assertTestPrice(await this.stripe(`prices/${encodeURIComponent(env.BILLING_SANDBOX_PRICE_ID!)}`));
    await this.page.goto(`${this.targets.app}/auth/signin`);
    await expect(this.page.getByTestId('auth-form')).toBeVisible();
    const runtime = await this.page.evaluate(() => ({ release: window.__APP_RELEASE__,
      api: window.__APP_RUNTIME_CONFIG__?.supabaseUrl, mockAuth: window.__APP_RUNTIME_CONFIG__?.mockAuth,
      authMode: window.__APP_RUNTIME_CONFIG__?.authMode, stripeKeyClass: window.__APP_RUNTIME_CONFIG__?.stripeKeyClass }));
    const realAuth = useLocalStack ? runtime.authMode === 'real' : runtime.mockAuth === false;
    requireFact(runtime.release === env.BILLING_SANDBOX_RELEASE_SHA && runtime.api === this.targets.api
      && realAuth && runtime.stripeKeyClass === 'test', 'served_identity_or_backend_mismatch');

    this.signupAttempted = true;
    const { data, error } = await this.admin.auth.admin.createUser({ email: this.email, password: this.password, email_confirm: true });
    requireFact(!error && data.user, 'fixture_signup_failed');
    this.uid = data.user.id;
    const initial = await this.profile();
    requireFact(initial.commercial_trial_granted_at && !initial.stripe_customer_id && !initial.stripe_subscription_id,
      'card_free_trial_missing');
    const auth = await this.member.auth.signInWithPassword({ email: this.email, password: this.password });
    requireFact(!auth.error && auth.data.user?.id === this.uid, 'fixture_auth_failed');
    // Controlled expiry of ONLY this disposable fixture, so every later step runs on PAID access, not trial access.
    const expired = await this.admin.from('user_profiles').update({ trial_expires_at: new Date(Date.now() - 60_000).toISOString() }).eq('id', this.uid);
    requireFact(!expired.error, 'fixture_expiry_failed');
    requireFact((await this.profile()).commercial_trial_granted_at === initial.commercial_trial_granted_at, 'trial_grant_changed');
    const usage = await this.usage();
    requireFact(usage.trial_active === false && usage.can_start === false && usage.is_pro === false, 'expired_access_not_blocked');
    this.steps.add('trial_expired');

    // A clock-backed customer keeps this run's Stripe objects independent and removable in one delete.
    this.uncertainStripeCreate = true;
    const clock = await this.stripe('test_helpers/test_clocks', 'POST', { frozen_time: String(Math.floor(Date.now() / 1000)) });
    requireFact(typeof clock.id === 'string' && clock.id.startsWith('clock_'), 'clock_identity_missing');
    this.clock = clock.id;
    this.uncertainStripeCreate = false;
    this.uncertainStripeCreate = true;
    const customer = await this.stripe('customers', 'POST', { test_clock: this.clock, 'metadata[speaksharp_test]': this.marker });
    requireFact(customer.livemode === false && typeof customer.id === 'string', 'customer_identity_missing');
    this.customer = customer.id;
    this.uncertainStripeCreate = false;
    const seeded = await this.admin.from('user_profiles').update({ stripe_customer_id: this.customer }).eq('id', this.uid);
    requireFact(!seeded.error, 'fixture_customer_binding_failed');
    await this.signIn(this.page);

    this.stage = 'hosted_checkout';
    const checkout = await this.member.functions.invoke('stripe-checkout', { body: { plan: 'pro', conversionSource: 'billing_user_journey' } });
    requireFact(!checkout.error && typeof checkout.data?.checkoutUrl === 'string', 'checkout_unavailable');
    const url = new URL(checkout.data.checkoutUrl);
    requireFact(url.origin === 'https://checkout.stripe.com', 'checkout_origin');
    this.session = url.pathname.match(/cs_test_[A-Za-z0-9]+/)?.[0] ?? '';
    requireFact(this.session, 'test_checkout_required');
    const pending = await this.stripe(`checkout/sessions/${this.session}`);
    requireFact(pending.livemode === false && pending.mode === 'subscription' && pending.customer === this.customer
      && pending.client_reference_id === this.uid && pending.metadata?.userId === this.uid, 'checkout_identity');
    requireFact(new URL(pending.success_url).origin === this.targets.app, 'checkout_return_origin');
    await this.page.goto(checkout.data.checkoutUrl);
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
    await fill('input[type="email"]', this.email);
    await fill('input[autocomplete="cc-number"],input[name="cardNumber"]', '4242424242424242');
    await fill('input[autocomplete="cc-exp"],input[name="cardExpiry"]', '1234');
    await fill('input[autocomplete="cc-csc"],input[name="cardCvc"]', '123');
    for (const frame of this.page.frames()) {
      for (const [selector, value] of [['input[autocomplete="cc-name"]', 'SpeakSharp Test'],
        ['input[autocomplete="postal-code"]', '94105']] as const) {
        const field = frame.locator(selector).first();
        if (await field.isVisible()) await field.fill(value);
      }
    }
    await this.page.locator('button[type="submit"]').click();
    await this.page.waitForURL(u => u.origin === this.targets.app && u.searchParams.get('checkout') === 'success', { timeout: 90_000 });
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
    await this.paidAccess();
    const owners = await this.admin.from('user_profiles').select('id').eq('stripe_customer_id', this.customer);
    requireFact(!owners.error && owners.data?.length === 1 && owners.data[0].id === this.uid, 'wrong_account_entitlement');
    this.steps.add('paid_entitlement');
  }

  // ── The paid value loop ───────────────────────────────────────────────────────────────────────────────

  /** One eligible take from a page already on /session with the mic ready; returns the persisted, new session id. */
  async eligibleTake(label: string, previous: string | null): Promise<string> {
    await startBenchmarkRecording(this.page, label);
    await expectBenchmarkRecordingStarted(this.page, label);
    const startedAt = Date.now();
    await expectBenchmarkDraftActivity(this.page, label, 60_000);
    await sleep(Math.max(0, ELIGIBLE_TAKE_MS - (Date.now() - startedAt)));
    await stopBenchmarkRecording(this.page, label, 120_000);
    const candidate = await waitForBenchmarkSaveCandidate(this.page, label, 120_000);
    await expectFinalizedTranscriptOutput(this.page, label, candidate, 75);
    const saved = await this.poll(() => this.page.evaluate(() =>
      document.documentElement.getAttribute('data-session-persisted') === 'true'
        ? document.documentElement.getAttribute('data-session-persisted-id') ?? '' : ''), Boolean, `${label}_not_persisted`);
    requireFact(UUID.test(saved) && saved !== previous, `${label}_not_new_session`);
    return saved;
  }

  /** Server-side proof for a saved take: row, Private attribution authority, and an eligible clarity_v1 evaluation. */
  async provenTake(sessionId: string, code: string): Promise<void> {
    const row = await this.admin.from('sessions').select('id,user_id,status,engine,product').eq('id', sessionId).maybeSingle();
    requireFact(!row.error, `${code}_read_failed`);
    assertSavedTake(row.data, sessionId, this.uid, code);
    const authority = await this.admin.from('session_attribution_authority').select('engine_class,authority_version')
      .eq('session_id', sessionId).eq('user_id', this.uid).maybeSingle();
    requireFact(!authority.error && authority.data?.authority_version === 'attrib_v1'
      && authority.data.engine_class === 'private', `${code}_attribution_not_verified`);
    const evaluation = await this.poll(async () => {
      const read = await this.admin.from('session_progress_evaluations')
        .select('session_id,user_id,formula_version,eligible,exclusion_reasons,attribution_status')
        .eq('session_id', sessionId).eq('formula_version', PROGRESS_FORMULA).maybeSingle();
      requireFact(!read.error, 'evaluation_read_failed');
      return read.data;
    }, row => row !== null && row.attribution_status === 'verified', 'evaluation_not_recorded');
    assertEligibleEvaluation(evaluation, sessionId, this.uid);
  }

  async firstTakeAndCoaching(): Promise<void> {
    this.stage = 'first_take';
    requireFact((await this.usage()).can_start === true, 'paid_start_refused');
    await this.page.goto(`${this.targets.app}/practice`);
    await this.page.getByTestId('practice-card-freeform').click();
    await expect(this.page).toHaveURL(/\/session/, { timeout: 45_000 });
    await selectBenchmarkMode(this.page, 'private');
    const setup = await preparePrivateModelIfPrompted(this.page, 600_000);
    if (setup.recordingAlreadyStarted) {
      // The cold setup press is already the take (#1519): it still has to run long enough to be eligible.
      await expectBenchmarkRecordingStarted(this.page, 'paid-first');
    }
    this.firstTake = await this.eligibleTake('paid-first', null);
    this.steps.add('first_take_saved');
    await this.provenTake(this.firstTake, 'first_take');
    this.steps.add('first_take_eligible');

    this.stage = 'coaching';
    // Coaching is requested automatically after the save; the stored pair is the authority for what must render.
    const stored = await this.poll(async () => {
      const read = await this.admin.from('sessions').select('ai_suggestions').eq('id', this.firstTake).eq('user_id', this.uid).maybeSingle();
      requireFact(!read.error, 'coaching_read_failed');
      return read.data?.ai_suggestions ?? null;
    }, raw => raw !== null, 'coaching_not_saved', 180_000);
    const saved = savedCoaching(stored);
    this.steps.add('coaching_saved');
    await this.page.goto(`${this.targets.app}/analytics/${this.firstTake}`);
    const review = this.page.getByTestId('saved-review');
    await expect(review.getByTestId('review-try-next')).toBeVisible({ timeout: 60_000 });
    requireFact(coachingShownAsSaved(saved, {
      well: await review.getByTestId('review-what-went-well').textContent(),
      next: await review.getByTestId('review-try-next').textContent(),
    }), 'coaching_rendered_differs');
    this.steps.add('coaching_rendered');

    this.stage = 'recommendation';
    const rows = await this.poll(async () => {
      const read = await this.admin.from('progress_recommendations')
        .select('id,user_id,source_session_id,formula_version,target_metric,target_direction,target_value,target_units')
        .eq('source_session_id', this.firstTake).eq('formula_version', PROGRESS_FORMULA).limit(2);
      requireFact(!read.error, 'recommendation_read_failed');
      return read.data ?? [];
    }, list => list.length > 0, 'recommendation_not_recorded');
    this.recommendation = assertRecommendation(rows, this.firstTake, this.uid);
    this.steps.add('recommendation_recorded');
  }

  async linkedRepeat(): Promise<ServerEvidence> {
    this.stage = 'linked_repeat';
    await this.page.goto(`${this.targets.app}/analytics/${this.firstTake}`);
    const practice = this.page.getByTestId('saved-review-practice');
    await expect(practice).toBeEnabled({ timeout: 60_000 });
    const offeredLinked = await practice.getAttribute('data-link-state') === 'linked';
    requireFact(offeredLinked, 'repeat_not_offered_linked');
    await practice.click();
    await this.page.waitForURL('**/session', { timeout: 30_000 });
    await expect(this.page.getByTestId('repeat-practice-target')).toBeVisible({ timeout: 30_000 });
    await expect(this.page.getByTestId('mic-status')).toContainText('Mic ready on this device', { timeout: 60_000 });
    this.steps.add('linked_repeat_started');
    this.repeatTake = await this.eligibleTake('paid-repeat', this.firstTake);
    this.steps.add('repeat_take_saved');
    await this.provenTake(this.repeatTake, 'repeat_take');

    // The client resolves the attempt after the repeat saves; read until the bound attempt leaves `pending`.
    const attempts = () => this.admin.from('progress_recommendation_attempts')
      .select('id,lifecycle,outcome,accepted_at,practice_session_id').eq('recommendation_id', this.recommendation).eq('user_id', this.uid);
    await this.poll(async () => {
      const read = await attempts().eq('practice_session_id', this.repeatTake).limit(2);
      requireFact(!read.error, 'attempt_read_failed');
      return read.data ?? [];
    }, list => list.length > 0 && list.every(row => row.lifecycle !== 'pending'), 'repeat_not_resolved', 180_000);
    const [bound, newest, recommendation] = await Promise.all([
      attempts().eq('practice_session_id', this.repeatTake).limit(2),
      attempts().order('accepted_at', { ascending: false }).limit(2),
      this.admin.from('progress_recommendations').select('target_metric,target_direction,target_value,target_units')
        .eq('id', this.recommendation).maybeSingle(),
    ]);
    const server: ServerEvidence = bound.error || newest.error || recommendation.error ? { kind: 'read_failed' } : {
      kind: 'read',
      recommendation: recommendation.data ? { targetMetric: recommendation.data.target_metric,
        targetDirection: recommendation.data.target_direction, targetValue: recommendation.data.target_value,
        targetUnits: recommendation.data.target_units } : null,
      newest: (newest.data ?? []).map((row): ServerAttempt => ({ lifecycle: row.lifecycle, outcome: row.outcome,
        acceptedAt: row.accepted_at, isThisRepeat: row.practice_session_id === this.repeatTake, id: row.id })),
      boundCount: bound.data?.length ?? 0,
      boundId: bound.data?.[0]?.id,
    };
    // Resolution must name a coherent pair before the page is opened; any HOLD is a failure here.
    comparisonExpectation(server, offeredLinked);
    this.steps.add('repeat_resolved');
    return server;
  }

  /** The progress panel on the FIRST take's own review, read as closed states and line texts kept in memory. */
  async observeComparison(page: Page): Promise<PanelObservation> {
    const route = `/analytics/${this.firstTake}`;
    await page.goto(`${this.targets.app}${route}`);
    const panel = page.getByTestId('progress-panel');
    await expect(panel).toBeVisible({ timeout: 60_000 });
    const target = panel.getByTestId('progress-attempt-target');
    await target.waitFor({ timeout: 60_000 }).catch(() => undefined);
    const onRoute = () => new URL(page.url()).pathname === route;
    const panelText = (await panel.textContent()) ?? '';
    const state: PanelObservation['state'] = !onRoute() ? 'wrong_route'
      : await target.count() > 0 ? 'eligible'
        : await panel.getByTestId('progress-loading').count() > 0 ? 'not_settled'
          : /More evidence is needed/.test(panelText) ? 'insufficient'
            : /Comparison is unavailable/.test(panelText) ? 'ineligible'
              : await panel.getByRole('alert').count() > 0 ? 'error' : 'not_settled';
    const read = async (testId: string) => {
      const node = panel.getByTestId(testId);
      return await node.count() > 0 ? (await node.first().textContent()) : null;
    };
    const lines = { target: await read('progress-attempt-target'), outcome: await read('progress-attempt-outcome'),
      scope: await read('progress-attempt-scope') };
    const readsStable = onRoute() && (state !== 'eligible' || await target.count() > 0);
    return { state, ...lines, legacyPhrase: ((await panel.textContent()) ?? '').includes(LEGACY_PHRASE), readsStable };
  }

  async comparisonAndReadback(server: ServerEvidence): Promise<void> {
    this.stage = 'comparison';
    const expected = comparisonExpectation(server, true);
    assertComparisonShown(expected, await this.observeComparison(this.page));
    this.steps.add('comparison_shown');

    this.stage = 'readback';
    // A fresh browser context proves a real new sign-in, not cleared storage.
    const fresh = await this.page.context().browser()!.newContext({ baseURL: this.targets.app });
    try {
      const other = await fresh.newPage();
      await this.signIn(other);
      this.steps.add('sign_in_again');
      await other.goto(`${this.targets.app}/account`);
      await expect(other.getByTestId('membership-status')).toContainText('Pro · Active');
      assertComparisonShown(expected, await this.observeComparison(other));
      const stored = await this.admin.from('sessions').select('ai_suggestions').eq('id', this.firstTake).maybeSingle();
      requireFact(!stored.error, 'coaching_read_failed');
      const review = other.getByTestId('saved-review');
      await expect(review.getByTestId('review-try-next')).toBeVisible({ timeout: 60_000 });
      requireFact(coachingShownAsSaved(savedCoaching(stored.data?.ai_suggestions), {
        well: await review.getByTestId('review-what-went-well').textContent(),
        next: await review.getByTestId('review-try-next').textContent(),
      }), 'readback_coaching_differs');
      await other.goto(`${this.targets.app}/analytics/${this.repeatTake}`);
      await expect(other.getByTestId('session-detail-transcript')).toBeVisible({ timeout: 60_000 });
    } finally { await fresh.close(); }
    await this.paidAccess();
    this.steps.add('readback');
  }

  async run(): Promise<void> {
    await this.convert();
    await this.firstTakeAndCoaching();
    const server = await this.linkedRepeat();
    await this.comparisonAndReadback(server);
  }

  // ── Cleanup: same contract as journey.billing.spec.ts ───────────────────────────────────────────────────

  async cleanup(): Promise<void> {
    let stripeClean = !this.clock && !this.customer;
    let stripeFailed = false;
    let accountFailed = false;
    try {
      if (this.clock) {
        const deleted = await this.stripe(`test_helpers/test_clocks/${this.clock}`, 'DELETE');
        requireFact(deleted.deleted === true && deleted.id === this.clock, 'clock_cleanup_not_proven');
        stripeClean = true;
        if (this.customer) requireFact((await this.stripe(`customers/${this.customer}`)).deleted === true, 'customer_cleanup_not_proven');
      }
    } catch { stripeFailed = true; }
    try {
      if (this.signupAttempted) await cleanupRunOwnedAccount({ admin: this.admin as never,
        capturedUid: this.uid, createdEmail: this.email, runOwnedPrefix: 'rwt-journey-billing-' });
    } catch { accountFailed = true; }
    if (this.uid) {
      for (const table of ['account_billing_fences', 'account_checkout_operations', 'account_save_obligations']) {
        const readback = await this.admin.from(table).select('*', { count: 'exact', head: true }).eq('user_id', this.uid);
        if (readback.error || readback.count !== 0) accountFailed = true;
      }
    }
    requireFact(!stripeFailed && !accountFailed && stripeClean && !this.uncertainStripeCreate, 'cleanup_unproven');
    this.steps.add('cleanup');
  }
}

test('billing paid_value_loop: one paid test-mode account through coaching, linked repeat, comparison and return',
  async ({ page }, info) => {
    test.setTimeout(2_400_000);
    let run: PaidValueLoop | undefined;
    let failed = false;
    let reason: string | null = null;
    let cleanupFailed = false;
    try { run = new PaidValueLoop(page); await run.run(); }
    catch (error) { failed = true; reason = safeFailureReason(error); }
    finally {
      if (run) { try { await run.cleanup(); } catch { cleanupFailed = true; } }
      const result = paidValueLoopReceipt(run?.steps ?? new Set());
      await info.attach('billing-user-journey.json', { body: JSON.stringify({ ...result,
        result: failed || cleanupFailed ? 'INCOMPLETE' : result.result,
        failureStage: failed ? run?.stage ?? 'preflight' : null,
        reason,
        cleanup: cleanupFailed ? 'UNPROVEN' : run?.steps.has('cleanup') ? 'VERIFIED' : 'NOT_RUN',
        testedRelease: env.BILLING_SANDBOX_RELEASE_SHA?.match(/^[a-f0-9]{40}$/i)?.[0] ?? null,
      }), contentType: 'application/json' });
      requireFact(!failed && !cleanupFailed && result.result === 'PASSED', 'journey_incomplete_see_sanitized_receipt');
    }
  });
