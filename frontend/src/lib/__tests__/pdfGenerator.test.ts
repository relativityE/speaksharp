import { generateSessionPdf, getSessionPdfFilename } from '../pdfGenerator';
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
        ['Clarity Score', '0% (Keep practicing)'],
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

  it('derives filler table data from transcript when saved filler metrics are stale zeros', async () => {
    await generateSessionPdf({
      ...mockSession,
      transcript: "So this is a test. Yeah, so it is highlighting filler words.",
      filler_words: {
        so: { count: 0 },
        like: { count: 0 },
        total: { count: 0 },
      },
    } as unknown as Session);

    expect(autoTable).toHaveBeenNthCalledWith(2, expect.anything(), expect.objectContaining({
      head: [['Filler Word', 'Frequency']],
      body: [['so', 2]],
    }));
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
    expect(savedPdf.text).toContain('(No transcript available.) Tj');
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

    expect(savedPdf.text).toContain('(AI-Powered Suggestions) Tj');
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
