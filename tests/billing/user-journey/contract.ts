/** Billing acceptance is separate from the fixed 15 practice journeys. No network or secrets here. */
import { BILLING_JOURNEYS, FULL_MODE_JOURNEYS, RUNNER_JOURNEYS, RUNNER_MODES, REQUIRED_STEPS, PENDING_POLICY,
  POLICY_PENDING_STEPS, LOCAL_STACK_JOURNEYS, type BillingJourney, type RunnerJourney, type RunnerMode,
  type LocalStackJourney } from './journeySteps.mjs';
export { BILLING_JOURNEYS, FULL_MODE_JOURNEYS, RUNNER_JOURNEYS, RUNNER_MODES, REQUIRED_STEPS, PENDING_POLICY,
  POLICY_PENDING_STEPS, LOCAL_STACK_JOURNEYS, type BillingJourney, type RunnerJourney, type RunnerMode,
  type LocalStackJourney };

/**
 * Which branches a run collects. No mode keeps today's three lifecycle branches unchanged. Anything other
 * than an exact mode name is refused at load, so a typo can never quietly run fewer branches.
 */
export function selectRunnerJourneys(raw: string | undefined): { mode: RunnerMode | null; journeys: readonly RunnerJourney[] } {
  if (raw === undefined || raw === '') return { mode: null, journeys: BILLING_JOURNEYS };
  requireFact((RUNNER_MODES as readonly string[]).includes(raw), 'runner_mode_unknown');
  const mode = raw as RunnerMode;
  return { mode, journeys: mode === 'smoke' ? ['conversion'] : RUNNER_JOURNEYS };
}

export function requireFact(value: unknown, code: string): asserts value {
  if (!value) throw new Error(`BILLING_JOURNEY:${code}`);
}

/** The fields the journey fills on Stripe's hosted Checkout page (or the portal), named content-free. */
export type HostedField = 'email' | 'card_number' | 'card_expiry' | 'card_cvc' | 'billing_country' | 'postal_code' | 'card_name';
const HOSTED_FIELDS: readonly HostedField[] = ['email', 'card_number', 'card_expiry', 'card_cvc', 'billing_country', 'postal_code', 'card_name'];

/**
 * The failure code when a required hosted field never became visible (run 44055010939 stopped at a bare
 * `hosted_field_unavailable`, which could not say which field). Names the field and whether a visible "Card" payment-method
 * choice was on the page (a form behind such a choice), as a closed code that `safeFailureReason` keeps. Content-free: no
 * page text, value or URL. It never relaxes the check: the field stays required.
 */
export function hostedFieldUnavailable(field: HostedField, cardChoiceShown: boolean | null): string {
  requireFact(HOSTED_FIELDS.includes(field), 'hosted_field_unknown');
  const choice = cardChoiceShown === true ? '_card_choice_shown' : cardChoiceShown === false ? '' : '_choice_unread';
  return `hosted_field_unavailable_${field}${choice}`;
}

/**
 * One content-free progress line, printed AS the journey runs (run 44080723593 timed out with no receipt, so its log named no step).
 * Fixed names and whole seconds only; any other name prints as `invalid`. Never ids, emails, URLs or provider text.
 */
export function progressLine(kind: 'step' | 'stage' | 'checkpoint', name: string, elapsedMs: number): string {
  const safe = typeof name === 'string' && /^[a-z0-9_.-]{1,64}$/.test(name) ? name : 'invalid';
  const t = Number.isFinite(elapsedMs) && elapsedMs >= 0 ? Math.floor(elapsedMs / 1000) : -1;
  return `BILLING_JOURNEY_PROGRESS ${kind}=${safe} t=${t}s`;
}

/** Every hosted-page fill and the Pay click are bounded (run 44080723593: an unbounded wait ran into the 10-minute test timeout). */
export const HOSTED_ACTION_MS = 30_000;
/** Diagnostic reads after a failed hosted action (isEnabled/isChecked wait for the element): bounded too, never the test timeout. */
export const HOSTED_READ_MS = 2_000;

/**
 * Run 44284831241: the app discards a take shorter than its minimum (frontend/src/config/env.ts MIN_SESSION_DURATION_SECONDS,
 * measured from its own start time at Stop) as "too short", and saves nothing. The journey stopped as soon as three words
 * appeared, about 1 s in, so the take was discarded and `recording_not_persisted` waited out its bound. The journey now holds
 * the take for the app's minimum plus a margin, timed from its own observation of the start (which is never before the app's
 * own start time), so the app's elapsed time at Stop is at least the hold. A static check pins the minimum to env.ts.
 */
export const APP_MIN_SESSION_DURATION_SECONDS = 5;
export const RECORDING_HOLD_MS = (APP_MIN_SESSION_DURATION_SECONDS + 2) * 1000;
/** How much longer to keep recording before Stop; 0 once the hold is met. Never negative; a non-finite start holds the full time. */
export function recordingHoldRemainingMs(startedObservedAt: number, now: number): number {
  if (!Number.isFinite(startedObservedAt) || !Number.isFinite(now)) return RECORDING_HOLD_MS;
  return Math.max(0, RECORDING_HOLD_MS - Math.max(0, now - startedObservedAt));
}
/**
 * The live take, watched IN the page from the moment capture is observed live (review of #1896 at 0db646a2):
 *  - live = the shell's capture-live state (`data-session-state="during"`, rendered only once capture is live, the app's clock
 *    re-based in that same update) AND the runtime naming its take (`__SPEECH_RUNTIME_DEBUG__().lifecycleVersion`);
 *  - the watch tags THIS document (a reload has no watch), and binds the runtime's session id once it is known;
 *  - any drop of the live state, take change or session change marks the watch broken for good (a later resume never repairs
 *    it): a MutationObserver reacts to every attribute/child change, with a 50 ms interval as a backstop;
 *  - Stop is clicked by the page itself in the same synchronous task as the final check, so nothing can change in between.
 * These are function BODIES run in the page (and executed against a fake DOM in the tests); they return content-free values.
 */
