// src/services/AnalyticsBuffer.ts
import posthog from 'posthog-js';
import * as Sentry from "@sentry/react";
import logger from '../lib/logger';
import { redactTranscript } from '../lib/logRedaction';


/**
 * Decouples telemetry from the main execution thread by blocking
 * analytics until the application signals "Ready".
 */

export type AnalyticsPriority = 'CRITICAL' | 'HIGH' | 'LOW';

interface AnalyticsEvent {
  event: string;
  properties?: Record<string, unknown>;
  priority: AnalyticsPriority;
  timestamp: number;
}

const SENSITIVE_ANALYTICS_KEY = /(transcript|audio|wav|blob|base64)/i;

const sanitizeAnalyticsValue = (key: string, value: unknown): unknown => {
  if (SENSITIVE_ANALYTICS_KEY.test(key)) {
    return typeof value === 'string'
      ? redactTranscript(value)
      : { redacted: true };
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeAnalyticsValue(key, item));
  }

  if (value && typeof value === 'object') {
    return sanitizeAnalyticsProperties(value as Record<string, unknown>);
  }

  return value;
};

const sanitizeAnalyticsProperties = (
  properties?: Record<string, unknown>,
): Record<string, unknown> | undefined => {
  if (!properties) return undefined;
  return Object.fromEntries(
    Object.entries(properties).map(([key, value]) => [key, sanitizeAnalyticsValue(key, value)]),
  );
};

class AnalyticsBuffer {
  private static instance: AnalyticsBuffer;
  /** @internal */
  public queue: AnalyticsEvent[] = [];
  /** @internal */
  public ready = false;
  /** @internal */
  public isFlushing = false;
  /** @internal */
  public readonly MAX_QUEUE_SIZE = 1000;
  private readonly BATCH_SIZE = 10;

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
  public push(event: string, properties?: Record<string, unknown>, priority: AnalyticsPriority = 'LOW'): void {

    const analyticsEvent: AnalyticsEvent = {
      event,
      properties,
      priority,
      timestamp: Date.now()
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
   * Internal sender to PostHog and Sentry.
   */
  private send(event: AnalyticsEvent): void {
    try {
      posthog.capture(event.event, {
        ...sanitizeAnalyticsProperties(event.properties),
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
  public identify(userId: string, properties?: Record<string, unknown>): void {

    try {
      posthog.identify(userId, properties);
      // Materialize a SERVER-SIDE PostHog person for the identified user (Gate B / feature-flag
      // targeting). posthog-js (1.298.1 deployed) defaults person_profiles to 'identified_only', so
      // a queryable person is created only once an INGESTED event is tied to the identified
      // distinct_id. On the deployed build the lone $identify did not reliably ingest (short sessions
      // never flushed a single batched event) — server-side showed 0 web $identify / 0 events under
      // the Supabase user.id — so no person appeared and flag targeting could not match. Emit ONE
      // minimal, NON-PII event under the now-identified distinct_id to guarantee materialization.
      // STRICT no-PII: a constant source tag only — never email, name, transcript, audio, secrets,
      // or the raw auth/session object.
      posthog.capture('account_identified', { source: 'auth_provider' });
      // Explicitly re-evaluate feature flags AFTER identify + capture so the app never keeps the
      // prior anonymous flag state (the Gate B stale-flag gotcha — flags must reflect the account).
      posthog.reloadFeatureFlags();
      Sentry.setUser({ id: userId, ...properties });
      logger.debug({ userId }, '[AnalyticsBuffer] User identified');
    } catch (err) {
      logger.warn({ err }, '[AnalyticsBuffer] Failed to identify user');
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
