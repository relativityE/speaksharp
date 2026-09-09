import { describe, expect, it } from 'vitest';
import { PRODUCTION_RUM_OPTIONS } from '../productionRum';

describe('#1428 Production RUM', () => {
  it('enables Core Web Vitals without enabling autocapture or session recording', () => {
    expect(PRODUCTION_RUM_OPTIONS).toEqual({
      capture_performance: true,
      autocapture: false,
      capture_pageview: false,
      disable_session_recording: true,
    });
  });
});
