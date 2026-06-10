import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { saveAs } from 'file-saver';
import { PracticeSession as Session } from '../types/session';
import { format, parseISO } from 'date-fns';
import logger from './logger';
import { formatSessionRecordingMode } from '@/utils/engineLabels';
import { countFillerWords } from '@/utils/fillerWordUtils';
import { getSessionAnalysisMetrics } from '@/utils/sessionAnalysis';
import { calculateSpeakingScore } from '@/utils/speakingScore';

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

const getCustomWordList = (customWords: Session['custom_words']): string[] => {
  if (!customWords) return [];
  if (Array.isArray(customWords)) {
    return customWords
      .map((item) => typeof item === 'string' ? item : '')
      .filter(Boolean);
  }
  return Object.keys(customWords);
};

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

  const customWords = getCustomWordList(session.custom_words);
  const derivedCounts = countFillerWords(transcript, customWords);
  return getFillerTableData(derivedCounts) as Array<[string, number]>;
};

const sanitizeFilenamePart = (value: string): string => {
  const sanitized = value
    .trim()
    .replace(/@/g, '_')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  return sanitized || 'user';
};

const getSessionDateKey = (session: Pick<Session, 'created_at'>): string => {
  try {
    return format(parseISO(session.created_at), 'yyyyMMdd');
  } catch {
    return format(new Date(), 'yyyyMMdd');
  }
};

export const getSessionPdfFilename = (
  session: Session,
  username: string = 'User',
  sessionsForDay: Session[] = []
): string => {
  const identifier = username && username !== 'User' ? username : session.user_id;
  const dateStr = getSessionDateKey(session);
  const sameDaySessions = [...sessionsForDay, session]
    .filter((candidate, index, arr) => arr.findIndex(item => item.id === candidate.id) === index)
    .filter(candidate => getSessionDateKey(candidate) === dateStr)
    .sort((a, b) => {
      const timeDelta = Date.parse(a.created_at) - Date.parse(b.created_at);
      return timeDelta !== 0 ? timeDelta : a.id.localeCompare(b.id);
    });
  const sessionNumber = Math.max(0, sameDaySessions.findIndex(candidate => candidate.id === session.id));

  return `${sanitizeFilenamePart(identifier)}_session_${sessionNumber}_${dateStr}.pdf`;
};

const writePaginatedText = (
  doc: jsPDF,
  text: string,
  x: number,
  startY: number,
  maxWidth: number,
  lineHeight = 5,
  bottomMargin = 18
): number => {
  const lines = doc.splitTextToSize(text, maxWidth);
  const pageHeight = (doc.internal as unknown as jsPDFInternal).pageSize.height;
  let y = startY;

  for (const line of lines) {
    if (y > pageHeight - bottomMargin) {
      doc.addPage();
      y = 22;
    }
    doc.text(line, x, y);
    y += lineHeight;
  }

  return y;
};

export const generateSessionPdf = async (
  session: Session,
  username: string = 'User',
  _isPro: boolean = false,
  sessionsForDay: Session[] = []
) => {
  try {
    toast.info("Generating PDF...", { id: 'pdf-gen' });
    const doc = new jsPDF();
    const metrics = getSessionAnalysisMetrics(session);
    const scoreResult = calculateSpeakingScore({
      transcript: session.transcript || '',
      wordCount: metrics.wordCount,
      wpm: metrics.wpm,
      clarityScore: metrics.clarityScore,
      fillerCount: metrics.fillerCount,
      elapsedSeconds: session.duration || 0,
      pauseMetrics: session.pause_metrics || {
        silencePercentage: 0,
        transitionPauses: 0,
        extendedPauses: 0,
        longestPause: 0,
      },
      engine: session.engine,
    });
    const customWords = getCustomWordList(session.custom_words);
    const customWordsDetected = customWords.reduce((sum, word) => {
      const savedCount = session.custom_words?.[word];
      if (savedCount && typeof savedCount === 'object' && 'count' in savedCount && typeof savedCount.count === 'number') {
        return sum + savedCount.count;
      }
      return sum + (metrics.fillerData[word]?.count ?? 0);
    }, 0);
    const engineDetails = [
      session.model_name,
      session.engine_version,
      session.device_type,
    ].filter(Boolean).join(', ');

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
    if (session.title) {
      doc.text(`Session: ${session.title}`, 14, 50);
    }

    // --- Analytics ---
    doc.setFontSize(16);
    doc.text('Vocal Analytics', 14, 60);

    const analyticsData = [
      ['Metric', 'Value'],
      ['Session ID', session.id],
      ['Total Words', `${metrics.wordCount}`],
      ['Speaking Pace (WPM)', `${metrics.wpm} (${metrics.wpmLabel})`],
      ['Clarity Score', `${Math.round(metrics.clarityScore)}% (${metrics.clarityLabel})`],
      ['Total Filler Words', `${metrics.fillerCount}`],
      ['Tracked Custom Words', customWords.length > 0 ? customWords.join(', ') : 'None'],
      ['Custom Words Detected', `${customWordsDetected}`],
      ['Transcription Mode', formatSessionRecordingMode(session)],
      ['Engine Details', engineDetails || 'Not recorded'],
      ['Silence Percentage', formatOptionalNumber(session.pause_metrics?.silencePercentage, value => `${value.toFixed(1)}%`)],
      ['Short Pauses (0.5-1.5s)', formatOptionalNumber(session.pause_metrics?.transitionPauses, value => value.toString(), '0')],
      ['Long Pauses (>1.5s)', formatOptionalNumber(session.pause_metrics?.extendedPauses, value => value.toString(), '0')],
      ['Longest Pause', formatOptionalNumber(session.pause_metrics?.longestPause, value => `${value.toFixed(1)}s`)],
      ['SpeakSharp Score', scoreResult.confidence === 'warming-up' ? '-- / 10 (Warming up)' : `${scoreResult.score.toFixed(1)} / 10 (${scoreResult.label})`],
      ['Coaching Suggestion', scoreResult.actions.slice(0, 2).join('; ')],
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
    writePaginatedText(doc, session.transcript || 'No transcript available.', 14, 32, 180);

    if (session.ai_suggestions) {
      doc.addPage();
      doc.setFontSize(16);
      doc.text('AI Coaching Suggestions', 14, 22);
      doc.setFontSize(11);

      let y = 34;
      if (session.ai_suggestions.summary) {
        y = writePaginatedText(doc, session.ai_suggestions.summary, 14, y, 180, 6) + 8;
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
        y = writePaginatedText(doc, suggestion.description, 18, y, 180, 5) + 6;
      });
    }

    // --- Footer & Watermark ---
    const pageCount = (doc.internal as unknown as jsPDFInternal).getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);

      // Every export, including Free and Pro exports, must carry a visible page watermark.
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

    const filename = getSessionPdfFilename(session, username, sessionsForDay);

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
