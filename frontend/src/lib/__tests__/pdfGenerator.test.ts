import { generateSessionPdf, getSessionPdfFilename, getPdfFillerTableData } from '../pdfGenerator';
import autoTable from 'jspdf-autotable';
import { saveAs } from 'file-saver';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PracticeSession as Session } from '../../types/session';

vi.mock('jspdf', async (importOriginal) => {
  return await importOriginal<typeof import('jspdf')>();
});

// Mock toast
vi.mock('sonner', () => ({
  toast: {
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock jspdf-autotable as a separate function (production uses autoTable(doc, ...) not doc.autoTable)
vi.mock('jspdf-autotable', () => ({
  default: vi.fn((doc: unknown) => {
    // Add lastAutoTable property to match internal autoTable behavior
    (doc as { lastAutoTable?: { finalY: number } }).lastAutoTable = { finalY: 100 };
  }),
}));

// Mock file-saver to avoid initMouseEvent error in test environment
vi.mock('file-saver', () => ({
  saveAs: vi.fn(),
}));

// Mock DOM methods
const mockCreateElement = vi.fn(() => ({
  href: '',
  download: '',
  click: vi.fn(),
}));
const mockAppendChild = vi.fn();
const mockRemoveChild = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  // Mock document methods
  vi.spyOn(document, 'createElement').mockImplementation(mockCreateElement as unknown as typeof document.createElement);
  vi.spyOn(document.body, 'appendChild').mockImplementation(mockAppendChild);
  vi.spyOn(document.body, 'removeChild').mockImplementation(mockRemoveChild);
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-url');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(vi.fn());
});

afterEach(() => {
  vi.useRealTimers();
});

const getSavedPdf = async () => {
  const saveAsCalls = vi.mocked(saveAs).mock.calls;
  const savedPdf = saveAsCalls[saveAsCalls.length - 1];
  expect(savedPdf).toBeDefined();
  const [blob, filename] = savedPdf as [Blob, string];

  return {
    filename,
    text: await blob.text(),
  };
};

describe('generateSessionPdf', () => {
  const mockSession: Session = {
    id: '123',
    user_id: 'user1',
    created_at: '2025-09-23T10:00:00Z',
    duration: 300,
    transcript: 'This is a test transcript.',
    filler_words: { um: { count: 5 }, like: { count: 3 } },
    accuracy: 95,
  };

  it('should generate a PDF with correct content', async () => {
    await generateSessionPdf(mockSession, 'TestUser');
    const savedPdf = await getSavedPdf();

    // Verify first call: Vocal Analytics
    expect(autoTable).toHaveBeenNthCalledWith(1, expect.anything(), expect.objectContaining({
      startY: 70,
      body: expect.arrayContaining([
        ['Metric', 'Value'],
        ['Session ID', '123'],
        ['Total Words', '5'],
        ['Speaking Pace (WPM)', '1 (Too Slow)'],
        ['Clear Delivery', '0% (Keep practicing)'],
        ['Total Filler Words', '8'],
        ['Tracked Custom Words', 'None'],
        ['Custom Words Detected', '0'],
        ['Transcription Mode', 'Not recorded'],
        ['Engine Details', 'Not recorded'],
      ])
    }));

    // Verify second call: Filler words table
    expect(autoTable).toHaveBeenNthCalledWith(2, expect.anything(), expect.objectContaining({
      head: [['Filler Word', 'Frequency']],
      body: [['um', 5], ['like', 3]]
    }));

    // Verify actual generated PDF text commands, not only DOM/export signals.
    expect(savedPdf.text).toContain('(SpeakSharp Session Report) Tj');
    expect(savedPdf.text).toContain('(Date: September 23rd, 2025) Tj');
    expect(savedPdf.text).toContain('(Duration: 5 minutes) Tj');
    expect(savedPdf.text).toContain('(Transcript) Tj');
    expect(savedPdf.text).toContain('(This is a test transcript.) Tj');
    expect(savedPdf.filename).toBe('TestUser_session_0_20250923.pdf');
  });

  it('names same-day sessions by user, session number, and date', () => {
    const firstSession = {
      ...mockSession,
      id: 'session-a',
      created_at: '2025-09-23T09:00:00Z',
    };
    const secondSession = {
      ...mockSession,
      id: 'session-b',
      created_at: '2025-09-23T10:00:00Z',
    };
    const nextDaySession = {
      ...mockSession,
      id: 'session-c',
      created_at: '2025-09-24T10:00:00Z',
    };

    expect(getSessionPdfFilename(firstSession, 'speaker@example.com', [firstSession, secondSession, nextDaySession]))
      .toBe('speaker_example_com_session_0_20250923.pdf');
    expect(getSessionPdfFilename(secondSession, 'speaker@example.com', [firstSession, secondSession, nextDaySession]))
      .toBe('speaker_example_com_session_1_20250923.pdf');
    expect(getSessionPdfFilename(nextDaySession, 'speaker@example.com', [firstSession, secondSession, nextDaySession]))
      .toBe('speaker_example_com_session_0_20250924.pdf');
  });

  it('formats short session durations in seconds instead of rounding to 0 minutes', async () => {
    await generateSessionPdf({
      ...mockSession,
      duration: 14,
    });
    const savedPdf = await getSavedPdf();

    expect(savedPdf.text).toContain('(Duration: 14 seconds) Tj');
  });

  it('excludes synthetic total filler rows and preserves zero pause metrics', async () => {
    await generateSessionPdf({
      ...mockSession,
      engine: 'private',
      model_name: 'whisper-tiny.en',
      engine_version: 'transformers-js-2.17',
      device_type: 'cpu',
      filler_words: {
        um: { count: 2 },
        like: { count: 3 },
        total: { count: 5 },
      },
      pause_metrics: {
        silencePercentage: 0,
        transitionPauses: 0,
        extendedPauses: 0,
        longestPause: 0,
      },
    } as unknown as Session);

    expect(autoTable).toHaveBeenNthCalledWith(1, expect.anything(), expect.objectContaining({
      body: expect.arrayContaining([
        ['Transcription Mode', 'Private'],
        ['Silence Percentage', '0.0%'],
        ['Short Pauses (0.5-1.5s)', '0'],
        ['Long Pauses (>1.5s)', '0'],
        ['Longest Pause', '0.0s'],
      ])
    }));

    expect(autoTable).toHaveBeenNthCalledWith(2, expect.anything(), expect.objectContaining({
      body: [['um', 2], ['like', 3]]
    }));
  });

  it('handles sessions with no filler words', async () => {
    const noFillers = { ...mockSession, filler_words: null };
    await generateSessionPdf(noFillers as unknown as Session);

    // autoTable should be called ONCE for analytics even when no filler_words
    expect(autoTable).toHaveBeenCalledTimes(1);
    expect(autoTable).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      body: expect.arrayContaining([['Metric', 'Value']])
    }));
  });

  it('SSOT: a valid persisted filler ZERO renders NO filler table (does not recount stale zeros from transcript)', async () => {
    await generateSessionPdf({
      ...mockSession,
      transcript: "So this is a test. Yeah, so it is highlighting filler words.",
      filler_words: {
        so: { count: 0 },
        like: { count: 0 },
        total: { count: 0 },
      }, // canonical live zero — must NOT be recounted up from the transcript
    } as unknown as Session);

    // No autoTable call carries a "Filler Word" head, because the canonical zero yields no filler rows.
    const fillerTableRendered = vi.mocked(autoTable).mock.calls.some(
      ([, opts]) => JSON.stringify((opts as { head?: unknown })?.head ?? null).includes('Filler Word'),
    );
    expect(fillerTableRendered).toBe(false);
  });

  it('includes custom-word analytics in the PDF report', async () => {
    await generateSessionPdf({
      ...mockSession,
      transcript: 'Um, the stale smell of old beer lingers.',
      duration: 10,
      custom_words: {
        stale: { count: 1 },
      },
      filler_words: {
        stale: { count: 1 },
        um: { count: 1 },
        total: { count: 2 },
      },
    } as unknown as Session);

    expect(autoTable).toHaveBeenNthCalledWith(1, expect.anything(), expect.objectContaining({
      body: expect.arrayContaining([
        ['Tracked Custom Words', 'stale'],
        ['Custom Words Detected', '1'],
        ['Total Filler Words', '2'],
      ]),
    }));

    expect(autoTable).toHaveBeenNthCalledWith(2, expect.anything(), expect.objectContaining({
      head: [['Filler Word', 'Frequency']],
      body: expect.arrayContaining([['stale', 1], ['um', 1]]),
    }));
  });

  it('handles sessions with no transcript', async () => {
    const noTranscript = { ...mockSession, transcript: null };
    await generateSessionPdf(noTranscript as unknown as Session);
    const savedPdf = await getSavedPdf();

    expect(savedPdf.text).toContain('(Transcript) Tj');
    // #1047 PR-U1: a transcript-less row now reads the honest not-captured reason, not the old ambiguous
    // "No transcript available." (no server transcript_state → derived not_captured).
    expect(savedPdf.text).toContain('(No transcript was captured.) Tj');
  });

  it('paginates long transcripts instead of drawing them off the page', async () => {
    const longTranscript = Array.from({ length: 180 }, (_, index) => `Line ${index + 1} of the transcript.`).join('\n');

    await generateSessionPdf({
      ...mockSession,
      transcript: longTranscript,
    });
    const savedPdf = await getSavedPdf();

    expect(savedPdf.text).toContain('(Line 1 of the transcript.) Tj');
    expect(savedPdf.text).toContain('(Line 180 of the transcript.) Tj');
    expect(savedPdf.text).toContain('(Page 4 of');
  });

  it('includes AI suggestions when they exist on the session', async () => {
    await generateSessionPdf({
      ...mockSession,
      ai_suggestions: {
        summary: 'You used a clear opening and can improve pacing.',
        suggestions: [
          {
            title: 'Pause with intent',
            description: 'Replace filler words with a short pause before the next idea.',
          },
        ],
      },
    });
    const savedPdf = await getSavedPdf();

    expect(savedPdf.text).toContain('(AI Coaching Suggestions) Tj');
    expect(savedPdf.text).toContain('(You used a clear opening and can improve pacing.) Tj');
    expect(savedPdf.text).toContain('(1. Pause with intent) Tj');
  });

  it.each([
    ['Free', false],
    ['Pro', true],
  ])('adds the SpeakSharp watermark to every generated page for %s exports', async (_tier, isPro) => {
    await generateSessionPdf(mockSession, 'TestUser', isPro);
    const savedPdf = await getSavedPdf();

    const visibleWatermarkCommands = savedPdf.text.match(/\(SpeakSharp\) Tj/g) ?? [];
    expect(visibleWatermarkCommands.length).toBeGreaterThanOrEqual(8);
    expect(savedPdf.text).not.toContain('(Generated by SpeakSharp) Tj');
    expect(document.body).toHaveAttribute('data-pdf-token', 'watermarked');
  });
});

