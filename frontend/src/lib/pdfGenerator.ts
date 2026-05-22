import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { saveAs } from 'file-saver';
import { PracticeSession as Session } from '../types/session';
import { format, parseISO } from 'date-fns';
import logger from './logger';
import { formatSessionRecordingMode } from '@/utils/engineLabels';
import { countFillerWords } from '@/utils/fillerWordUtils';
import { getSessionAnalysisMetrics } from '@/utils/sessionAnalysis';

// A more specific type for the internal, undocumented API
interface jsPDFInternal {
  getNumberOfPages: () => number;
  pageSize: {
    height: number;
    width: number;
  };
}

import { toast } from '@/lib/toast';

const PDF_WATERMARK_TEXT = 'SpeakSharp';

const formatOptionalNumber = (value: number | null | undefined, formatter: (value: number) => string, fallback = 'N/A') =>
  typeof value === 'number' ? formatter(value) : fallback;

const getFillerTableData = (fillerWords: Session['filler_words']) =>
  Object.entries(fillerWords || {})
    .filter(([word]) => word !== 'total')
    .filter(([, data]) => data.count > 0)
    .map(([word, data]) => [word, data.count]);

const formatDuration = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0 seconds';

  const roundedSeconds = Math.round(seconds);
  const minutes = Math.floor(roundedSeconds / 60);
  const remainingSeconds = roundedSeconds % 60;

  if (minutes === 0) return `${remainingSeconds} second${remainingSeconds === 1 ? '' : 's'}`;
  if (remainingSeconds === 0) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  return `${minutes} minute${minutes === 1 ? '' : 's'} ${remainingSeconds} second${remainingSeconds === 1 ? '' : 's'}`;
};

const getPdfFillerTableData = (session: Session): Array<[string, number]> => {
  const savedTableData = getFillerTableData(session.filler_words);
  if (savedTableData.length > 0) return savedTableData as Array<[string, number]>;

  const transcript = session.transcript?.trim();
  if (!transcript) return [];

  const customWords = Object.keys(session.custom_words || {});
  const derivedCounts = countFillerWords(transcript, customWords);
  return getFillerTableData(derivedCounts) as Array<[string, number]>;
};

export const generateSessionPdf = async (session: Session, username: string = 'User', _isPro: boolean = false) => {
  const identifier = username && username !== 'User' ? username : session.user_id;

  try {
    toast.info("Generating PDF...", { id: 'pdf-gen' });
    const doc = new jsPDF();
    const metrics = getSessionAnalysisMetrics(session);

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
    doc.text(`Duration: ${formatDuration(session.duration)}`, 14, 42);

    // --- Analytics ---
    doc.setFontSize(16);
    doc.text('Vocal Analytics', 14, 60);

    const analyticsData = [
      ['Metric', 'Value'],
      ['Speaking Pace (WPM)', `${metrics.wpm} (${metrics.wpmLabel})`],
      ['Clarity Score', `${Math.round(metrics.clarityScore)}% (${metrics.clarityLabel})`],
      ['Transcription Mode', formatSessionRecordingMode(session)],
      ['Silence Percentage', formatOptionalNumber(session.pause_metrics?.silencePercentage, value => `${value.toFixed(1)}%`)],
      ['Short Pauses (0.5-1.5s)', formatOptionalNumber(session.pause_metrics?.transitionPauses, value => value.toString(), '0')],
      ['Long Pauses (>1.5s)', formatOptionalNumber(session.pause_metrics?.extendedPauses, value => value.toString(), '0')],
      ['Longest Pause', formatOptionalNumber(session.pause_metrics?.longestPause, value => `${value.toFixed(1)}s`)],
    ];

    autoTable(doc, {
      startY: 70,
      body: analyticsData,
      theme: 'striped',
      headStyles: { fillColor: [41, 128, 185] },
    });

    const tableData = getPdfFillerTableData(session);
    if (tableData.length > 0) {
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

    if (session.ai_suggestions) {
      doc.addPage();
      doc.setFontSize(16);
      doc.text('AI-Powered Suggestions', 14, 22);
      doc.setFontSize(11);

      let y = 34;
      if (session.ai_suggestions.summary) {
        const summaryLines = doc.splitTextToSize(session.ai_suggestions.summary, 180);
        doc.text(summaryLines, 14, y);
        y += summaryLines.length * 6 + 8;
      }

      session.ai_suggestions.suggestions?.forEach((suggestion, index) => {
        if (y > 260) {
          doc.addPage();
          y = 22;
        }

        doc.setFontSize(12);
        doc.text(`${index + 1}. ${suggestion.title}`, 14, y);
        y += 7;
        doc.setFontSize(10);
        const descriptionLines = doc.splitTextToSize(suggestion.description, 180);
        doc.text(descriptionLines, 18, y);
        y += descriptionLines.length * 5 + 6;
      });
    }

    // --- Footer & Watermark ---
    const pageCount = (doc.internal as unknown as jsPDFInternal).getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);

      // Every export, including Basic exports, must carry a visible page watermark.
      doc.setFontSize(44);
      doc.setTextColor(238, 238, 238);
      for (let y = 48; y < doc.internal.pageSize.height; y += 70) {
        doc.text(
          PDF_WATERMARK_TEXT,
          doc.internal.pageSize.width / 2,
          y,
          { align: 'center', angle: 35 }
        );
      }

      doc.setFontSize(10);
      
      // Page Number
      doc.setTextColor(150, 150, 150);
      doc.text(`Page ${i} of ${pageCount}`, 14, doc.internal.pageSize.height - 10);
      
      // Reset color for other potential elements
      doc.setTextColor(0, 0, 0);
    }

    // Use a friendly filename: session_YYYYMMDD_username.pdf
    const dateStr = format(parseISO(session.created_at), 'yyyyMMdd');
    const sanitizedIdentifier = identifier.replace(/[^a-zA-Z0-9]/g, '_');
    const filename = `session_${dateStr}_${sanitizedIdentifier}.pdf`;

    toast.info(`Saving as: ${filename}`, { id: 'pdf-gen-name' });

    // Use FileSaver.js (industry standard) for reliable cross-browser download
    const blob = doc.output('blob');
    saveAs(blob, filename);

    toast.success("PDF Downloaded!", { id: 'pdf-gen' });

    // --- E2E Verification Signal ---
    if (typeof window !== 'undefined') {
      document.body.setAttribute('data-pdf-token', 'watermarked');
      setTimeout(() => document.body.removeAttribute('data-pdf-token'), 5000);
    }
  } catch (error: unknown) {
    logger.error({
      error,
      sessionId: session.id,
      message: error instanceof Error ? error.message : String(error)
    }, '[pdfGenerator] Error in PDF generation');
    toast.error('Failed to generate PDF report. Please try again.', { id: 'pdf-gen' });
  }
};