const TAKE_READ = `
  const shell = document.querySelector('[data-testid="session-shell"]');
  const debug = typeof window.__SPEECH_RUNTIME_DEBUG__ === 'function' ? window.__SPEECH_RUNTIME_DEBUG__() : null;
  const live = !!shell && shell.getAttribute('data-session-state') === 'during';
  const lifecycle = debug && typeof debug.lifecycleVersion === 'number' ? debug.lifecycleVersion : null;
  const session = debug && typeof debug.sessionId === 'string' ? debug.sessionId : null;`;
const TAKE_BROKEN = `
  if (!live) return 'capture_dropped';
  if (lifecycle !== w.lifecycle) return 'take_changed';
  if (w.session !== null && session !== w.session) return 'take_changed';
  return null;`;
/**
 * Installs the watch when capture is live; returns `doc|lifecycle`, or null while capture is not live (nothing installed).
 * Every change of the watched shell's `data-session-state` is read from its records with old values (the rwtAdverse.ts pattern:
 * each record's successor is the next record's oldValue, the last one's is the current value), so `during -> before -> during`
 * delivered in ONE callback still breaks the take. A second observer fails the take if the watched shell element is replaced.
 */
export const WATCH_INSTALL_SCRIPT = `${TAKE_READ}
  if (!live || lifecycle === null) return null;
  if (window.__billingTake) return null;
  const w = { doc: 'doc-' + Math.random().toString(36).slice(2) + '-' + Date.now(), lifecycle, session, shell, broken: null,
    timer: null, stateObserver: null, treeObserver: null };
  const recordState = (records) => {
    for (let i = 0; i < records.length; i++) {
      const before = records[i].oldValue;
      const after = i + 1 < records.length ? records[i + 1].oldValue : w.shell.getAttribute('data-session-state');
      if (!w.broken && (before !== 'during' || after !== 'during')) w.broken = 'capture_dropped';
    }
  };
  const check = () => {
    if (w.broken) return;
    ${TAKE_READ}
    if (shell !== w.shell) { w.broken = 'take_changed'; return; }
    const reason = (() => { ${TAKE_BROKEN} })();
    if (reason) { w.broken = reason; return; }
    if (w.session === null && session !== null) w.session = session;
  };
  w.timer = window.setInterval(check, 50);
  if (typeof window.MutationObserver === 'function') {
    w.stateObserver = new window.MutationObserver((records) => { recordState(records); check(); });
    w.stateObserver.observe(shell, { attributes: true, attributeFilter: ['data-session-state'], attributeOldValue: true });
    w.treeObserver = new window.MutationObserver(() => check());
    w.treeObserver.observe(document.documentElement, { childList: true, subtree: true });
  }
  window.__billingTake = w;
  return w.doc + '|' + lifecycle;`;
const TAKE_DRAIN = `
  if (w.stateObserver) {
    const pending = w.stateObserver.takeRecords();
    for (let i = 0; i < pending.length; i++) {
      const before = pending[i].oldValue;
      const after = i + 1 < pending.length ? pending[i + 1].oldValue : w.shell.getAttribute('data-session-state');
      if (!w.broken && (before !== 'during' || after !== 'during')) w.broken = 'capture_dropped';
    }
  }
  if (w.treeObserver) w.treeObserver.takeRecords();
  if (!w.broken && shell !== w.shell) w.broken = 'take_changed';`;
/** The watch's current verdict for `expectedKey`: the same key while the take is intact, else null (drains pending records). */
export const takeStatusScript = (expectedKey: string) => `${TAKE_READ}
  const w = window.__billingTake;
  if (!w || (w.doc + '|' + w.lifecycle) !== ${JSON.stringify(expectedKey)}) return null;
  ${TAKE_DRAIN}
  if (w.broken) return null;
  const reason = (() => { ${TAKE_BROKEN} })();
  return reason ? null : ${JSON.stringify(expectedKey)};`;
/**
 * The final check and the Stop click, in ONE synchronous page task, after draining every pending record. Returns
 * { clicked, reason, session }: clicked only for the exact watched take, still live and never broken; the session is the
 * take's own id (null if the runtime never named one).
 */
export const stopGateScript = (expectedKey: string) => `${TAKE_READ}
  const w = window.__billingTake;
  if (!w || (w.doc + '|' + w.lifecycle) !== ${JSON.stringify(expectedKey)}) return { clicked: false, reason: 'take_watch_missing', session: null };
  ${TAKE_DRAIN}
  if (w.broken) return { clicked: false, reason: w.broken, session: null };
  const reason = (() => { ${TAKE_BROKEN} })();
  if (reason) { w.broken = reason; return { clicked: false, reason, session: null }; }
  const stop = document.querySelector('[data-testid="recorder-stop"]');
  if (!stop || stop.disabled) return { clicked: false, reason: 'stop_unavailable', session: null };
  const takeSession = w.session !== null ? w.session : session;
  stop.click();
  if (w.timer !== null) window.clearInterval(w.timer);
  if (w.stateObserver) w.stateObserver.disconnect();
  if (w.treeObserver) w.treeObserver.disconnect();
  w.stopped = true;
  return { clicked: true, reason: null, session: takeSession };`;
