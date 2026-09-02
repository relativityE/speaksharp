import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildIssueReportMetadata, issueReportService } from '@/services/issueReportService';
import { resolvePageContext } from '@/services/pageContext';
import { getSupabaseClient } from '@/lib/supabaseClient';
import type { AppRuntimeConfig } from '@/config/appRuntimeConfig';
import { clearPrivateRecordingIdentity, setPrivateTelemetryContext } from '@/services/transcription/privateTelemetry';

const UUID_META = '130bbc6c-5d89-465d-91e6-51f5a5951e34';

// Build a full runtime config whose raw `url` embeds whatever sensitive segment a test wants to prove
// never survives into persisted metadata.
const runtimeConfigWithUrl = (url: string): AppRuntimeConfig => ({
  url, port: 5174, viteMode: 'production', authMode: 'real', mockAuth: false,
  supabaseUrl: 'https://yxlapjuovrsvjswkwnrk.supabase.co', releaseProofEligible: true,
  stripeKeyClass: 'live', release: 'c99208b917f5bb4223e8c40109ec4887e08abaef',
});
const setRuntimeConfig = (url: string) => {
  (window as unknown as { __APP_RUNTIME_CONFIG__?: AppRuntimeConfig }).__APP_RUNTIME_CONFIG__ = runtimeConfigWithUrl(url);
};

describe('buildIssueReportMetadata — page context + sanitization', () => {
  it('stores the sanitized canonical route TEMPLATE, never a concrete id/query/hash', () => {
    const context = resolvePageContext(`/analytics/${UUID_META}`);
    const meta = buildIssueReportMetadata({ context, issueArea: 'evidence', plan: 'pro', sttMode: 'private', runtimeState: 'idle' });
    expect(meta.route).toBe('/analytics/:sessionId');
    expect(meta.canonicalRoute).toBe('/analytics/:sessionId');
    // No id anywhere in the metadata blob.
    expect(JSON.stringify(meta)).not.toContain(UUID_META);
  });

  it('carries the allowlisted page-context fields and the chosen issue area', () => {
    const context = resolvePageContext('/session');
    const meta = buildIssueReportMetadata({ context, issueArea: 'transcription' });
    expect(meta).toMatchObject({
      pageKey: 'session',
      pageLabel: 'Session · Speaking',
      productMode: 'session',
      journeyStep: 'speaking',
      canonicalRoute: '/session',
      issueArea: 'transcription',
    });
  });

  it('defaults issueArea to null when none is supplied', () => {
    const meta = buildIssueReportMetadata({ context: resolvePageContext('/') });
    expect(meta.issueArea).toBeNull();
  });

  it('validates issueArea against THIS page allowlist at the service boundary (UI is not trusted alone)', () => {
    const session = resolvePageContext('/session');
    // Valid for this page → kept.
    expect(buildIssueReportMetadata({ context: session, issueArea: 'transcription' }).issueArea).toBe('transcription');
    // Valid for ANOTHER page (analytics), invalid for /session → coerced to null.
    expect(buildIssueReportMetadata({ context: session, issueArea: 'comparison' }).issueArea).toBeNull();
    // Arbitrary free text / injected value → null.
    expect(buildIssueReportMetadata({ context: session, issueArea: '<script>alert(1)</script>' }).issueArea).toBeNull();
    // Empty string → null.
    expect(buildIssueReportMetadata({ context: session, issueArea: '' }).issueArea).toBeNull();
  });

  it('validates issueArea against the ACTIVE /practice surface, rejecting cross-surface areas', () => {
    // #1042 PR3: overview surface removed — validate across the two remaining surfaces.
    const home = resolvePageContext('/practice', 'practice_home');
    const objective = resolvePageContext('/practice', 'objective_setup');
    // Valid for the active surface → kept.
    expect(buildIssueReportMetadata({ context: home, issueArea: 'understanding_choices' }).issueArea).toBe('understanding_choices');
    expect(buildIssueReportMetadata({ context: objective, issueArea: 'product_clarity' }).issueArea).toBe('product_clarity');
    // Valid for a DIFFERENT surface → coerced to null (no cross-surface leakage).
    expect(buildIssueReportMetadata({ context: home, issueArea: 'product_clarity' }).issueArea).toBeNull();
    expect(buildIssueReportMetadata({ context: objective, issueArea: 'understanding_choices' }).issueArea).toBeNull();
  });

  it('persists the active practiceSurface (and only a valid one) in metadata', () => {
    expect(buildIssueReportMetadata({ context: resolvePageContext('/practice', 'objective_setup') }))
      .toMatchObject({ practiceSurface: 'objective_setup', pageLabel: 'Focus Points', journeyStep: 'objective_setup', canonicalRoute: '/practice' });
    // Off /practice: no surface attached.
    expect(buildIssueReportMetadata({ context: resolvePageContext('/session') }).practiceSurface).toBeNull();
  });
});

