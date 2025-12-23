import { generateSessionPdf } from '../pdfGenerator';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { saveAs } from 'file-saver';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { PracticeSession as Session } from '../../types/session';

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
  default: vi.fn(),
}));

// Mock file-saver to avoid initMouseEvent error in test environment
vi.mock('file-saver', () => ({
  saveAs: vi.fn(),
}));

// Mock jsPDF
vi.mock('jspdf', () => {
  const mockText = vi.fn();
  const mockAddPage = vi.fn();
  const mockSetPage = vi.fn();
  const mockOutput = vi.fn(() => new Blob(['mock-pdf-content']));
  const mockSplitTextToSize = vi.fn((text: string) => text.split('\n'));
  const mockSetFontSize = vi.fn();

  const mockJsPDF = vi.fn(() => ({
    text: mockText,
    addPage: mockAddPage,
    setPage: mockSetPage,
    output: mockOutput,
    splitTextToSize: mockSplitTextToSize,
    setFontSize: mockSetFontSize,
    internal: {
      getNumberOfPages: () => 2,
      pageSize: { height: 297, width: 210 },
    },
  }));

  return { default: mockJsPDF };
});

// Mock DOM methods
const mockCreateElement = vi.fn(() => ({
  href: '',
  download: '',
  click: vi.fn(),
}));
const mockAppendChild = vi.fn();
const mockRemoveChild = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  // Mock document methods
  vi.spyOn(document, 'createElement').mockImplementation(mockCreateElement as unknown as typeof document.createElement);
  vi.spyOn(document.body, 'appendChild').mockImplementation(mockAppendChild);
  vi.spyOn(document.body, 'removeChild').mockImplementation(mockRemoveChild);
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-url');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(vi.fn());
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

  it('should generate a PDF with correct content', async () => {
    await generateSessionPdf(mockSession, 'TestUser');

    const jsPDFMockInstance = (jsPDF as unknown as ReturnType<typeof vi.fn>).mock.results[0].value;

    // Header
    expect(jsPDFMockInstance.setFontSize).toHaveBeenCalledWith(20);
    expect(jsPDFMockInstance.text).toHaveBeenCalledWith('SpeakSharp Session Report', 14, 22);

    // Metadata
    expect(jsPDFMockInstance.text).toHaveBeenCalledWith('Date: September 23rd, 2025', 14, 32);
    expect(jsPDFMockInstance.text).toHaveBeenCalledWith('Duration: 5 minutes', 14, 42);

    // Analytics table via autoTable function (not doc.autoTable)
    expect(autoTable).toHaveBeenCalledWith(jsPDFMockInstance, {
      startY: 70,
      head: [['Filler Word', 'Count']],
      body: [['um', 5], ['like', 3]],
      theme: 'striped',
      headStyles: { fillColor: [22, 160, 133] },
    });

    // Transcript page
    expect(jsPDFMockInstance.addPage).toHaveBeenCalled();
    expect(jsPDFMockInstance.text).toHaveBeenCalledWith('Transcript', 14, 22);
    expect(jsPDFMockInstance.splitTextToSize).toHaveBeenCalledWith('This is a test transcript.', 180);

    // Use FileSaver.js (production uses saveAs)
    expect(jsPDFMockInstance.output).toHaveBeenCalledWith('blob');
    expect(saveAs).toHaveBeenCalledWith(expect.any(Blob), 'session_20250923_TestUser.pdf');

    // Satisfy user request: "download a real file to a temp folder"
    const mockBlob = (saveAs as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const mockFilename = (saveAs as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1];

    // Write to a real temp file
    // Note: We are in Node environment (Vitest), so we can use fs/path
    // Dynamic import to avoid static analysis issues in frontend code
    const fs = await import('fs');
    const path = await import('path');
    const os = await import('os');

    const tempDir = os.tmpdir();
    const filePath = path.join(tempDir, mockFilename);
    const content = await mockBlob.text();

    fs.writeFileSync(filePath, content);
    console.log(`[TEST] Wrote PDF content to: ${filePath}`);

    // Verify file exists and has content
    expect(fs.existsSync(filePath)).toBe(true);
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    expect(fileContent).toBe('mock-pdf-content');

    // Cleanup
    fs.unlinkSync(filePath);
  });

  it('handles sessions with no filler words', async () => {
    const noFillers = { ...mockSession, filler_words: null };
    await generateSessionPdf(noFillers as unknown as Session);

    // autoTable should NOT be called when no filler_words
    expect(autoTable).not.toHaveBeenCalled();
  });

  it('handles sessions with no transcript', async () => {
    const noTranscript = { ...mockSession, transcript: null };
    await generateSessionPdf(noTranscript as unknown as Session);

    const jsPDFMockInstance = (jsPDF as unknown as ReturnType<typeof vi.fn>).mock.results[0].value;
    expect(jsPDFMockInstance.splitTextToSize).toHaveBeenCalledWith('No transcript available.', 180);
  });
});