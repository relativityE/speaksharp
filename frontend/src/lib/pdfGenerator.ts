import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { saveAs } from 'file-saver';
import { PracticeSession as Session } from '../types/session';
import { format, parseISO } from 'date-fns';

// A more specific type for the internal, undocumented API
interface jsPDFInternal {
  getNumberOfPages: () => number;
  pageSize: {
    height: number;
    width: number;
  };
}

import { toast } from 'sonner';

export const generateSessionPdf = async (session: Session, username: string = 'User') => {
  const identifier = username && username !== 'User' ? username : session.user_id;

  try {
    toast.info("Generating PDF...", { id: 'pdf-gen' });
    const doc = new jsPDF();

    // --- Header ---
    doc.setFontSize(20);
    doc.text('SpeakSharp Session Report', 14, 22);

    // --- Session Metadata ---
    doc.setFontSize(12);
    try {
      const sessionDate = format(parseISO(session.created_at), 'MMMM do, yyyy');
      doc.text(`Date: ${sessionDate}`, 14, 32);
    } catch (e) {
      doc.text(`Date: ${session.created_at}`, 14, 32);
    }
    doc.text(`Duration: ${Math.round(session.duration / 60)} minutes`, 14, 42);

    // --- Analytics ---
    doc.setFontSize(16);
    doc.text('Vocal Analytics', 14, 60);

    const analyticsData = [
      ['Metric', 'Value'],
      ['Speaking Pace (WPM)', session.wpm?.toString() || 'N/A'],
      ['Silence Percentage', session.pause_metrics?.silencePercentage ? `${session.pause_metrics.silencePercentage.toFixed(1)}%` : 'N/A'],
      ['Short Pauses (0.5-1.5s)', session.pause_metrics?.transitionPauses?.toString() || '0'],
      ['Long Pauses (>1.5s)', session.pause_metrics?.extendedPauses?.toString() || '0'],
      ['Longest Pause', session.pause_metrics?.longestPause ? `${session.pause_metrics.longestPause.toFixed(1)}s` : 'N/A'],
    ];

    autoTable(doc, {
      startY: 70,
      body: analyticsData,
      theme: 'striped',
      headStyles: { fillColor: [41, 128, 185] },
    });

    if (session.filler_words) {
      const tableData = Object.entries(session.filler_words).map(([word, data]) => [word, data.count]);
      autoTable(doc, {
        startY: (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10,
        head: [['Filler Word', 'Frequency']],
        body: tableData,
        theme: 'striped',
        headStyles: { fillColor: [22, 160, 133] },
      });
    }

    // --- Transcript ---
    doc.addPage();
    doc.setFontSize(16);
    doc.text('Transcript', 14, 22);
    doc.setFontSize(10);
    const transcriptLines = doc.splitTextToSize(session.transcript || 'No transcript available.', 180);
    doc.text(transcriptLines, 14, 32);

    // --- Footer ---
    const pageCount = (doc.internal as unknown as jsPDFInternal).getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(10);
      doc.text(`Page ${i} of ${pageCount}`, 14, doc.internal.pageSize.height - 10);
    }

    // Use a friendly filename: session_date_identifier.pdf
    const dateStr = format(parseISO(session.created_at), 'yyyyMMdd');
    const sanitizedIdentifier = identifier.replace(/[^a-zA-Z0-9]/g, '_');
    const filename = `session_${dateStr}_${sanitizedIdentifier}.pdf`;

    toast.info(`Saving as: ${filename}`, { id: 'pdf-gen-name' });

    // Use FileSaver.js (industry standard) for reliable cross-browser download
    const blob = doc.output('blob');
    saveAs(blob, filename);

    toast.success("PDF Downloaded!", { id: 'pdf-gen' });
  } catch (error: unknown) {
    console.error('[pdfGenerator] Error in PDF generation:', error);
    console.error('[pdfGenerator] Error details:', {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      sessionId: session.id
    });
    toast.error('Failed to generate PDF report. Please try again.', { id: 'pdf-gen' });
  }
};

