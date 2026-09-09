import { describe, expect, it } from 'vitest';
import { governProductionRumEvent, PRODUCTION_RUM_OPTIONS } from '../productionRum';

describe('#1428 Production RUM', () => {
  it('enables only the selected Core Web Vitals without network timing, autocapture, or recording', () => {
    expect(PRODUCTION_RUM_OPTIONS).toMatchObject({
      capture_performance: {
        network_timing: false,
        web_vitals: true,
        web_vitals_allowed_metrics: ['LCP', 'INP', 'CLS'],
      },
      before_send: governProductionRumEvent,
      autocapture: false,
      capture_pageview: false,
      disable_session_recording: true,
    });
  });

  it('projects $web_vitals to numeric metrics and the minimum transport envelope', () => {
    const projected = governProductionRumEvent({
      uuid: 'event-uuid',
      event: '$web_vitals',
      properties: {
        '$token': 'project-token',
        distinct_id: 'account-id',
        '$lib': 'web',
        '$lib_version': '1.298.1',
        '$current_url': 'https://example.test/session?secret=user-value#private',
        '$session_id': 'session-id',
        '$window_id': 'window-id',
        '$web_vitals_LCP_value': 1234,
        '$web_vitals_LCP_event': { attribution: { interactionTargetElement: '<input value="secret">' } },
        '$web_vitals_INP_value': 75,
        '$web_vitals_CLS_value': 0.05,
        arbitrary: 'must not leave the browser',
      },
      $set: { email: 'user@example.test' },
      $set_once: { initial_url: 'https://example.test/?secret=user-value' },
    });

    expect(projected).toEqual({
      uuid: 'event-uuid',
      event: '$web_vitals',
      properties: {
        '$token': 'project-token',
        distinct_id: 'account-id',
        '$lib': 'web',
        '$lib_version': '1.298.1',
        '$web_vitals_LCP_value': 1234,
        '$web_vitals_INP_value': 75,
        '$web_vitals_CLS_value': 0.05,
      },
      timestamp: undefined,
    });
  });

  it('drops malformed web-vital payloads and leaves governed application events unchanged', () => {
    expect(governProductionRumEvent({
      uuid: 'bad-event',
      event: '$web_vitals',
      properties: { '$current_url': 'https://example.test/?secret=value' },
    })).toBeNull();

    const applicationEvent = {
      uuid: 'app-event',
      event: 'session_started',
      properties: { mode: 'private' },
    };
    expect(governProductionRumEvent(applicationEvent)).toBe(applicationEvent);
  });
});
