// src/services/AnalyticsBuffer.ts
import posthog from 'posthog-js';
import * as Sentry from "@sentry/react";
import logger from '../lib/logger';
import { sanitizePrivateTelemetryProps } from './transcription/privateTelemetrySanitizer';
import { sanitizeV4TelemetryProps, isV4TelemetryEvent } from './transcription/privateV4TelemetrySanitizer';
import { projectEventProps, isGovernedEvent, type GovernedEvent } from './telemetryAllowlist';
import { buildEnvelope, stripEnvelopeKeys, type EnvelopeSources, type EventEnvelope } from './telemetry/envelope';
import { buildTrafficSignals } from './telemetry/trafficType';
import { resolvedEngine } from './telemetry/runtimeAttribution';
import { recordDrop, recordFlush, setTelemetryHealthEmitter, isHealthEvent } from './telemetry/telemetryHealth';


/**
 * Decouples telemetry from the main execution thread by blocking
 * analytics until the application signals "Ready".
 */

export type AnalyticsPriority = 'CRITICAL' | 'HIGH' | 'LOW';

/** Governed events, or the self-sanitizing `private_*` namespace. Nothing else may be emitted. */
export type AnalyticsEventName = GovernedEvent | `private_${string}`;

interface AnalyticsEvent {
  event: string;
  properties?: Record<string, unknown>;
  priority: AnalyticsPriority;
  timestamp: number;
  /**
   * THE ENVELOPE AS IT WAS WHEN THE EVENT HAPPENED.
   *
   * Built at `push()`, not at `send()`. The envelope answers "which model produced this?", and the
   * buffer can hold an event across a flush delay or an in-page model switch — so building it at send
   * time attributed a queued event to whichever engine happened to be resolved when the queue drained.
   * A take recorded on Moonshine and flushed after a switch to v2 was filed under v2, and nothing about
   * the event looked wrong afterwards.
   *
   * Snapshotting is the fix rather than "flush faster": any delay at all reintroduces it.
   *
   * Optional only for events injected directly into the queue (tests, and any future non-push path);
   * `send()` falls back to building one so such an event is still enveloped, just not snapshotted.
   */
  envelope?: EventEnvelope;
}

// #1259 T1 — the key-NAME denylist that used to live here is GONE, deliberately.
//
// It tested the key's name against /(transcript|audio|wav|blob|base64)/i, so any field whose name did not
// happen to match — `message`, `reason`, `error_message`, `notes` — carried its value to PostHog verbatim.
// Widening the pattern only defers the problem to the next field someone invents. Event properties are now
// projected onto a per-event allowlist in `telemetryAllowlist.ts`, which fails CLOSED on anything unknown.

class AnalyticsBuffer {
  private static instance: AnalyticsBuffer;

  /**
   * Where the envelope's ambient context comes from.
   *
   * Injected rather than imported so the engine that ACTUALLY ran can report itself, and so a test can
   * drive the real seam without a browser. Defaults to "nothing resolved", which yields null
   * attribution — honest, and never a fabricated model id.
   */
  private static envelopeSourcesProvider: () => EnvelopeSources =
    () => AnalyticsBuffer.productionEnvelopeSources();

  /**
   * The AUTHENTICATED account id, captured where it is already known.
   *
   * `traffic_type` classifies by WHO IS SIGNED IN, so the envelope needs the account id. Reading it
   * from a client self-declaration is the failure this field exists to prevent, and re-querying auth
   * at capture time would make every event await a promise.
   */
  private static currentAccountId: string | null = null;

  /**
   * #1259 — the SERVER'S claim that this account is an internal tester.
   *
   * Held beside the account id because it arrives with the same session and has the same lifetime. It
   * is never read from a build-time list: a `VITE_*` allowlist would compile the tester account ids
   * into the public bundle, which is how the first attempt at this failed review.
   */
  private static currentInternalTesterClaim = false;