// Regression for the post-#1022 P2 finding: the raw `appRuntimeConfig.url` (= window.location.href) must
// NEVER be persisted into report metadata — it carries dynamic route ids / query / fragment where session
// UUIDs, emails, and invite/reset tokens can appear. buildIssueReportMetadata must allowlist runtime facts.
describe('buildIssueReportMetadata — appRuntimeConfig URL hygiene (P2 leak fix)', () => {
  afterEach(() => {
    delete (window as unknown as { __APP_RUNTIME_CONFIG__?: unknown }).__APP_RUNTIME_CONFIG__;
  });

  it('never persists a session UUID from the runtime url (owned id belongs only in session_id)', () => {
    const uuid = '7e7aca2c-c192-4a80-8976-df5637859164';
    setRuntimeConfig(`https://speaksharp-public.vercel.app/analytics/${uuid}`);
    const meta = buildIssueReportMetadata({ context: resolvePageContext(`/analytics/${uuid}`) });
    expect(JSON.stringify(meta)).not.toContain(uuid);
    expect(meta.canonicalRoute).toBe('/analytics/:sessionId'); // sanitized template preserved
  });

  it.each([
    ['email path segment', 'https://app/u/reset/user@example.com/edit', 'user@example.com'],
    ['token path segment', 'https://app/invite/tok_live_9fA3Z7Qw', 'tok_live_9fA3Z7Qw'],
    ['query parameters', 'https://app/session?email=user@example.com&token=abc123', 'user@example.com'],
    ['query token value', 'https://app/session?token=abc123secret', 'abc123secret'],
    ['url fragment', 'https://app/analytics#access_token=frag-secret-xyz', 'frag-secret-xyz'],
  ])('never persists a %s from the runtime url', (_label, url, secret) => {
    setRuntimeConfig(url);
    const meta = buildIssueReportMetadata({ context: resolvePageContext('/session') });
    expect(JSON.stringify(meta)).not.toContain(secret);
  });

  it('keeps the allowlisted runtime facts but drops url / port / supabaseUrl', () => {
    setRuntimeConfig('https://speaksharp-public.vercel.app/analytics/7e7aca2c-c192-4a80-8976-df5637859164');
    const meta = buildIssueReportMetadata({ context: resolvePageContext('/session') });
    expect(meta.appRuntimeConfig).toEqual({
      viteMode: 'production', authMode: 'real', mockAuth: false,
      stripeKeyClass: 'live', releaseProofEligible: true,
      release: 'c99208b917f5bb4223e8c40109ec4887e08abaef',
    });
    // Top-level release breadcrumb still available for build pinning.
    expect(meta.releaseId).toBe('c99208b917f5bb4223e8c40109ec4887e08abaef');
    const cfg = meta.appRuntimeConfig as Record<string, unknown>;
    expect(cfg).not.toHaveProperty('url');
    expect(cfg).not.toHaveProperty('port');
    expect(cfg).not.toHaveProperty('supabaseUrl');
  });

  it('omits appRuntimeConfig entirely when no runtime config is published', () => {
    const meta = buildIssueReportMetadata({ context: resolvePageContext('/session') });
    expect(meta.appRuntimeConfig).toBeUndefined();
  });
});

