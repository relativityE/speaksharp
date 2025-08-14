import jsPDF from 'jspdf';
import 'jspdf-autotable'; // Extension for creating tables

export const generatePdfReport = (session) => {
  const doc = new jsPDF();

  // 1. Add Title
  doc.setFontSize(22);
  doc.text('SpeakSharp Session Report', 14, 20);

  // 2. Add Session Metadata
  doc.setFontSize(12);
  doc.text(`Date: ${new Date(session.created_at).toLocaleDateString()}`, 14, 30);
  doc.text(`Duration: ${(session.duration / 60).toFixed(1)} minutes`, 14, 37);

  // 3. Add Filler Word Summary Table
  const fillerData = session.filler_words || {};
  const tableColumn = ["Filler Word", "Count"];
  const tableRows = [];

  Object.entries(fillerData).forEach(([key, value]) => {
    const row = [key, value.count || 0];
    tableRows.push(row);
  });

  doc.autoTable({
    head: [tableColumn],
    body: tableRows,
    startY: 45,
    theme: 'striped',
    headStyles: { fillColor: [22, 163, 74] }, // Green color for header
  });

  // 4. Add Transcript
  doc.addPage();
  doc.setFontSize(16);
  doc.text('Session Transcript', 14, 20);
  doc.setFontSize(10);

  // Use splitTextToSize to handle long text and wrapping
  const transcript = session.browser_transcript || session.cloud_transcript || 'No transcript available.';
  const lines = doc.splitTextToSize(transcript, 180); // 180 is the max width
  doc.text(lines, 14, 30);

  // 5. Save the PDF
  doc.save(`SpeakSharp-Report-${new Date(session.created_at).toISOString().split('T')[0]}.pdf`);
};
