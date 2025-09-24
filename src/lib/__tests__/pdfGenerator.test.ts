import { generateSessionPdf } from '../pdfGenerator';
import jsPDF from 'jspdf';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { PracticeSession as Session } from '../../types/session';

// Mock jimp to avoid image processing errors
vi.mock('jimp', () => ({
  default: {
    read: vi.fn().mockResolvedValue({
      resize: vi.fn().mockReturnThis(),
      getBufferAsync: vi.fn().mockResolvedValue(Buffer.from('')),
    }),
  },
}));

// Mock jsPDF with proper types
vi.mock('jspdf', () => {
  const mockAutoTable = vi.fn();
  const mockText = vi.fn();
  const mockAddPage = vi.fn();
  const mockSetPage = vi.fn();
  const mockSave = vi.fn();
  const mockSplitTextToSize = vi.fn((text: string) => text.split('\n'));
  const mockSetFontSize = vi.fn();

  const mockJsPDF = vi.fn(() => ({
    autoTable: mockAutoTable,
    text: mockText,
    addPage: mockAddPage,
    setPage: mockSetPage,
    save: mockSave,
    splitTextToSize: mockSplitTextToSize,
    setFontSize: mockSetFontSize,
    internal: {
      getNumberOfPages: () => 2,
      pageSize: { height: 297, width: 210 },
    },
  }));

  return { default: mockJsPDF };
});

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

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should generate a PDF with correct content', async () => {
    await generateSessionPdf(mockSession);

    // Properly typed mock instance
    const jsPDFMockInstance = (jsPDF as unknown as ReturnType<typeof vi.fn>).mock.results[0].value;

    // Header
    expect(jsPDFMockInstance.setFontSize).toHaveBeenCalledWith(20);
    expect(jsPDFMockInstance.text).toHaveBeenCalledWith('SpeakSharp Session Report', 14, 22);

    // Metadata
    expect(jsPDFMockInstance.setFontSize).toHaveBeenCalledWith(12);
    expect(jsPDFMockInstance.text).toHaveBeenCalledWith('Date: September 23rd, 2025', 14, 32);
    expect(jsPDFMockInstance.text).toHaveBeenCalledWith('Duration: 5 minutes', 14, 42);

    // Analytics table
    expect(jsPDFMockInstance.autoTable).toHaveBeenCalledWith({
      startY: 70,
      head: [['Filler Word', 'Count']],
      body: [['um', 5], ['like', 3]],
      theme: 'striped',
      headStyles: { fillColor: [22, 160, 133] },
    });

    // Transcript
    expect(jsPDFMockInstance.addPage).toHaveBeenCalled();
    expect(jsPDFMockInstance.text).toHaveBeenCalledWith('Transcript', 14, 22);
    expect(jsPDFMockInstance.splitTextToSize).toHaveBeenCalledWith('This is a test transcript.', 180);
    expect(jsPDFMockInstance.text).toHaveBeenCalledWith(['This is a test transcript.'], 14, 32);

    // Footer
    expect(jsPDFMockInstance.setPage).toHaveBeenCalledTimes(2);
    expect(jsPDFMockInstance.text).toHaveBeenCalledWith('Page 1 of 2', 14, 287);
    expect(jsPDFMockInstance.text).toHaveBeenCalledWith('Page 2 of 2', 14, 287);

    // Save
    expect(jsPDFMockInstance.save).toHaveBeenCalledWith('SpeakSharp-Session-123.pdf');
  });

  it('handles sessions with no filler words', async () => {
    const noFillers = { ...mockSession, filler_words: null };
    await generateSessionPdf(noFillers as unknown as Session);

    const jsPDFMockInstance = (jsPDF as unknown as ReturnType<typeof vi.fn>).mock.results[0].value;
    expect(jsPDFMockInstance.autoTable).not.toHaveBeenCalled();
  });

  it('handles sessions with no transcript', async () => {
    const noTranscript = { ...mockSession, transcript: null };
    await generateSessionPdf(noTranscript as unknown as Session);

    const jsPDFMockInstance = (jsPDF as unknown as ReturnType<typeof vi.fn>).mock.results[0].value;
    expect(jsPDFMockInstance.splitTextToSize).toHaveBeenCalledWith('No transcript available.', 180);
  });
});