/** Wraps a body for page.evaluate. */
export const pageScript = (body: string) => `(() => {${body}\n})()`;
export type TakeProbe = () => Promise<string | null>;
type Clock = { now(): number; sleep(ms: number): Promise<void> };

/** Polls until capture is live and the watch is installed; returns that take's key and the moment it was OBSERVED live. */
export async function observeCaptureLive(opts: { probe: TakeProbe; clock: Clock; timeoutMs: number }): Promise<{ takeKey: string; observedAt: number }> {
  const deadline = opts.clock.now() + opts.timeoutMs;
  do {
    const key = await opts.probe();
    if (key !== null) return { takeKey: key, observedAt: opts.clock.now() };
    await opts.clock.sleep(250);
  } while (opts.clock.now() < deadline);
  throw new Error('BILLING_JOURNEY:capture_live_unconfirmed');
}

export type StopGateResult = { clicked: boolean; reason: string | null; session: string | null };
/**
 * Holds from the observed capture-live moment (bounded re-check of an early-waking sleep), then hands the final check and the
 * click to the page in one task (`stop`). A take that broke at any point, or a gate that did not click, is a named stop.
 * Returns the take's own session id and the held time.
 */
export async function holdThenStop(opts: { startedObservedAt: number; takeKey: string; probe: TakeProbe; clock: Clock;
  stop(): Promise<StopGateResult> }): Promise<{ session: string | null; heldMs: number }> {
  for (let i = 0; i < 20; i++) {
    const remaining = recordingHoldRemainingMs(opts.startedObservedAt, opts.clock.now());
    if (remaining === 0) break;
    requireFact(await opts.probe() === opts.takeKey, 'take_not_live_at_stop');
    await opts.clock.sleep(remaining);
  }
  requireFact(recordingHoldRemainingMs(opts.startedObservedAt, opts.clock.now()) === 0, 'recording_hold_not_met');
  requireFact(await opts.probe() === opts.takeKey, 'take_not_live_at_stop');
  const gate = await opts.stop();
  if (!gate.clicked) throw new Error(`BILLING_JOURNEY:take_not_live_at_stop_${gate.reason === 'capture_dropped' || gate.reason === 'take_changed'
    || gate.reason === 'take_watch_missing' || gate.reason === 'stop_unavailable' ? gate.reason : 'unread'}`);
  return { session: gate.session, heldMs: opts.clock.now() - opts.startedObservedAt };
}

/**
 * After Stop, one read of everything that can end the take: the app's too-short status, the save candidate and the persisted id.
 * Too short ends it at once even with no candidate; a candidate or saved row for another session is the wrong take.
 */
export type TakeOutcomeRead = { tooShort: boolean; candidateSession: string | null; persistedId: string | null };
export function takeOutcome(read: TakeOutcomeRead, takeSession: string | null): 'pending' | 'saved' | 'recording_discarded_too_short'
  | 'save_candidate_not_this_take' | 'saved_row_not_this_take' {
  if (read.tooShort) return 'recording_discarded_too_short';
  if (read.persistedId) return takeSession !== null && read.persistedId === takeSession ? 'saved' : 'saved_row_not_this_take';
  if (read.candidateSession !== null && takeSession !== null && read.candidateSession !== takeSession) return 'save_candidate_not_this_take';
  return 'pending';
}

/** The app's own too-short status (useSessionLifecycle): the take was discarded, so no save will ever arrive. */
export const APP_TOO_SHORT_STATUS = 'Session too short';

/**
 * The exact hosted-Checkout controls, read from Stripe's own markup on a run's open card-only session (17 Nov 2026, read-only, PO's
 * browser DevTools): the Subscribe button (Link's express button is type="button", never this), and Link's "Save my information"
 * opt-in, a custom checkbox whose real input sits under a styled wrapper and is toggled through its label.
 */
export const HOSTED_SELECTORS = Object.freeze({
  submit: '[data-testid="payment-form-submit-button"]',
  linkOptInInput: '#payment-linkOptInInput',
  linkOptInLabel: '#Field-linkOptInCheckbox',
  // Run 44141620120 (after #1889): Stripe marked 2 fields invalid and never returned. The PO's DevTools on that run's own open session
  // show three REQUIRED billing fields (aria-required="true") even with billing_address_collection unset: the country <select>, the ZIP
  // (autocomplete="billing postal-code", so the old exact `postal-code` selector never matched) and the name on card.
  country: '#payment-countryInput',
  postalCode: '#payment-postalCodeInput',
  cardName: '#payment-nameInput',
  // Run 44157731067 (`fields_email`): read in the PO's DevTools on that run's own open session. The email box is Link's
  // authentication input, `type="text"` with `inputmode="email"`, so the journey's old `input[type="email"]` could never match it.
  email: '#linkAuthentication-emailInput',
});

/**
 * The hosted field a visible invalid control belongs to, by its id or name attribute only (never its value), as a closed short token:
 * a page change can only produce `other`, never page text.
 */
const INVALID_FIELD_TOKENS: Readonly<Record<string, string>> = Object.freeze({
  'payment-nameInput': 'name', name: 'name', 'linkAuthentication-emailInput': 'email', 'payment-postalCodeInput': 'zip', postalCode: 'zip', 'payment-countryInput': 'country',
  country: 'country', cardNumber: 'number', 'payment-numberInput': 'number', cardExpiry: 'expiry', 'payment-expiryInput': 'expiry',
  cardCvc: 'cvc', 'payment-cvcInput': 'cvc', email: 'email',
});
/**
 * The disposable Stripe Customer the journey preassigns. Only CONVERSION gets the fixture's own run-owned email (Sam on #1892:
 * "existing-customer sandbox conversion"); every other journey's Customer request is exactly what it was before (clock + owner marker).
 */
