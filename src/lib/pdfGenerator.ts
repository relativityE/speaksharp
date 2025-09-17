import jsPDF from 'jspdf';
import 'jspdf-autotable';
import type { PracticeSession } from '../types/session';

// Extend the jsPDF interface to include the autoTable plugin's property
interface jsPDFWithAutoTable extends jsPDF {
  lastAutoTable: {
    finalY: number;
  };
  autoTable: (options: any) => jsPDF;
}

export const generateSessionPdf = (session: PracticeSession) => {
    const doc = new jsPDF() as jsPDFWithAutoTable;

    // 1. Add Header
    doc.setFontSize(20);
    doc.text(session.title || 'Practice Session Report', 14, 22);
    doc.setFontSize(12);
    doc.text(`Date: ${new Date(session.created_at).toLocaleString()}`, 14, 30);

    // 2. Add Summary Stats in a Table
    const summaryData = [
        ['Duration', `${(session.duration / 60).toFixed(1)} minutes`],
        ['Total Words', session.total_words || 'N/A'],
    ];
    doc.autoTable({
        startY: 40,
        head: [['Metric', 'Value']],
        body: summaryData,
        theme: 'striped',
        headStyles: { fillColor: [41, 128, 185] },
    });

    // 3. Add Filler Word Details Table
    const fillerWordData = Object.entries(session.filler_words || {}).map(([word, data]) => [
        word,
        data.count,
    ]);

    if (fillerWordData.length > 0) {
        doc.autoTable({
            startY: doc.lastAutoTable.finalY + 10,
            head: [['Filler Word', 'Count']],
            body: fillerWordData,
            theme: 'grid',
        });
    }

    // 4. Add Full Transcript
    doc.setFontSize(14);
    doc.text('Full Transcript', 14, doc.lastAutoTable.finalY + 20);
    doc.setFontSize(10);

    // Use splitTextToSize to handle long text and wrapping
    const transcriptLines = doc.splitTextToSize(session.transcript || 'No transcript available.', 180);
    doc.text(transcriptLines, 14, doc.lastAutoTable.finalY + 30);


    // 5. Save the PDF
    doc.save(`SpeakSharp_Session_${session.id}.pdf`);
};
