// src/services/AnalyticsBuffer.ts
import posthog from 'posthog-js';
import * as Sentry from "@sentry/react";
import logger from '../lib/logger';


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
    // Initialization logic
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
      timestamp: performance.now()
    };

    // CRITICAL Tier: Immediate delivery
    if (priority === 'CRITICAL' && this.ready) {
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

  /**
   * Internal sender to PostHog and Sentry.
   */
  private send(event: AnalyticsEvent): void {
    try {
      posthog.capture(event.event, {
        ...event.properties,
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
      Sentry.setUser({ id: userId, ...properties });
      logger.debug({ userId }, '[AnalyticsBuffer] User identified');
    } catch (err) {
      logger.warn({ err }, '[AnalyticsBuffer] Failed to identify user');
    }
  }
}

export const analyticsBuffer = AnalyticsBuffer.getInstance();
