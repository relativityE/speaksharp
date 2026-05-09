import { generateSessionPdf } from '../pdfGenerator';
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
      body: expect.arrayContaining([['Metric', 'Value']])
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
    expect(savedPdf.filename).toContain('session_20250923');
  });

  it('excludes synthetic total filler rows and preserves zero pause metrics', async () => {
    await generateSessionPdf({
      ...mockSession,
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

  it('handles sessions with no transcript', async () => {
    const noTranscript = { ...mockSession, transcript: null };
    await generateSessionPdf(noTranscript as unknown as Session);
    const savedPdf = await getSavedPdf();

    expect(savedPdf.text).toContain('(Transcript) Tj');
    expect(savedPdf.text).toContain('(No transcript available.) Tj');
  });

  it.each([
    ['Free', false],
    ['Pro', true],
  ])('adds the SpeakSharp watermark to every generated page for %s exports', async (_tier, isPro) => {
    await generateSessionPdf(mockSession, 'TestUser', isPro);
    const savedPdf = await getSavedPdf();

    const watermarkCommands = savedPdf.text.match(/\(Generated by SpeakSharp\) Tj/g) ?? [];
    expect(watermarkCommands).toHaveLength(2);
    expect(document.body).toHaveAttribute('data-pdf-token', 'watermarked');
  });
});
