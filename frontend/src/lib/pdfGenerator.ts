import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { PracticeSession as Session } from '../types/session';
import { format, parseISO } from 'date-fns';
// import { processImage } from './processImage';

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
    doc.text('Analytics', 14, 60);

    if (session.filler_words) {
      const tableData = Object.entries(session.filler_words).map(([word, data]) => [word, data.count]);
      autoTable(doc, {
        startY: 70,
        head: [['Filler Word', 'Count']],
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

    // --- Image Example (Skipped: Buffer not available in browser) ---
    /*
    try {
       // Buffer logic removed to prevent crash.
    } catch (error) {
      console.error('Error processing image:', error);
    }
    */

    // --- Footer ---
    const pageCount = (doc.internal as unknown as jsPDFInternal).getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(10);
      doc.text(`Page ${i} of ${pageCount}`, 14, doc.internal.pageSize.height - 10);
    }

    // Use a friendly filename: session_date_username.pdf
    const dateStr = format(parseISO(session.created_at), 'yyyyMMdd');
    const sanitizedUser = username.replace(/[^a-zA-Z0-9]/g, '_');
    const filename = `session_${dateStr}_${sanitizedUser}.pdf`;

    // Debug: Force alert removed
    // alert(`Debug: Saving PDF as ${filename}`);
    toast.info(`Saving as: ${filename}`, { id: 'pdf-gen-name' });

    // Force manual download to ensure filename is respected
    const blob = doc.output('blob');
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    toast.success("PDF Downloaded!", { id: 'pdf-gen' });
  } catch (error: unknown) {
    console.error('Error in PDF generation:', error);
    toast.error('Failed to generate PDF report. Please try again.', { id: 'pdf-gen' });
  }
};