export function fixtureCustomerFields(journey: string, f: { clock: string; email: string; marker: string }): Record<string, string> {
  const base: Record<string, string> = { test_clock: f.clock, 'metadata[speaksharp_test]': f.marker };
  return journey === 'conversion' ? { ...base, email: f.email } : base;
}

/**
 * Which hosted control to use, given each candidate selector's matches in PRIORITY order (`visible[s][m]`: whether match m of selector
 * s is visible, across frames). The first selector with ANY visible match wins, at its first visible match: a hidden match before a
 * visible one never hides it, and a generic selector never outranks the observed control. Null when nothing is visible.
 */
export function firstVisibleControl(visible: readonly (readonly boolean[])[]): { selector: number; match: number } | null {
  for (let s = 0; s < visible.length; s++) {
    const m = visible[s].indexOf(true);
    if (m >= 0) return { selector: s, match: m };
  }
  return null;
}

/**
 * Run 44203911253: the bound existing Customer carries the fixture email, so Checkout showed it PREFILLED and not editable, and filling it
 * failed (hosted_field_not_editable_email). What to do with a VISIBLE email control (Sam, 17 Nov):
 *   - editable: fill it (the caller then reads the value back);
 *   - not editable and holding exactly the expected fixture email, with the bound Customer's email proven to BE that fixture email:
 *     supplied, nothing typed;
 *   - not editable with another value, or the Customer's email not proven to be the fixture's: `hosted_email_prefilled_mismatch`;
 *   - editability or the value unreadable: `hosted_email_unreadable`.
 * Values are compared only; no email ever leaves this function.
 */
export function hostedEmailFieldAction(input: { editable: boolean | null; current: string | null; expected: string; ownerBound: boolean }):
  'fill' | 'supplied' | 'hosted_email_prefilled_mismatch' | 'hosted_email_unreadable' {
  if (input.editable === true) return 'fill';
  if (input.editable !== false || typeof input.current !== 'string') return 'hosted_email_unreadable';
  return input.ownerBound && input.current === input.expected ? 'supplied' : 'hosted_email_prefilled_mismatch';
}
/**
 * #1835 (practice privacy choices): transcript saving is OFF until the owner opts in, so a paid recording keeps its transcript only
 * after THIS run's own account recorded "Save transcripts". The fact comes from the server row read for the exact owner, never from
 * the UI alone:
 *   - table absent: `not_applicable` ONLY when the tested build is independently known to predate #1835 (its own migrations, which
 *     the local stack applied, have no #1835 migration). If the build includes #1835, or its schema identity is unknown, a missing
 *     or unreadable table stops before recording (Sam, 17 Nov);
 *   - this owner's row with saving on: `opted_in`;
 *   - no row (no choice recorded), saving off, another owner's row, a malformed row or an unreadable read: a named stop BEFORE any
 *     recording, never a generic `paid_recording_not_proven` later.
 */
export type PrivacyTableRead = { state: 'absent' } | { state: 'unreadable' } | { state: 'read'; row: unknown };
/** The #1835 migration, by exact file name, in the tested commit's own migrations directory. */
export const PRIVACY_MIGRATION = '20261117105700_practice_privacy_choices_1835.sql';
export type PrivacyBuild = 'includes' | 'predates' | 'unknown';
/** From the tested checkout's migration file names; an unreadable or empty listing is `unknown`, never "predates". */
export function privacyBuildState(migrationFiles: readonly string[] | null): PrivacyBuild {
  if (!Array.isArray(migrationFiles) || migrationFiles.length === 0) return 'unknown';
  return migrationFiles.includes(PRIVACY_MIGRATION) ? 'includes' : 'predates';
}
export function privacyOptInFact(read: PrivacyTableRead, ownerId: string, build: PrivacyBuild): 'not_applicable' | 'opted_in' | `privacy_choice_${'missing' | 'declined' | 'wrong_owner' | 'unreadable'}` | `privacy_schema_${'missing' | 'unknown' | 'unexpected'}` {
  if (read.state === 'absent') return build === 'predates' ? 'not_applicable' : build === 'includes' ? 'privacy_schema_missing' : 'privacy_schema_unknown';
  if (read.state !== 'read') return build === 'unknown' ? 'privacy_schema_unknown' : 'privacy_choice_unreadable';
  // A build known to predate #1835 has no such table: one that answers means the schema is not the tested build's.
  if (build === 'predates') return 'privacy_schema_unexpected';
  const row = read.row as { user_id?: unknown; transcript_save?: unknown; consent_version?: unknown } | null;
  if (row === null || row === undefined) return 'privacy_choice_missing';
  if (row.user_id !== ownerId) return 'privacy_choice_wrong_owner';
  if (row.consent_version !== 1 || typeof row.transcript_save !== 'boolean') return 'privacy_choice_unreadable';
  return row.transcript_save ? 'opted_in' : 'privacy_choice_declined';
}

/**
 * After the journey answered the prompt (Save transcripts, No coaching): the same owner's server row must show exactly that, saving
 * on AND coaching off, before `privacy_opted_in` is emitted. Anything else is `privacy_choice_not_recorded`.
 */
export function privacyAnswerRecorded(read: PrivacyTableRead, ownerId: string): boolean {
  if (read.state !== 'read') return false;
  const row = read.row as { user_id?: unknown; transcript_save?: unknown; ai_coaching?: unknown; consent_version?: unknown } | null;
  return !!row && row.user_id === ownerId && row.consent_version === 1 && row.transcript_save === true && row.ai_coaching === false;
}

