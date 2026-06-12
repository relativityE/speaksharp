import { describe, it, expect, beforeAll } from 'vitest';
// REAL posthog-js (intentionally NOT mocked). This proves, end-to-end through the real SDK, that
// AnalyticsBuffer.identify() drives posthog to actually PROCESS the non-PII `account_identified`
// materialization event (it is not dropped by any config/guard) and that the processed event carries
// no PII. We assert via posthog's `before_send` hook — the last point an event passes through before
// transport.
//
// SCOPE / KNOWN LIMITATION (verified empirically, not assumed): jsdom cannot exercise posthog's
// network transport. A fully-processed `send_instantly` event reaches `before_send` and capture()
// returns a valid event object, yet ZERO fetch/XHR/sendBeacon requests fire in jsdom. So the actual
// "/e/ request fires immediately" proof is NOT achievable here — it is delegated to Test's real-
// browser deployed proof (now made conclusive by window.__SS_ANALYTICS_IDENTITY__). That
// send_instantly routes to the immediate-send branch (not the batch queue) is verified at the
// posthog-js source level; this test verifies the wiring + privacy that ARE provable in jsdom.
import posthog from 'posthog-js';
import { analyticsBuffer } from '../AnalyticsBuffer';

interface ProcessedEvent { event?: string; properties?: Record<string, unknown> }

const processed: ProcessedEvent[] = [];

describe('AnalyticsBuffer identity → REAL posthog-js processing (Gate B materialization)', () => {
  beforeAll(() => {
    posthog.init('phc_integration_test', {
      api_host: 'https://ph.integration.test',
      advanced_disable_flags: true,
      disable_external_dependency_loading: true,
      disable_session_recording: true,
      autocapture: false,
      capture_pageview: false,
      before_send: (ev) => {
        if (ev) processed.push(ev as ProcessedEvent);
        return ev;
      },
    });
  });

  it('drives real posthog to process a non-PII account_identified event on identify()', () => {
    processed.length = 0;
    analyticsBuffer.identify('itest-user-7a3f');

    const accountIdentified = processed.find((e) => e.event === 'account_identified');
    // Real posthog ACCEPTED and processed the event (not silently dropped by config/guards).
    expect(accountIdentified).toBeDefined();
    expect(accountIdentified?.properties?.source).toBe('auth_provider');

    // STRICT no-PII on the fully-enriched event: no email/transcript/audio/etc.
    const blob = JSON.stringify(accountIdentified);
    expect(blob).not.toMatch(/email|transcript|audio|password|secret|@/i);
  });

  it('records the non-PII identity probe (window.__SS_ANALYTICS_IDENTITY__) for deployed proofs', () => {
    analyticsBuffer.identify('itest-user-9c21');
    const probe = (window as unknown as { __SS_ANALYTICS_IDENTITY__?: Record<string, unknown> })
      .__SS_ANALYTICS_IDENTITY__;
    expect(probe).toBeDefined();
    expect(probe?.accountIdentifiedSendInstantly).toBe(true);
    expect((probe?.identifyCalls as number) ?? 0).toBeGreaterThan(0);
    expect((probe?.accountIdentifiedAttempts as number) ?? 0).toBeGreaterThan(0);
    // The probe itself must be PII-free (no user id / email leaked into the diagnostic surface).
    const probeBlob = JSON.stringify(probe);
    expect(probeBlob).not.toMatch(/itest-user|email|@/i);
  });
});