vi.mock('@/lib/supabaseClient', () => ({
  getSupabaseClient: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

describe('issueReportService', () => {
  const insert = vi.fn();
  const select = vi.fn();
  const single = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    single.mockResolvedValue({ data: { id: 'report-1' }, error: null });
    select.mockReturnValue({ single });
    insert.mockReturnValue({ select });
    vi.mocked(getSupabaseClient).mockReturnValue({
      from: vi.fn(() => ({ insert })),
    } as unknown as ReturnType<typeof getSupabaseClient>);
    (window as unknown as { __SS_PRIVATE_EVENTS__?: unknown[] }).__SS_PRIVATE_EVENTS__ = [];
    clearPrivateRecordingIdentity();
  });

  it('#1306: the persisted payload NEVER carries a transcript field, and the audio note is excluded unless opted in', async () => {
    await issueReportService.submit({
      userId: 'user-1',
      category: 'recording_transcription',
      severity: 'high',
      title: 'Private mic failed',
      description: 'The microphone button did not start recording.',
      pageUrl: 'http://localhost:5174/session',
      metadata: { route: '/session', sttMode: 'private' },
      includeAudio: false,
      audioAttachmentNote: 'Sensitive audio note must not be sent',
    });

    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      metadata: { route: '/session', sttMode: 'private' },
      include_audio: false,
      audio_attachment_note: null,
    }));
    // No transcript field exists on the payload at all — not as a key, not as null.
    const payload = insert.mock.calls[0][0] as Record<string, unknown>;
    expect(payload).not.toHaveProperty('transcript_excerpt');
    expect(payload).not.toHaveProperty('include_transcript');
    expect(select).not.toHaveBeenCalled();
  });

  it('#1306: stores the optional audio note when opted in — and still never a transcript field', async () => {
    await issueReportService.submit({
      userId: 'user-1',
      category: 'recording_transcription',
      severity: 'medium',
      title: 'Audio issue',
      description: 'The recording level seemed off.',
      pageUrl: 'http://localhost:5174/session',
      metadata: { route: '/session', sttMode: 'private' },
      includeAudio: true,
      audioAttachmentNote: 'User can provide audio separately.',
    });

    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      include_audio: true,
      audio_attachment_note: 'User can provide audio separately.',
    }));
    const payload = insert.mock.calls[0][0] as Record<string, unknown>;
    expect(payload).not.toHaveProperty('transcript_excerpt');
    expect(payload).not.toHaveProperty('include_transcript');
    expect(select).not.toHaveBeenCalled();
  });

  it('defaults user_id to null when no account id is supplied (defensive fallback)', async () => {
    await issueReportService.submit({
      // no userId — defensive fallback only; authenticated surfaces always pass the account id
      category: 'something_else',
      severity: 'low',
      title: 'Minor wording issue',
      description: 'A label on the analytics page reads awkwardly.',
      pageUrl: 'http://localhost:5174/analytics',
      metadata: { route: '/analytics' },
      includeAudio: false,
    });

    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ user_id: null }));
    expect(select).not.toHaveBeenCalled();
  });

  it('persists the session_id and completes independently of telemetry/analytics', async () => {
    // No PostHog/analytics is mocked in this suite; the insert (persistence) must still be called
    // with the session id and submit must complete — report persistence does not depend on telemetry.
    const SESSION = '130bbc6c-5d89-465d-91e6-51f5a5951e34';
    await issueReportService.submit({
      userId: 'user-1',
      sessionId: SESSION,
      category: 'analytics_sessions',
      severity: 'medium',
      title: 'Detail number looks wrong',
      description: 'The session detail page shows an unexpected WPM value.',
      pageUrl: `http://localhost:5174/analytics/${SESSION}`,
      metadata: { route: `/analytics/${SESSION}` },
      includeAudio: false,
    });

    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ session_id: SESSION }));
  });

  it('never correlates a cleared first/new recording report to the previous take', async () => {
    setPrivateTelemetryContext({ session_id: 'previous-session', engine_variant: 'private_v2' });
    clearPrivateRecordingIdentity();
    await issueReportService.submit({
      userId: 'user-1',
      sessionId: null,
      category: 'recording_transcription',
      severity: 'medium',
      title: 'Setup problem',
      description: 'The new recording has not persisted yet.',
      pageUrl: 'http://localhost:5174/session',
      metadata: { route: '/session' },
      includeAudio: false,
    });

    const events = (window as unknown as { __SS_PRIVATE_EVENTS__: Array<Record<string, unknown>> }).__SS_PRIVATE_EVENTS__;
    const latestEvent = events[events.length - 1];
    // No live take to correlate to, so the link is FALSE — and the previous take's id must not be
    // resurrected as a stand-in.
    expect(latestEvent).toMatchObject({ event: 'report_issue_submitted', report_linked_to_session: false });
    expect(JSON.stringify(latestEvent)).not.toContain('previous-session');
  });

  it('reports NO link when the row has no session, even with a live take in the tab', async () => {
    // THE REGRESSION. This asserted `true` here, because the boolean was derived from
    // `input.sessionId ?? <live take id>`. The DB insert has no such fallback — it stores
    // `input.sessionId` alone — so a report filed mid-take before the session is persisted produced a
    // row with NO session link while telemetry claimed there was one. Every such report inflated the
    // funnel's linkage rate, and the disagreement was invisible because the two values were computed
    // from different inputs.
    setPrivateTelemetryContext({ session_id: 'previous-session' });
    clearPrivateRecordingIdentity();
    setPrivateTelemetryContext({ session_id: 'current-session' });
    await issueReportService.submit({
      userId: 'user-1',
      sessionId: null,
      category: 'recording_transcription',
      severity: 'medium',
      title: 'Recording problem',
      description: 'The current recording needs correlation.',
      pageUrl: 'http://localhost:5174/session',
      metadata: { route: '/session' },
      includeAudio: false,
    });

    const events = (window as unknown as { __SS_PRIVATE_EVENTS__: Array<Record<string, unknown>> }).__SS_PRIVATE_EVENTS__;
    const latestEvent = events[events.length - 1];
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ session_id: null }));
    expect(latestEvent).toMatchObject({ event: 'report_issue_submitted', report_linked_to_session: false });
    // The engine identity still rides along — it is content-free and is what makes a report
    // diagnosable — but neither session identifier reaches the wire.
    expect(JSON.stringify(latestEvent)).not.toContain('previous-session');
    expect(JSON.stringify(latestEvent), 'no raw session id on the wire').not.toContain('current-session');
  });

  it('keeps the boolean in agreement with the persisted row for every input', async () => {
    // The invariant, stated once over both branches: the boolean is a description of the ROW. Deriving
    // it from any other source is what allowed the two to drift apart, so this asserts them together
    // rather than asserting each in isolation.
    const LINKED = '130bbc6c-5d89-465d-91e6-51f5a5951e34';
    for (const sessionId of [LINKED, null]) {
      insert.mockClear();
      setPrivateTelemetryContext({ session_id: 'a-live-take', engine_variant: 'private_v2' });
      await issueReportService.submit({
        userId: 'user-1',
        sessionId,
        category: 'recording_transcription',
        severity: 'medium',
        title: 'Agreement check',
        description: 'The boolean must describe the row that was written.',
        pageUrl: 'http://localhost:5174/session',
        metadata: { route: '/session' },
        includeAudio: false,
      });

      const events = (window as unknown as { __SS_PRIVATE_EVENTS__: Array<Record<string, unknown>> }).__SS_PRIVATE_EVENTS__;
      const emitted = events[events.length - 1].report_linked_to_session;
      const written = (insert.mock.calls[0][0] as { session_id: string | null }).session_id;
      expect(emitted, `row session_id=${written} must agree with the emitted boolean`)
        .toBe(written !== null);
      expect(JSON.stringify(events[events.length - 1])).not.toContain('a-live-take');
    }
  });

  it('surfaces a persistence failure rather than masking it (persistence is authoritative)', async () => {
    // If the DB insert reports an error, submit must reject — persistence success is never inferred
    // from telemetry/alert delivery.
    insert.mockReturnValueOnce(Promise.resolve({ error: { message: 'db unavailable' } }));
    await expect(
      issueReportService.submit({
        userId: 'user-1',
        sessionId: null,
        category: 'something_else',
        severity: 'low',
        title: 'Some issue',
        description: 'Persistence failure should surface to the caller.',
        pageUrl: 'http://localhost:5174/session',
        metadata: { route: '/session' },
        includeAudio: false,
      }),
    ).rejects.toBeTruthy();
  });
});