/** The #1835 Practice privacy prompt's own controls (frontend/src/components/privacy/PracticePrivacyPrompt.tsx). */
export const PRIVACY_PROMPT = Object.freeze({
  prompt: 'practice-privacy-prompt', saveYes: 'privacy-save-yes', aiNo: 'privacy-ai-no', continue: 'privacy-continue',
});

/**
 * The consent step before the paid recording, as ONE sequence the journey calls (executed against both build states in the
 * tests). Only a build proven by its own migration list to predate #1835 skips it; an unknown build stops before any read of
 * the prompt or any click. On a #1835 build an existing choice is never rewritten: it must already be the same owner's
 * save=yes / coaching=no, with zero clicks. Otherwise the real prompt is answered save yes, coaching no, continue, and the
 * answer is proven by the same owner's server row before the checkpoint.
 */
export async function optInThroughPrompt(deps: {
  build: PrivacyBuild; ownerId: string; readChoice(): Promise<PrivacyTableRead>;
  prompt: { waitVisible(): Promise<boolean>; click(control: 'saveYes' | 'aiNo' | 'continue'): Promise<void>; waitHidden(): Promise<void> };
  checkpoint(name: string): void;
}): Promise<'not_applicable' | 'existing_choice' | 'answered'> {
  requireFact(deps.build !== 'unknown', 'privacy_schema_unknown');
  const first = await deps.readChoice();
  const before = privacyOptInFact(first, deps.ownerId, deps.build);
  if (before === 'not_applicable') return 'not_applicable';
  if (before === 'opted_in') { requireFact(privacyAnswerRecorded(first, deps.ownerId), 'privacy_choice_coaching_not_off'); return 'existing_choice'; }
  if (before !== 'privacy_choice_missing') requireFact(false, before);
  requireFact(await deps.prompt.waitVisible(), 'privacy_choice_missing');
  await deps.prompt.click('saveYes');
  await deps.prompt.click('aiNo');
  await deps.prompt.click('continue');
  await deps.prompt.waitHidden();
  const recorded = await deps.readChoice();
  requireFact(privacyAnswerRecorded(recorded, deps.ownerId), 'privacy_choice_not_recorded');
  requireFact(privacyOptInFact(recorded, deps.ownerId, deps.build) === 'opted_in', 'privacy_choice_not_recorded');
  deps.checkpoint('privacy_opted_in');
  return 'answered';
}

export function invalidFieldToken(attrs: { id: string | null; name: string | null }): string {
  for (const key of [attrs.id, attrs.name]) if (typeof key === 'string' && Object.hasOwn(INVALID_FIELD_TOKENS, key)) return INVALID_FIELD_TOKENS[key];
  return 'other';
}

/**
 * Subscribe was clicked but Stripe never returned to the app within the bound. Content-free facts of what the hosted page showed then:
 * the Link opt-in state, whether a phone field was shown, visible alerts and invalid inputs, and whether a challenge frame was shown.
 * `null` is unread, never zero or false.
 */
export function checkoutNotReturned(f: { optIn: 'checked' | 'clear' | 'absent' | null; phoneShown: boolean | null; alerts: number | null;
  invalid: number | null; challenge: boolean | null; invalidFields: readonly string[] | null }): string {
  const n = (v: number | null) => (Number.isSafeInteger(v) && (v as number) >= 0 ? String(v) : 'unread');
  const b = (v: boolean | null, yes: string, no: string) => (v === true ? yes : v === false ? no : 'unread');
  const optIn = f.optIn === 'checked' || f.optIn === 'clear' || f.optIn === 'absent' ? f.optIn : 'unread';
  // Which fields were invalid (closed tokens, sorted and de-duplicated), so a refused form names its field instead of a bare count.
  const tokens = Array.isArray(f.invalidFields) ? [...new Set(f.invalidFields.map((t) => (Object.values(INVALID_FIELD_TOKENS).includes(t) ? t : 'other')))].sort() : null;
  const fields = tokens === null ? 'unread' : tokens.length ? tokens.join('_') : 'none';
  return `checkout_success_not_reached_optin_${optIn}_phone_${b(f.phoneShown, 'shown', 'none')}_alerts_${n(f.alerts)}_invalid_${n(f.invalid)}_challenge_${b(f.challenge, 'shown', 'none')}_fields_${fields}`;
}

/** Stripe Link's default-ticked "save my information" opt-in could not be cleared; the journey never creates a Link account. */
export const HOSTED_LINK_OPT_IN_NOT_CLEARED = 'hosted_link_optin_not_cleared';

/** A hosted field that was visible but did not accept input within the bound, named content-free. */
export function hostedFieldNotEditable(field: HostedField): string {
  requireFact(HOSTED_FIELDS.includes(field), 'hosted_field_unknown');
  return `hosted_field_not_editable_${field}`;
}

/**
 * The Pay button did not take the click within the bound. Content-free facts only: whether it was visible and enabled, and how
 * many visible inputs the hosted page marked invalid (`null` = could not be read; never treated as zero).
 */
export function hostedSubmitUnavailable(facts: { visible: boolean | null; enabled: boolean | null; invalidFields: number | null }): string {
  const state = facts.visible === false ? 'hidden' : facts.visible === null ? 'unread' : facts.enabled === false ? 'disabled' : facts.enabled === true ? 'enabled' : 'unread';
  const invalid = Number.isSafeInteger(facts.invalidFields) && (facts.invalidFields as number) >= 0 ? String(facts.invalidFields) : 'unread';
  return `hosted_submit_unavailable_${state}_invalid_${invalid}`;
}

