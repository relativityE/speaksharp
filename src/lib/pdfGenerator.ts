import jsPDF from 'jspdf';
import 'jspdf-autotable';
import { PracticeSession as Session } from '../types/session';
import { format, parseISO } from 'date-fns';
import { processImage } from './processImage';

// Extend jsPDF with autoTable
interface jsPDFWithAutoTable extends jsPDF {
  autoTable: (options: any) => jsPDF;
}

export const generateSessionPdf = async (session: Session) => {
  const doc = new jsPDF() as jsPDFWithAutoTable;

  // --- Header ---
  doc.setFontSize(20);
  doc.text('SpeakSharp Session Report', 14, 22);

  // --- Session Metadata ---
  doc.setFontSize(12);
  const sessionDate = format(parseISO(session.created_at), 'MMMM do, yyyy');
  doc.text(`Date: ${sessionDate}`, 14, 32);
  doc.text(`Duration: ${Math.round(session.duration / 60)} minutes`, 14, 42);

  // --- Analytics ---
  doc.setFontSize(16);
  doc.text('Analytics', 14, 60);

  if (session.filler_words) {
    const tableData = Object.entries(session.filler_words).map(([word, count]) => [word, count]);
    doc.autoTable({
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

  // --- Image Example ---
  try {
    const imageBuffer = Buffer.from('...'); // Replace with actual image buffer
    await processImage(imageBuffer, 200, 200);

    // const base64Image = `data:image/png;base64,${processedImage.toString('base64')}`;
    // doc.addImage(base64Image, 'PNG', 15, 40, 50, 50);
  } catch (error) {
    console.error('Error processing image:', error);
  }

  // --- Footer ---
  const pageCount = (doc.internal as any).getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(10);
    doc.text(`Page ${i} of ${pageCount}`, 14, doc.internal.pageSize.height - 10);
  }

  doc.save(`SpeakSharp-Session-${session.id}.pdf`);
};
