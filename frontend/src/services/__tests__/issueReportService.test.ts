import { beforeEach, describe, expect, it, vi } from 'vitest';
import { issueReportService } from '@/services/issueReportService';
import { getSupabaseClient } from '@/lib/supabaseClient';

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