/**
 * Whether the hosted email field must be filled, when the card is entered (run 44066185734: hosted_field_unavailable_email).
 * Email is REQUIRED by default. A visible editable field is always filled. It may be absent only when the page on screen is the
 * exact Checkout session that `assertCheckoutIdentity` already proved is this run's open, unpaid test-mode session for the
 * run-owned Stripe customer and app user (`boundSession`) AND that bound customer's email is EXACTLY this run's fixture email
 * (`boundCustomerEmailIsFixture === true`: compared from Stripe's own Customer read, never kept or reported). Only then is there no
 * email for Checkout to ask for. Run 44157731067 (after #1890): the customer had no email, Checkout still required one, and the old
 * rule (bound session alone) skipped it: the form stayed unconfirmable with `fields_email`. Sam's hold on #1895 (18f006c6): mere
 * presence of a non-empty email is not enough either, because a bound customer carrying some OTHER email would let the journey
 * skip the field. A customer without an email, with a different one, or whose email is unread never takes the absent path; an
 * unbound, different or unknown session never skips it.
 */
export function hostedEmailDecision(input: { emailFieldVisible: boolean; shownSession: string | null; boundSession: string | null;
  boundCustomerEmailIsFixture: boolean | null }): 'fill' | 'absent_after_binding' | 'missing' {
  if (input.emailFieldVisible) return 'fill';
  const bound = typeof input.boundSession === 'string' && /^cs_test_[A-Za-z0-9]+$/.test(input.boundSession)
    && input.shownSession === input.boundSession;
  return bound && input.boundCustomerEmailIsFixture === true ? 'absent_after_binding' : 'missing';
}

/**
 * The hosted form never reported it can confirm (`data-can-confirm` read "false" within the bound): Subscribe is NOT clicked, and the
 * stop names the controls Stripe marked invalid (closed tokens, as in `checkoutNotReturned`). An unread state does not stop the run.
 */
export function hostedFormNotConfirmable(invalidFields: readonly string[] | null): string {
  const known = new Set(Object.values(INVALID_FIELD_TOKENS));
  const tokens = Array.isArray(invalidFields) ? [...new Set(invalidFields.map((t) => (known.has(t) ? t : 'other')))].sort() : null;
  return `hosted_form_not_confirmable_fields_${tokens === null ? 'unread' : tokens.length ? tokens.join('_') : 'none'}`;
}

export function safeFailureReason(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  // Closed token alphabet (lower-case letters, digits, underscore): named codes carry counts (run 44098470690's receipt lost them as
  // `unclassified_step_failure` under the old [a-z_]{1,80}). Anything else, a URL or free text included, stays unclassified.
  return /^BILLING_JOURNEY:([a-z0-9_]{1,160})$/.exec(message)?.[1] ?? 'unclassified_step_failure';
}

/** All output is a closed, content-free list. Never serialize provider responses or credentials. */
export function receipt(journey: LocalStackJourney, steps: ReadonlySet<string>) {
  const required = REQUIRED_STEPS[journey];
  const pending: readonly string[] = POLICY_PENDING_STEPS[journey] ?? [];
  requireFact([...steps].every(step => required.includes(step)), 'unknown_step');
  // Access after a membership ends is on hold: such a step can never be recorded as proven.
  requireFact([...steps].every(step => !pending.includes(step)), 'policy_pending_step_asserted');
  const missing = required.filter(step => !pending.includes(step) && !steps.has(step));
  return {
    schema: 'billing-user-journey/v1', journey, stripeMode: 'test',
    result: missing.length ? 'INCOMPLETE' : pending.length ? PENDING_POLICY : 'PASSED',
    steps: required.map(step => ({ step,
      result: pending.includes(step) ? PENDING_POLICY : steps.has(step) ? 'PASSED' : 'NOT_PROVEN' })),
  };
}

/** The run marker every fixture carries. A fixed shape, so a foreign or empty marker is refused. */
export const RUN_MARKER = /^rwt-journey-billing-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Fields for the one test-clock create. The run marker goes in `name` IN THE CREATE REQUEST, before the
 * uncertain-create boundary: if the response is lost, the clock can still be attributed to this run by name
 * instead of being an unowned leftover. Refuses to build the request without a valid marker.
 */
export function testClockCreateFields(marker: string, nowSeconds: number): Record<string, string> {
  requireFact(RUN_MARKER.test(marker), 'run_marker_invalid');
  requireFact(Number.isSafeInteger(nowSeconds) && nowSeconds > 0, 'clock_time_invalid');
  return { frozen_time: String(nowSeconds), name: marker };
}

/**
 * The journey's own receipt status. On the local stack it can never say PASSED or VERIFIED by itself: the
 * billing rows were not read, so it waits for the workflow's checked teardown and destruction proof.
 */
export function localStackStatus(result: string, cleanup: string, localStack: boolean): { result: string; cleanup: string } {
  if (!localStack) return { result, cleanup };
  return {
    result: result === 'PASSED' ? 'PENDING_STACK_DESTRUCTION' : result,
    cleanup: cleanup === 'VERIFIED' ? 'PENDING_STACK_DESTRUCTION' : cleanup,
  };
}

export function assertTestPrice(input: unknown): void {
  const price = (input ?? {}) as { livemode?: unknown; active?: unknown; unit_amount?: unknown;
    currency?: unknown; recurring?: { interval?: unknown; interval_count?: unknown } };
  requireFact(price.livemode === false && price.active === true, 'price_not_active_test');
  requireFact(price.unit_amount === 1000 && price.currency === 'usd'
    && price.recurring?.interval === 'month' && price.recurring?.interval_count === 1, 'wrong_price');
}

