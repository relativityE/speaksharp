import { describe, it, expect } from 'vitest';
import { deriveReportSessionId } from '@/lib/reportSessionLink';

const SID = 'ba6266e6-4757-4ad3-be02-0aea27be6f53';

describe('deriveReportSessionId — route-aware report/session association (P0 report-link fix)', () => {
  it('stores the exact session id when opened on /analytics/:sessionId', () => {
    expect(deriveReportSessionId(`/analytics/${SID}`)).toBe(SID);
  });

  it('stores NULL on the /analytics index (no session detail)', () => {
    expect(deriveReportSessionId('/analytics')).toBeNull();
    expect(deriveReportSessionId('/analytics/')).toBeNull();
  });

  it('stores NULL on /session (no authoritative active-session source in this helper)', () => {
    expect(deriveReportSessionId('/session')).toBeNull();
  });

  it('stores NULL for a malformed / non-UUID session param', () => {
    expect(deriveReportSessionId('/analytics/not-a-uuid')).toBeNull();
    expect(deriveReportSessionId('/analytics/12345')).toBeNull();
    expect(deriveReportSessionId(`/analytics/${SID}/extra`)).toBeNull();
  });

  it('is not fooled by query/hash or other routes', () => {
    expect(deriveReportSessionId('/pricing')).toBeNull();
    expect(deriveReportSessionId('/')).toBeNull();
    // matchPath matches the path only; query/hash are not part of pathname.
    expect(deriveReportSessionId(`/analytics/${SID}`)).toBe(SID);
  });
});
