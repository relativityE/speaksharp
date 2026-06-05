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
      category: 'stt',
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
  });

  it('stores optional transcript and audio note only when opted in', async () => {
    await issueReportService.submit({
      userId: 'user-1',
      category: 'stt',
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
  });
});