export function assertInvoice(input: unknown, customer: string, subscription: string, reason: string): void {
  const invoice = (input ?? {}) as { livemode?: unknown; status?: unknown; amount_paid?: unknown;
    currency?: unknown; billing_reason?: unknown; customer?: unknown; subscription?: unknown };
  requireFact(invoice.livemode === false && invoice.status === 'paid' && invoice.amount_paid === 1000
    && invoice.currency === 'usd' && invoice.billing_reason === reason, 'invoice_not_paid_contract');
  requireFact(invoice.customer === customer && invoice.subscription === subscription, 'invoice_identity');
}

/** A real provider event plus the deployed processing ledger, never an unchanged tier alone. */
export type BillingEvent = { id: string; livemode: boolean; type: string; api_version: string;
  request?: { id?: string | null; idempotency_key?: string | null } | null;
  data: { object: { id: string; customer: string; cancel_at_period_end?: boolean; status?: string } } };

/** The webhook's per-refund-event idempotency key (stripe-webhook/refund.ts). */
export const REFUND_CANCEL_KEY_PREFIX = 'refund-cancel-at-period-end-';

/**
 * The refund branch's cancellation must be the webhook's own follow-up to THIS refund event: the
 * subscription.updated event carries the request's idempotency key, which names the refund event. A
 * cancellation made any other way (portal, dashboard, test code) does not count.
 */
export function isRefundCancellation(input: unknown, expected: { subscription: string; customer: string; refundEventId: string }): boolean {
  const event = (input ?? {}) as Partial<BillingEvent>;
  return /^evt_[A-Za-z0-9]+$/.test(expected.refundEventId) && event.type === 'customer.subscription.updated'
    && event.livemode === false && event.data?.object?.id === expected.subscription
    && event.data?.object?.customer === expected.customer && event.data?.object?.cancel_at_period_end === true
    && event.data?.object?.status === 'active'
    && event.request?.idempotency_key === `${REFUND_CANCEL_KEY_PREFIX}${expected.refundEventId}`;
}

/** The operator refund is the whole first payment, in test mode, on this run's own charge. */
export function assertFullRefund(input: unknown, charge: string): void {
  const refund = (input ?? {}) as { object?: unknown; status?: unknown; amount?: unknown; currency?: unknown; charge?: unknown };
  requireFact(refund.object === 'refund' && refund.status === 'succeeded' && refund.amount === 1000
    && refund.currency === 'usd' && refund.charge === charge, 'refund_not_full_contract');
}

/**
 * The Checkout URL the app returned, checked BEFORE the browser goes anywhere (Sam's v5 and fa7e7180 returns):
 * Stripe's own hosted origin over https, no credentials or port, and exactly one test-mode session id.
 */
export function checkoutSessionFromUrl(raw: unknown): string {
  requireFact(typeof raw === 'string' && raw.length > 0, 'checkout_unavailable');
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error('BILLING_JOURNEY:checkout_origin'); }
  requireFact(url.protocol === 'https:' && url.origin === 'https://checkout.stripe.com'
    && url.username === '' && url.password === '' && url.port === '', 'checkout_origin');
  const sessions = url.pathname.match(/cs_(?:test|live)_[A-Za-z0-9]+/g) ?? [];
  requireFact(sessions.length === 1 && sessions[0].startsWith('cs_test_'), 'test_checkout_required');
  return sessions[0];
}

/**
 * The provider's own record of that session, also read before navigation: this member's test-mode subscription
 * Checkout, still open and unpaid, returning only to this app.
 */
export function assertCheckoutIdentity(input: unknown, expected: { session: string; customer: string; uid: string; app: string }): void {
  const session = (input ?? {}) as { id?: unknown; livemode?: unknown; mode?: unknown; status?: unknown; payment_status?: unknown;
    customer?: unknown; client_reference_id?: unknown; metadata?: { userId?: unknown } | null; success_url?: unknown; cancel_url?: unknown };
  const originOf = (raw: unknown) => { try { return typeof raw === 'string' ? new URL(raw).origin : ''; } catch { return ''; } };
  requireFact(session.id === expected.session && session.livemode === false && session.mode === 'subscription', 'checkout_identity');
  requireFact(session.customer === expected.customer && session.client_reference_id === expected.uid
    && session.metadata?.userId === expected.uid, 'checkout_identity');
  requireFact(session.status === 'open' && session.payment_status === 'unpaid', 'checkout_not_open');
  requireFact(originOf(session.success_url) === expected.app && originOf(session.cancel_url) === expected.app, 'checkout_return_origin');
}

/**
 * The payment method the member just added in the portal: exactly one card that was not on the customer before
 * the Add (so the 4242 card from Checkout, or a no-op Add, can never satisfy it), and not the failing card.
 */
export function newlyAddedCard(listed: unknown, before: readonly string[], excluded: string): string {
  const page = (listed ?? {}) as { data?: unknown; has_more?: unknown };
  requireFact(Array.isArray(page.data) && page.has_more === false, 'payment_method_page_incomplete');
  const fresh = (page.data as { id?: unknown; card?: { last4?: unknown } | null }[])
    .filter(pm => typeof pm?.id === 'string' && !before.includes(pm.id) && pm.id !== excluded);
  requireFact(fresh.length === 1 && fresh[0].card?.last4 === '4242', 'portal_card_not_added');
  return fresh[0].id as string;
}

/**
 * After a full refund and the period end, no second charge: a complete, identity-bound invoice read that holds
 * the original paid invoice, and nothing else that took money. An empty or partial list proves nothing.
 */
