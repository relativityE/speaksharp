// src/services/AnalyticsBuffer.ts
import posthog from 'posthog-js';
import * as Sentry from "@sentry/react";
import logger from '@/lib/logger';
import { IS_TEST_ENVIRONMENT } from '@/config/env';

/**
 * Decouples telemetry from the main execution thread by blocking
 * analytics until the application signals "Ready".
 */

interface AnalyticsEvent {
  event: string;
  properties?: Record<string, unknown>;
}

class AnalyticsBuffer {
  private static instance: AnalyticsBuffer;
  private queue: AnalyticsEvent[] = [];
  private ready = false;

  private constructor() {
    // Prevent initialization in E2E to avoid side-effects
    if (IS_TEST_ENVIRONMENT) {
      this.ready = true; // In tests, we don't want to buffer
      return;
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
   * If not ready, it queues. If ready, it sends immediately.
   */
  public push(event: string, properties?: Record<string, unknown>): void {
    if (IS_TEST_ENVIRONMENT) return;

    if (!this.ready) {
      logger.debug({ event }, '[AnalyticsBuffer] Queuing event (not ready)');
      this.queue.push({ event, properties });
    } else {
      this.send(event, properties);
    }
  }

  /**
   * Flush all queued events and mark the buffer as ready for immediate sending.
   */
  public flush(): void {
    if (IS_TEST_ENVIRONMENT || this.ready) return;

    logger.info({ count: this.queue.length }, '[AnalyticsBuffer] Flushing queued events...');
    
    // Process the queue
    this.queue.forEach(item => {
      this.send(item.event, item.properties);
    });

    this.queue = [];
    this.ready = true;
    logger.info('[AnalyticsBuffer] Ready. Following events will be sent immediately.');
  }

  /**
   * Internal sender to PostHog and Sentry.
   */
  private send(event: string, properties?: Record<string, unknown>): void {
    try {
      posthog.capture(event, properties);
    } catch (err) {
      logger.warn({ err, event }, '[AnalyticsBuffer] Failed to send event to PostHog');
    }
  }

  /**
   * Identify a user in PostHog and Sentry.
   * Typically bypasses buffer as identity is required for event mapping.
   */
  public identify(userId: string, properties?: Record<string, unknown>): void {
    if (IS_TEST_ENVIRONMENT) return;

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