  /** The server's claim that this account is the automated qualification canary. Same rules. */
  private static currentCanaryClaim = false;

  /**
   * THE PRODUCTION SOURCES — the default, not an opt-in.
   *
   * This used to default to `() => ({})`, so every field was null and every session read as `user`
   * traffic unless something called `setEnvelopeSources()`. Nothing in production did. The envelope
   * was wired end to end and still emitted nothing, which is indistinguishable from not having built
   * it — and it fails in the direction that HIDES our own traffic among real users.
   *
   * Making the default real inverts that: wiring can no longer be forgotten, only deliberately
   * replaced (which `setEnvelopeSources` still allows, for tests and for a harness that knows better).
   */
  private static productionEnvelopeSources(): EnvelopeSources {
    return {
      // The deployed release id injected into index.html. Null when absent — never a guess.
      releaseSha: typeof window !== 'undefined' ? (window.__APP_RELEASE__ ?? null) : null,
      // What the engine RESOLVED, published by the engine itself at resolution time.
      engineMetadata: resolvedEngine(),
      // Build-time signals plus the signed-in account; a visitor cannot forge either.
      trafficSignals: buildTrafficSignals(
        import.meta.env as unknown as Record<string, string | undefined>,
        AnalyticsBuffer.currentAccountId,
        AnalyticsBuffer.currentInternalTesterClaim,
        AnalyticsBuffer.currentCanaryClaim,
      ),
    };
  }

  public static setEnvelopeSources(provider: () => EnvelopeSources): void {
    AnalyticsBuffer.envelopeSourcesProvider = provider;
  }

  public static envelopeSources(): EnvelopeSources {
    try {
      return AnalyticsBuffer.envelopeSourcesProvider() ?? {};
    } catch {
      // Telemetry must never break a session. An unavailable source yields an honest empty envelope.
      return {};
    }
  }
  /** @internal */
  public queue: AnalyticsEvent[] = [];
  /** @internal */
  public ready = false;
  /** @internal */
  public isFlushing = false;
  /** @internal */
  public readonly MAX_QUEUE_SIZE = 1000;
  private readonly BATCH_SIZE = 10;
  /** Backpressure drops since the last report. Counted in push(), reported on drain — see push(). */
  private backpressureDropped = 0;
  /** Whether this drain carried anything other than health events. Breaks the report/requeue loop. */
  private sentNonHealthSinceDrain = false;

  // Non-PII identity observability probe (mirrored to window.__SS_ANALYTICS_IDENTITY__) so a deployed
  // proof can confirm EXACTLY which step of the identify path ran — without guessing from network
  // traces. Strictly mechanism counters/booleans: NO user.id, email, transcript, or any PII.
  private readonly identityProbe = {
    identifyCalls: 0,
    accountIdentifiedAttempts: 0,
    accountIdentifiedSendInstantly: false,
    lastAccountIdentifiedError: null as string | null,
    lastUpdated: 0,
  };