export function assertNoSecondCharge(listed: unknown, expected: { customer: string; subscription: string; firstInvoice: string }): void {
  const page = (listed ?? {}) as { data?: unknown; has_more?: unknown };
  requireFact(Array.isArray(page.data) && page.has_more === false, 'invoice_page_incomplete');
  const invoices = page.data as { id?: unknown; livemode?: unknown; customer?: unknown; subscription?: unknown; amount_paid?: unknown }[];
  requireFact(invoices.every(i => i?.livemode === false && i.customer === expected.customer && i.subscription === expected.subscription),
    'invoice_identity');
  const first = invoices.filter(i => i.id === expected.firstInvoice);
  requireFact(first.length === 1 && first[0].amount_paid === 1000, 'original_invoice_missing');
  requireFact(invoices.every(i => i.id === expected.firstInvoice || i.amount_paid === 0), 'second_charge_after_refund');
}

/** A declined or abandoned Checkout grants nothing: no subscription, no payment, the session not complete. */
export function assertCheckoutGrantedNothing(input: unknown, expectedStatus: 'open' | 'expired'): void {
  const session = (input ?? {}) as { livemode?: unknown; status?: unknown; payment_status?: unknown; subscription?: unknown };
  requireFact(session.livemode === false && session.status === expectedStatus && session.payment_status === 'unpaid'
    && (session.subscription === null || session.subscription === undefined), 'failed_checkout_granted_something');
}

/**
 * A Stripe event's `api_version` is the account's default API version when the event was CREATED, and it never changes: the
 * `Stripe-Version` header on the read does not re-render it. This sandbox account's events carry `2025-07-30.basil` (the owner's
 * `customer.created` list for run 44203911253, an event the journey caused while sending `2024-06-20`), so an exact `2024-06-20`
 * check could never accept a genuine delivery. The correlation reads only id, type, livemode, data.object.id and
 * data.object.customer, which both versions render the same; the version must still be a real Stripe version string.
 */
export const STRIPE_EVENT_API_VERSION = /^20\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])(\.[a-z]+)?$/;

export function isCorrelatedDelivery(input: unknown, expected: {
  type: string; objectId: string; customer: string;
}, ledger: { event_id?: unknown; event_type?: unknown; processed_at?: unknown } | null): boolean {
  const event = (input ?? {}) as Partial<BillingEvent>;
  return /^evt_[A-Za-z0-9]+$/.test(event.id ?? '') && event.livemode === false
    && typeof event.api_version === 'string' && STRIPE_EVENT_API_VERSION.test(event.api_version)
    && event.type === expected.type && event.data?.object?.id === expected.objectId
    && event.data?.object?.customer === expected.customer
    && ledger?.event_id === event.id && ledger?.event_type === 'subscription.snapshot'
    && typeof ledger?.processed_at === 'string' && Number.isFinite(Date.parse(ledger.processed_at));
}

/** The disposable stack started inside the approval-gated workflow: loopback only, never a hosted project. */
export const LOCAL_STACK_STATUS = 'LOCAL_DISPOSABLE_STACK';
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost']);

export function assertSandboxConfiguration(env: Record<string, string | undefined>, target: {
  status: string; appOrigin: string | null; apiOrigin: string | null; productionApiOrigin: string | null;
}) {
  // A caller cannot admit an arbitrary app/database by naming two different URLs in its environment.
  // Changing this committed target requires code/security review before any fixture may be created.
  const local = target.status === LOCAL_STACK_STATUS;
  requireFact((target.status === 'REVIEWED_ISOLATED_SANDBOX' || local) && target.appOrigin && target.apiOrigin
    && target.productionApiOrigin, 'sandbox_target_not_reviewed');
  const names = ['BILLING_SANDBOX_APP_URL', 'BILLING_SANDBOX_SUPABASE_URL', 'BILLING_SANDBOX_ANON_KEY',
    'BILLING_SANDBOX_SERVICE_ROLE_KEY', 'BILLING_SANDBOX_STRIPE_KEY', 'BILLING_SANDBOX_PRICE_ID',
    'BILLING_SANDBOX_RELEASE_SHA', 'BILLING_PRODUCTION_SUPABASE_URL'];
  requireFact(names.every(name => Boolean(env[name]?.trim())), 'missing_sandbox_configuration');
  requireFact(env.BILLING_JOURNEY_APPROVAL === 'ISOLATED-TEST-MODE-ONLY', 'missing_sandbox_acknowledgment');
  requireFact(env.BILLING_SANDBOX_STRIPE_KEY?.startsWith('sk_test_'), 'test_key_required');
  requireFact(/^[0-9a-f]{40}$/i.test(env.BILLING_SANDBOX_RELEASE_SHA!), 'release_sha_required');
  const origin = (raw: string, loopback = false) => {
    let url: URL;
    try { url = new URL(raw); } catch { throw new Error('BILLING_JOURNEY:invalid_origin'); }
    requireFact(!url.username && !url.password && !url.search && !url.hash && url.pathname === '/', 'https_origin_required');
    // Plain http is admitted ONLY for the local stack's loopback app/API; everything else stays https.
    if (loopback) requireFact(url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname), 'loopback_origin_required');
    else requireFact(url.protocol === 'https:', 'https_origin_required');
    return url.origin;
  };
  const app = origin(env.BILLING_SANDBOX_APP_URL!, local);
  const api = origin(env.BILLING_SANDBOX_SUPABASE_URL!, local);
  const productionApi = origin(env.BILLING_PRODUCTION_SUPABASE_URL!);
  requireFact(app === target.appOrigin && api === target.apiOrigin && productionApi === target.productionApiOrigin,
    'sandbox_target_binding_mismatch');
  requireFact(app !== 'https://speaksharp-public.vercel.app' && api !== productionApi, 'production_target_refused');
  return { app, api };
}
