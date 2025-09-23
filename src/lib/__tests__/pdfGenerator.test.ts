import { generateSessionPdf } from '../pdfGenerator';
import jsPDF from 'jspdf';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { PracticeSession as Session } from '../../types/session';

// Mock the jsPDF library
vi.mock('jspdf', () => {
  const mockAutoTable = vi.fn();
  const mockText = vi.fn();
  const mockAddPage = vi.fn();
  const mockSetPage = vi.fn();
  const mockSave = vi.fn();
  const mockSplitTextToSize = vi.fn((text) => text.split('\n'));
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
      pageSize: {
        height: 297,
        width: 210,
      },
    },
  }));

  return {
    default: mockJsPDF,
  };
});

describe('generateSessionPdf', () => {
  const mockSession: Session = {
    id: '123',
    user_id: 'user1',
    created_at: '2025-09-23T10:00:00Z',
    duration: 300,
    transcript: 'This is a test transcript.',
    filler_words: {
      'um': { count: 5 },
      'like': { count: 3 },
    },
    wpm: 120,
    accuracy: 95,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should generate a PDF with the correct content and structure', async () => {
    await generateSessionPdf(mockSession);

    const jsPDFInstance = (jsPDF as any).mock.results[0].value;

    // Check header
    expect(jsPDFInstance.setFontSize).toHaveBeenCalledWith(20);
    expect(jsPDFInstance.text).toHaveBeenCalledWith('SpeakSharp Session Report', 14, 22);

    // Check metadata
    expect(jsPDFInstance.setFontSize).toHaveBeenCalledWith(12);
    expect(jsPDFInstance.text).toHaveBeenCalledWith('Date: September 23rd, 2025', 14, 32);
    expect(jsPDFInstance.text).toHaveBeenCalledWith('Duration: 5 minutes', 14, 42);

    // Check analytics table
    expect(jsPDFInstance.autoTable).toHaveBeenCalledWith({
      startY: 70,
      head: [['Filler Word', 'Count']],
      body: [['um', 5], ['like', 3]],
      theme: 'striped',
      headStyles: { fillColor: [22, 160, 133] },
    });

    // Check transcript
    expect(jsPDFInstance.addPage).toHaveBeenCalled();
    expect(jsPDFInstance.text).toHaveBeenCalledWith('Transcript', 14, 22);
    expect(jsPDFInstance.splitTextToSize).toHaveBeenCalledWith('This is a test transcript.', 180);
    expect(jsPDFInstance.text).toHaveBeenCalledWith(['This is a test transcript.'], 14, 32);

    // Check footer
    expect(jsPDFInstance.setPage).toHaveBeenCalledTimes(2);
    expect(jsPDFInstance.text).toHaveBeenCalledWith('Page 1 of 2', 14, 287);
    expect(jsPDFInstance.text).toHaveBeenCalledWith('Page 2 of 2', 14, 287);

    // Check save
    expect(jsPDFInstance.save).toHaveBeenCalledWith('SpeakSharp-Session-123.pdf');
  });

  it('should handle sessions with no filler words', async () => {
    const sessionWithoutFillers = { ...mockSession, filler_words: null };
    await generateSessionPdf(sessionWithoutFillers as any);

    const jsPDFInstance = (jsPDF as any).mock.results[0].value;
    expect(jsPDFInstance.autoTable).not.toHaveBeenCalled();
  });

  it('should handle sessions with no transcript', async () => {
    const sessionWithoutTranscript = { ...mockSession, transcript: null };
    await generateSessionPdf(sessionWithoutTranscript as any);

    const jsPDFInstance = (jsPDF as any).mock.results[0].value;
    expect(jsPDFInstance.splitTextToSize).toHaveBeenCalledWith('No transcript available.', 180);
  });
});