  private constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', () => this.drainSynchronously());
    }
  }

  public static getInstance(): AnalyticsBuffer {
    if (!AnalyticsBuffer.instance) {
      AnalyticsBuffer.instance = new AnalyticsBuffer();
    }
    return AnalyticsBuffer.instance;
  }

  /**
   * Push an event into the buffer logic.
   * If not ready, it queues. If ready, it sends according to priority.
   */
  /**
   * Emit a governed event.
   *
   * `event` is TYPED, not `string`. A dynamically-computed name that is not in `EVENT_SCHEMAS` — including
   * one produced by a wrapper such as practiceTelemetry's `emit(event, …)` or by a ternary — fails
   * COMPILATION rather than shipping with every property silently dropped. That is how
   * `freeform_practice_started` reached production ungoverned: a regex over literal
   * `analyticsBuffer.push('name')` call sites could not see it.
   *
   * `private_*` events are exempt from the schema registry because they carry their OWN allowlist
   * re-projection (`sanitizePrivateTelemetryProps`), applied in `send()`.
   */
  public push(
    event: AnalyticsEventName,
    properties?: Record<string, unknown>,
    priority: AnalyticsPriority = 'LOW',
    /**
     * Set false by a producer that has established it CANNOT attribute this event to a model.
     *
     * Without it the envelope silently overruled such a producer: Report Issue emitted
     * `engine_variant: null` for an unverifiable link, and the envelope then attached the current tab's
     * `candidate_id`, `engine`, `runtime_version` and `asset_digest` on the way to the wire — so a report
     * about a Moonshine session filed after switching to v2 arrived attributed to v2.
     */
    modelAttributionVerified = true,
  ): void {

    const analyticsEvent: AnalyticsEvent = {
      event,
      properties,
      priority,
      timestamp: Date.now(),
      // Captured HERE, at the producer boundary, while the state that produced the event is still the
      // current state.
      envelope: buildEnvelope(AnalyticsBuffer.envelopeSources(), modelAttributionVerified),
    };

    // CRITICAL Tier: Immediate delivery
    if (priority === 'CRITICAL' && this.ready) {
      this.drainSynchronously();
      this.send(analyticsEvent);
      return;
    }

    // Backpressure: Drop oldest if queue is full
    if (this.queue.length >= this.MAX_QUEUE_SIZE) {
      this.queue.shift(); // Drop oldest
      // #1259 F12 — a silent backpressure drop is indistinguishable from an event that was never
      // produced, so it must be reported. NOT from here: emitting inside the full-queue branch pushes
      // an event into the queue that is already full, which drops another, which emits again — an
      // unbounded recursion whose first symptom would be a hung tab. Counted here, reported once the
      // queue actually drains.
      this.backpressureDropped += 1;
    }

    this.queue.push(analyticsEvent);

    if (this.ready && !this.isFlushing) {
      this.scheduleFlush();
    }
  }

  /**
   * Flush all queued events and mark the buffer as ready for immediate sending.
   */
  public flush(): void {
    if (this.ready) return;

    logger.info({ count: this.queue.length }, '[AnalyticsBuffer] Marking ready and initiating flush...');
    this.ready = true;
    this.scheduleFlush();
  }

  /**
   * Background Scheduling Abstraction: Yield to browser
   * @internal
   */
  public scheduleFlush(): void {
    if (this.queue.length === 0) {
      this.isFlushing = false;
      return;
    }

    this.isFlushing = true;

    // Background Scheduling Hierarchy (yield to browser paint)
    // We explicitly avoid queueMicrotask as it would block rendering.
    const g = globalThis as unknown as { 
      scheduler?: { postTask: (cb: () => void, options: { priority: string }) => void },
      requestIdleCallback?: (cb: () => void) => void
    };

    if (typeof g.scheduler?.postTask === 'function') {
      g.scheduler.postTask(() => this.processBatch(), { priority: 'background' });
    } else if (typeof g.requestIdleCallback === 'function') {
      g.requestIdleCallback(() => this.processBatch());
    } else {
      setTimeout(() => this.processBatch(), 0);
    }
  }

  private processBatch(): void {
    // Adaptive Batching
    const batchSize = Math.min(this.BATCH_SIZE, Math.ceil(this.queue.length / 10));
    const batch = this.queue.splice(0, batchSize);

    for (const event of batch) {
      this.send(event);
    }

    if (this.queue.length > 0) {
      this.scheduleFlush(); // Yield and schedule next chunk
    } else {
      this.isFlushing = false;
      logger.debug('[AnalyticsBuffer] Background flush complete');
      // Report a drain ONLY when this pass carried real traffic. A health event is itself queued, so
      // reporting every drain means: drain -> emit health -> queue non-empty -> drain -> emit health,
      // forever. The flag makes the loop close after one report.
      if (this.sentNonHealthSinceDrain) {
        this.sentNonHealthSinceDrain = false;
        const dropped = this.backpressureDropped;
        this.backpressureDropped = 0;
        recordFlush(dropped > 0 ? 'backpressure_dropped' : 'drained', this.queue.length, dropped);
      }
    }
  }

  private drainSynchronously(): void {
    while (this.queue.length > 0) {
      const event = this.queue.shift();
      if (event) this.send(event);
    }
    this.isFlushing = false;
  }

  /**
   * #1259 F12 — the health emitter, injected rather than imported by the health module.
   *
   * The dependency runs one way: the boundary knows how to send, the health module knows what is worth
   * saying. Wiring it the other way would make a telemetry module import the buffer that imports it.
   */
  public wireHealthEmitter(): void {
    setTelemetryHealthEmitter((event, props, priority) => {
      // A health event that reported its own drops would emit another health event, and a telemetry
      // outage would become a telemetry flood. The health module already refuses to report on health
      // events; this is the same guard at the boundary, where it cannot be bypassed.
      if (!isHealthEvent(event)) return;
      this.push(event as AnalyticsEventName, props, priority);
    });
  }

  /**
   * Internal sender to PostHog and Sentry.
   */
  private send(event: AnalyticsEvent): void {
    if (!isHealthEvent(event.event)) this.sentNonHealthSinceDrain = true;
    try {
      // #1259 P2 — SECOND redaction boundary for Private events. The first boundary is the emitter
      // allowlist (`sanitizePrivateTelemetryProps`). Here, at the send boundary,
      // any `private_*` event's props are re-projected through that SAME allowlist, so a Private event can
      // never carry a non-allowlisted field even if a caller bypassed the emitter. Non-Private events use
      // the general transcript/audio key redaction.
      // #1259 T1 — EVERY non-Private event is projected onto its approved, content-free schema HERE, at
      // the real capture boundary, immediately before posthog.capture. Not in the producer, not in a
      // helper a caller can skip: a projection a producer can bypass is not a boundary.
      //
      // The previous policy was a DENYLIST on key NAMES, so `message`, `reason` and `error_message`
      // reached PostHog verbatim. Error text is the worst carrier — PostgREST and Postgres echo request
      // material back in message/details/hint, and `lib/storage.ts` already refuses to log raw errors
      // precisely because a completion request carries the full transcript.
      const isPrivateEvent = event.event.startsWith('private_');
      let sanitized: Record<string, unknown> | undefined;
      if (isPrivateEvent) {
        // #1259 — TWO ALLOWLISTS SHARE THE `private_*` NAMESPACE, so the namespace alone cannot pick one.
        //
        // `private_stt_v4_*` events used to leave through their own `posthog.capture` in
        // privateV4Telemetry, which is why they had a separate projection at all. Routing them here
        // without this branch would have applied the Private allowlist to them and dropped EVERY v4
        // field — `engine`, `dtype`, `resolvedDevice`, `loadMs`, `fallbackReason` — turning a
        // side-channel leak into three silently empty events, which is the worse failure: it looks
        // like working telemetry.
        sanitized = isV4TelemetryEvent(event.event)
          ? sanitizeV4TelemetryProps(event.properties)
          : sanitizePrivateTelemetryProps(event.properties);
      } else {
        const projected = projectEventProps(event.event, event.properties);
        sanitized = projected.props;
        if (projected.dropped.length > 0) {
          // Log the KEYS only. Logging the values would re-leak exactly what was just dropped.
          logger.warn(
            { event: event.event, droppedKeys: projected.dropped, governed: isGovernedEvent(event.event) },
            '[AnalyticsBuffer] dropped non-allowlisted telemetry properties',
          );
          // #1259 F12 — and EMIT it. A drop that exists only in a browser console is invisible in
          // Production, which is how a silently empty event stays silently empty. The keys stay local;
          // only the count and the source event travel.
          recordDrop(event.event, projected.dropped.length, isGovernedEvent(event.event));
        }
      }
      // #1259 T2 — THE ENVELOPE IS APPLIED HERE, at the same single boundary, and LAST.
      //
      // Producer props are stripped of envelope keys first, so a caller can never label its own
      // traffic `user` or claim a model it did not run. The seam's values are ambient context the
      // producer never had: which release, which model ACTUALLY resolved, which kind of traffic.
      // Without them a launch is unmeasurable in the two ways that already cost a release — testers
      // indistinguishable from smoke traffic, and sessions unattributable to a model.
      // The snapshot taken at push. Rebuilding here would re-acquire whatever is global NOW, which is
      // exactly the drift this replaces.
      const envelope = event.envelope ?? buildEnvelope(AnalyticsBuffer.envelopeSources());
      posthog.capture(event.event, {
        ...stripEnvelopeKeys(sanitized),
        ...envelope,
        $priority: event.priority,
        $ts: event.timestamp
      });
    } catch (err) {
      logger.warn({ err, event: event.event }, '[AnalyticsBuffer] Failed to send event to PostHog');
    }
  }

  /**
   * Identify a user in PostHog and Sentry.
   * Typically bypasses buffer as identity is required for event mapping.
   */
  /**
   * #1259 T1 — NO PROPERTIES PARAMETER.
   *
   * This previously accepted `properties` and forwarded them UNSANITIZED to both posthog.identify and
   * Sentry.setUser — a second, wider boundary than event capture, and one the event allowlist does not
   * govern. Person properties persist against the profile rather than a single event.
   *
   * Every caller passes only `user.id` (AuthProvider.tsx:105 is the sole one), so the parameter carried
   * no traffic and only carried risk. Removing it makes the leak unavailable rather than unused.
   */
  /**
   * Record the server's internal-tester claim for the signed-in account.
   *
   * Separate from `identify` so the claim cannot be supplied by a caller that merely knows a user id:
   * it must come from the session the server issued.
   */
  public setCanaryClaim(claim: boolean): void {
    AnalyticsBuffer.currentCanaryClaim = claim === true;
  }

  public setInternalTesterClaim(claim: boolean): void {
    // Strict `=== true`: a truthy string or a stray object from a malformed session must not grant
    // an internal classification. Anything that is not exactly the boolean the server issued is
    // treated as no claim at all.
    AnalyticsBuffer.currentInternalTesterClaim = claim === true;
  }

  public identify(userId: string): void {

    // Record BEFORE the capture below: `account_identified` is itself a governed event, and an
    // account identified after the fact would emit that first event as `user` traffic — precisely the
    // canary-looks-like-a-user confusion the field exists to remove.
    AnalyticsBuffer.currentAccountId = userId || null;
    this.identityProbe.identifyCalls += 1;
    try {
      posthog.identify(userId);
      // Materialize a SERVER-SIDE PostHog person (Gate B / flag targeting) — see
      // captureAccountIdentified(). It is ISOLATED in its own try/catch so a capture failure can
      // NEVER block the reloadFeatureFlags()/Sentry.setUser() below: flag reload after identify is
      // the load-bearing step and must always run.
      this.captureAccountIdentified();
      // Explicitly re-evaluate feature flags AFTER identify + capture so the app never keeps the
      // prior anonymous flag state (the Gate B stale-flag gotcha — flags must reflect the account).
      posthog.reloadFeatureFlags();
      Sentry.setUser({ id: userId });
      logger.debug({ userId }, '[AnalyticsBuffer] User identified');
    } catch (err) {
      logger.warn({ err }, '[AnalyticsBuffer] Failed to identify user');
    } finally {
      this.publishIdentityProbe();
    }
  }

  /** Mirror the non-PII identity probe to window so a deployed proof can read it. Never throws. */
  private publishIdentityProbe(): void {
    if (typeof window === 'undefined') return;
    try {
      this.identityProbe.lastUpdated = Date.now();
      (window as unknown as { __SS_ANALYTICS_IDENTITY__?: unknown }).__SS_ANALYTICS_IDENTITY__ = {
        ...this.identityProbe,
      };
    } catch {
      /* observability must never affect app behavior */
    }
  }

  /**
   * Emit ONE minimal, NON-PII event under the now-identified distinct_id to materialize a queryable
   * server-side PostHog person (Gate B / feature-flag targeting). posthog-js (1.298.1 deployed)
   * defaults person_profiles to 'identified_only', so a person is created only once an INGESTED event
   * is tied to the identified distinct_id; the lone $identify did not reliably ingest in short
   * sessions. STRICT no-PII: a constant source tag only — never email, name, transcript, audio,
   * secrets, or the raw auth/session object. Self-contained try/catch so a capture failure is
   * non-fatal and never prevents the caller's flag reload / Sentry update.
   */
  private captureAccountIdentified(): void {
    this.identityProbe.accountIdentifiedAttempts += 1;
    this.identityProbe.accountIdentifiedSendInstantly = true;
    try {
      // send_instantly:true SKIPS the batched request queue and POSTs the event to /e/ immediately.
      // Required for Gate B: a login is often followed quickly by navigation/page-close, and the
      // default batch flush is ~3s, so the materialization event otherwise never leaves the browser
      // (deployed proof saw /flags requests but ZERO /e/ requests; 0 server-side events under the
      // user.id). NOTE: posthog-js 1.298.1 has NO public flush() — the prior flush() attempt was a
      // silent no-op — so the per-event send_instantly option is the correct, documented mechanism.
      // THE ENVELOPE APPLIES HERE TOO. This is the one capture that deliberately bypasses the buffer,
      // so it would otherwise be the one event with no traffic_type — and a canary LOGIN looking like
      // a user login is precisely the signal the anti-silence gate exists to provide. candidate_id is
      // legitimately null at login: no engine has resolved yet, and null is the honest answer.
      posthog.capture('account_identified', {
        source: 'auth_provider',
        ...buildEnvelope(AnalyticsBuffer.envelopeSources()),
      }, { send_instantly: true });
      this.identityProbe.lastAccountIdentifiedError = null;
    } catch (err) {
      // Record only the error NAME (never the message) to keep the probe strictly PII-free.
      this.identityProbe.lastAccountIdentifiedError = err instanceof Error ? err.name : 'unknown';
      logger.warn({ err }, '[AnalyticsBuffer] Failed to send account_identified event');
    }
  }

  /**
   * Whether PostHog currently holds an IDENTIFIED (account-linked) distinct id — true after
   * identify() and until reset(). PostHog persists this across page loads (localStorage/cookie), so
   * on an anonymous/no-session boot it can still report a PRIOR user's identity. Callers use this to
   * decide whether a stale persisted identity must be cleared (shared device / expired session)
   * WITHOUT churning the anonymous id of a genuinely fresh anonymous visitor. Never throws; returns
   * false if the underlying posthog-js signal is unavailable so callers fall back to ref-only logic.
   */
  public isIdentified(): boolean {
    try {
      const ph = posthog as unknown as { _isIdentified?: () => boolean };
      return typeof ph._isIdentified === 'function' ? ph._isIdentified() : false;
    } catch {
      return false;
    }
  }

  /**
   * Clear the identified user on sign-out: reset PostHog to a fresh anonymous distinct id and clear
   * the Sentry user. Pairs with identify() so a shared device does not retain a prior account's
   * identity (and so PostHog feature-flag evaluation reverts to the anonymous/default cohort).
   */
  public resetIdentity(): void {
    try {
      posthog.reset();
      // Re-evaluate flags for the fresh anonymous id so a signed-out shared device does not retain
      // the prior account's flag evaluation.
      posthog.reloadFeatureFlags();
      Sentry.setUser(null);
      logger.debug('[AnalyticsBuffer] User identity reset');
    } catch (err) {
      logger.warn({ err }, '[AnalyticsBuffer] Failed to reset identity');
    }
  }
}

export const analyticsBuffer = AnalyticsBuffer.getInstance();