describe('getPdfFillerTableData — SSOT: persisted canonical wins, no recount of a valid zero', () => {
  const base = {
    id: 's', user_id: 'u', created_at: '', updated_at: '', title: 't', duration: 60,
  } as unknown as Session;

  it('valid persisted ZERO renders NO filler rows (does NOT recount the transcript)', () => {
    const rows = getPdfFillerTableData({
      ...base,
      transcript: 'um uh like the transcript clearly contains fillers here',
      filler_words: { total: { count: 0, color: '' } }, // canonical live zero
    } as unknown as Session);
    expect(rows).toEqual([]); // not recounted up from the transcript
  });

  it('persisted fillers are rendered from the saved canonical data', () => {
    const rows = getPdfFillerTableData({
      ...base,
      transcript: 'whatever the transcript says',
      filler_words: { total: { count: 3, color: '' }, um: { count: 3, color: '' } },
    } as unknown as Session);
    expect(rows).toEqual([['um', 3]]);
  });

  it('recounts the transcript ONLY when persisted filler data is absent/malformed', () => {
    const rows = getPdfFillerTableData({
      ...base,
      transcript: 'um and uh are here',
      filler_words: null, // absent → fallback recount
    } as unknown as Session);
    expect(rows.length).toBeGreaterThan(0);
  });

  it('(#1047) a not_captured session yields NO filler table even with a stale/sentinel filler map', () => {
    const rows = getPdfFillerTableData({
      ...base,
      transcript: '',
      transcript_state: 'not_captured',
      filler_words: { total: { count: 0, color: '' }, um: { count: 4, color: '' } }, // stale sentinel data
    } as unknown as Session);
    expect(rows).toEqual([]); // provenance gate: not_captured never renders a filler table
  });

  it('(#1047) an expired session without persisted filler evidence yields NO filler table', () => {
    const rows = getPdfFillerTableData({
      ...base, transcript: null, transcript_state: 'expired', filler_words: {},
    } as unknown as Session);
    expect(rows).toEqual([]);
  });

  it('(#1047) an expired session WITH genuinely persisted filler evidence still renders it', () => {
    const rows = getPdfFillerTableData({
      ...base, transcript: null, transcript_state: 'expired',
      filler_words: { total: { count: 2, color: '' }, um: { count: 2, color: '' } },
    } as unknown as Session);
    expect(rows).toEqual([['um', 2]]); // expired keeps its genuinely-persisted measurements
  });

  // #1047 PR-U1: the PDF must print the honest transcript-state reason, never an ordinary empty transcript
  // and never the removed text. Self-contained session (this describe is outside mockSession's scope).
  const u1Session = (over: Partial<Session>): Session => ({
    id: 'u1', user_id: 'user1', created_at: '2025-09-23T10:00:00Z', duration: 300,
    filler_words: { um: { count: 1 } }, accuracy: 90, ...over,
  } as unknown as Session);

  it('prints the expired reason and NOT the removed transcript text when transcript_state is expired', async () => {
    await generateSessionPdf(u1Session({ transcript: 'the real spoken words', transcript_state: 'expired' }), 'TestUser');
    const savedPdf = await getSavedPdf();
    expect(savedPdf.text).toContain('(Transcript expired. Your measurements are still available.) Tj');
    expect(savedPdf.text).not.toContain('(the real spoken words) Tj'); // removed text never printed
  });

  it('prints the not-captured reason when transcript_state is not_captured', async () => {
    await generateSessionPdf(u1Session({ transcript: '', transcript_state: 'not_captured' }), 'TestUser');
    const savedPdf = await getSavedPdf();
    expect(savedPdf.text).toContain('(No transcript was captured.) Tj');
    expect(savedPdf.text).not.toContain('(No transcript available.) Tj'); // the old ambiguous fallback is gone
  });

  it('renders transcript-derived metrics as N/A (never measured zero) for an expired row with no persisted evidence', async () => {
    await generateSessionPdf(
      u1Session({ transcript: null, transcript_state: 'expired', filler_words: undefined }) as Session,
      'TestUser',
    );
    // The Vocal Analytics table is the first autoTable call; transcript-derived cells are N/A, not 0.
    expect(autoTable).toHaveBeenNthCalledWith(1, expect.anything(), expect.objectContaining({
      body: expect.arrayContaining([
        ['Total Words', 'N/A'],
        ['Total Filler Words', 'N/A'],
      ]),
    }));
  });

  it('still shows persisted measurements for an expired row (measurements survive transcript loss)', async () => {
    await generateSessionPdf(
      u1Session({ transcript: null, transcript_state: 'expired', total_words: 120, filler_words: { um: { count: 2 } } }) as Session,
      'TestUser',
    );
    expect(autoTable).toHaveBeenNthCalledWith(1, expect.anything(), expect.objectContaining({
      body: expect.arrayContaining([
        ['Total Words', '120'],
      ]),
    }));
  });

  it('treats a not_captured sentinel (total_words:0, filler_words:{}) as N/A and suppresses score/coaching', async () => {
    await generateSessionPdf(
      u1Session({ transcript: '', transcript_state: 'not_captured', total_words: 0, filler_words: {} }) as Session,
      'TestUser',
    );
    // The schema-default 0 / empty filler map are sentinels, not measurements → N/A, and the
    // transcript-dependent score/coaching are not recomputed from absent text.
    expect(autoTable).toHaveBeenNthCalledWith(1, expect.anything(), expect.objectContaining({
      body: expect.arrayContaining([
        ['Total Words', 'N/A'],
        ['Total Filler Words', 'N/A'],
        ['SpeakSharp Score', 'N/A'],
        ['Coaching Suggestion', 'N/A'],
      ]),
    }));
  });
});