describe('a report is attributed to the session it is linked to, never to the tab', () => {
    it('CASUALTY: an UNLINKED report carries no arm, rather than borrowing the current one', async () => {
        // `getLastPrivateIdentity()` is process-global: it holds whatever engine most recently resolved
        // in this tab, which need not be the engine that produced anything this report is about. Naming
        // it would read downstream exactly like a measurement.
        setPrivateTelemetryContext({ session_id: 'some-other-session', engine_variant: 'private_v2', release_sha: 'abc123' });
        await issueReportService.submit({
            userId: 'user-1', sessionId: null,
            category: 'recording_transcription', severity: 'medium',
            title: 'Something went wrong', description: 'It did not work.',
            pageUrl: 'http://localhost:5174/session', metadata: { route: '/session' }, includeAudio: false,
        });

        const events = (window as unknown as { __SS_PRIVATE_EVENTS__: Array<Record<string, unknown>> }).__SS_PRIVATE_EVENTS__;
        const latest = events[events.length - 1];
        expect(latest.report_linked_to_session).toBe(false);
        expect(latest.model_attribution_verified).toBe(false);
        expect(latest.engine_variant, 'an unlinked report must not borrow an arm').toBeNull();
        expect(latest.release_sha).toBeNull();
    });

    it('CASUALTY: a report linked to session A is NOT attributed to a later session B', async () => {
        const A = '130bbc6c-5d89-465d-91e6-51f5a5951e34';
        // The tab has since moved on to another session on a different arm.
        setPrivateTelemetryContext({ session_id: 'session-B', engine_variant: 'private_moonshine', release_sha: 'def456' });
        await issueReportService.submit({
            userId: 'user-1', sessionId: A,
            category: 'recording_transcription', severity: 'medium',
            title: 'About session A', description: 'The transcript was wrong.',
            pageUrl: 'http://localhost:5174/session', metadata: { route: '/session' }, includeAudio: false,
        });

        const events = (window as unknown as { __SS_PRIVATE_EVENTS__: Array<Record<string, unknown>> }).__SS_PRIVATE_EVENTS__;
        const latest = events[events.length - 1];
        expect(latest.report_linked_to_session).toBe(true);
        // Linked, but the identity we hold is session B's — so the arm is not verified and is withheld.
        // A complaint about one model being filed against another is the defect this prevents.
        expect(latest.model_attribution_verified).toBe(false);
        expect(latest.engine_variant).toBeNull();
        expect(JSON.stringify(latest)).not.toContain('session-B');
    });

    it('POSITIVE CONTROL: when the identity belongs to the linked session, the arm rides along', async () => {
        const A = '130bbc6c-5d89-465d-91e6-51f5a5951e34';
        setPrivateTelemetryContext({ session_id: A, engine_variant: 'private_moonshine', release_sha: 'abc123' });
        await issueReportService.submit({
            userId: 'user-1', sessionId: A,
            category: 'recording_transcription', severity: 'medium',
            title: 'About session A', description: 'The transcript was wrong.',
            pageUrl: 'http://localhost:5174/session', metadata: { route: '/session' }, includeAudio: false,
        });

        const events = (window as unknown as { __SS_PRIVATE_EVENTS__: Array<Record<string, unknown>> }).__SS_PRIVATE_EVENTS__;
        const latest = events[events.length - 1];
        expect(latest.model_attribution_verified).toBe(true);
        expect(latest.engine_variant).toBe('private_moonshine');
        // Still no raw identifier on the wire.
        expect(JSON.stringify(latest)).not.toContain(A);
    });
});
