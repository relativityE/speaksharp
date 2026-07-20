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
  const invoke = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    // Store-first: insert(...).select('id') resolves to the inserted row (own report) or [] (anon).
    select.mockResolvedValue({ data: [{ id: 'report-1' }], error: null });
    insert.mockReturnValue({ select });
    invoke.mockResolvedValue({ data: { report_id: 'report-1', alerted: true }, error: null });
    vi.mocked(getSupabaseClient).mockReturnValue({
      from: vi.fn(() => ({ insert })),
      functions: { invoke },
    } as unknown as ReturnType<typeof getSupabaseClient>);
  });

  const baseInput = {
    userId: 'user-1',
    category: 'recording_transcription' as const,
    severity: 'high' as const,
    title: 'Private mic failed',
    description: 'The microphone button did not start recording.',
    pageUrl: 'http://localhost:5174/session',
    metadata: { route: '/session', sttMode: 'private' as const },
    includeTranscript: false,
    includeAudio: false,
  };

  it('stores metadata while excluding transcript and audio unless opted in', async () => {
    await issueReportService.submit({
      ...baseInput,
      transcriptExcerpt: 'Sensitive transcript must not be sent',
      audioAttachmentNote: 'Sensitive audio note must not be sent',
    });

    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      metadata: { route: '/session', sttMode: 'private' },
      include_transcript: false,
      transcript_excerpt: null,
      include_audio: false,
      audio_attachment_note: null,
    }));
    expect(select).toHaveBeenCalledWith('id');
  });

  it('stores optional transcript and audio note only when opted in', async () => {
    await issueReportService.submit({
      ...baseInput,
      severity: 'medium',
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

  it('defaults user_id to null when no account id is supplied (defensive fallback)', async () => {
    await issueReportService.submit({
      ...baseInput,
      userId: undefined,
      category: 'something_else',
      severity: 'low',
    });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ user_id: null }));
  });

  it('returns the durable report id captured from the insert', async () => {
    const result = await issueReportService.submit(baseInput);
    expect(result).toEqual({ id: 'report-1' });
  });

  it('triggers the owner alert with ONLY the report id — never any report content', async () => {
    await issueReportService.submit({
      ...baseInput,
      title: 'Secret title leak?',
      description: 'Secret description with an email me@example.com',
      includeTranscript: true,
      transcriptExcerpt: 'secret transcript',
    });

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith('report-issue-alert', { body: { reportId: 'report-1' } });
    // Hard privacy assertion: nothing but reportId crosses to the alert trigger.
    const serialized = JSON.stringify(invoke.mock.calls[0]);
    for (const leak of ['Secret title', 'Secret description', 'me@example.com', 'secret transcript']) {
      expect(serialized).not.toContain(leak);
    }
    expect(invoke.mock.calls[0][1]).toEqual({ body: { reportId: 'report-1' } });
  });

  it('does NOT trigger an alert for an anonymous report (no returnable id) and still succeeds', async () => {
    select.mockResolvedValueOnce({ data: [], error: null }); // RLS returns no row (anon report)
    const result = await issueReportService.submit({ ...baseInput, userId: undefined });
    expect(result).toEqual({ id: null });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('alert-trigger failure never fails submission (fire-and-forget, non-blocking)', async () => {
    invoke.mockRejectedValueOnce(new Error('alert transport down'));
    const result = await issueReportService.submit(baseInput);
    // Submission still resolves successfully with the stored id despite the alert failing.
    expect(result).toEqual({ id: 'report-1' });
    await Promise.resolve(); // flush the fire-and-forget microtask
  });

  it('a database persistence failure throws and never triggers an alert', async () => {
    select.mockResolvedValueOnce({ data: null, error: { message: 'insert failed' } });
    await expect(issueReportService.submit(baseInput)).rejects.toBeTruthy();
    expect(invoke).not.toHaveBeenCalled();
  });
});
