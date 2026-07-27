import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildIssueReportMetadata, issueReportService } from '@/services/issueReportService';
import { resolvePageContext } from '@/services/pageContext';
import { getSupabaseClient } from '@/lib/supabaseClient';
import type { AppRuntimeConfig } from '@/config/appRuntimeConfig';

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
    const quick = resolvePageContext('/practice', 'quick_practice_overview');
    const guided = resolvePageContext('/practice', 'guided_rehearsal_unavailable');
    // Valid for the active surface → kept.
    expect(buildIssueReportMetadata({ context: quick, issueArea: 'open_practice_session' }).issueArea).toBe('open_practice_session');
    expect(buildIssueReportMetadata({ context: guided, issueArea: 'availability' }).issueArea).toBe('availability');
    // Valid for a DIFFERENT surface → coerced to null (no cross-surface leakage).
    expect(buildIssueReportMetadata({ context: quick, issueArea: 'availability' }).issueArea).toBeNull();
    expect(buildIssueReportMetadata({ context: guided, issueArea: 'open_practice_session' }).issueArea).toBeNull();
  });

  it('persists the active practiceSurface (and only a valid one) in metadata', () => {
    expect(buildIssueReportMetadata({ context: resolvePageContext('/practice', 'quick_practice_overview') }))
      .toMatchObject({ practiceSurface: 'quick_practice_overview', pageLabel: 'Freestyle Practice help', journeyStep: 'quick_overview', canonicalRoute: '/practice' });
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
  });

  it('stores metadata while excluding transcript and audio unless opted in', async () => {
    await issueReportService.submit({
      userId: 'user-1',
      category: 'recording_transcription',
      severity: 'high',
      title: 'Private mic failed',
      description: 'The microphone button did not start recording.',
      pageUrl: 'http://localhost:5174/session',
      metadata: { route: '/session', sttMode: 'private' },
      includeTranscript: false,
      transcriptExcerpt: 'Sensitive transcript must not be sent',
      includeAudio: false,
      audioAttachmentNote: 'Sensitive audio note must not be sent',
    });

    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      metadata: { route: '/session', sttMode: 'private' },
      include_transcript: false,
      transcript_excerpt: null,
      include_audio: false,
      audio_attachment_note: null,
    }));
    expect(select).not.toHaveBeenCalled();
  });

  it('stores optional transcript and audio note only when opted in', async () => {
    await issueReportService.submit({
      userId: 'user-1',
      category: 'recording_transcription',
      severity: 'medium',
      title: 'Transcript wrong',
      description: 'The final transcript replaced a phrase.',
      pageUrl: 'http://localhost:5174/session',
      metadata: { route: '/session', sttMode: 'private' },
      includeTranscript: true,
      transcriptExcerpt: 'User explicitly included this transcript.',
      includeAudio: true,
      audioAttachmentNote: 'User can provide audio separately.',
    });

    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      include_transcript: true,
      transcript_excerpt: 'User explicitly included this transcript.',
      include_audio: true,
      audio_attachment_note: 'User can provide audio separately.',
    }));
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
      includeTranscript: false,
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
      includeTranscript: false,
      includeAudio: false,
    });

    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ session_id: SESSION }));
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
        includeTranscript: false,
        includeAudio: false,
      }),
    ).rejects.toBeTruthy();
  });
});
