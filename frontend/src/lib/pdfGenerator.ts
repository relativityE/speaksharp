import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { saveAs } from 'file-saver';
import { PracticeSession as Session } from '../types/session';
import { format, parseISO } from 'date-fns';
import { validateNextActionSignal, renderNextActionCopy } from '@/contracts/nextActionSignal';
import logger from './logger';
import { formatSessionRecordingMode } from '@/utils/engineLabels';
import { getSessionAnalysisMetrics } from '@/utils/sessionAnalysis';
import { readPersistedFillerCounts } from '@/contracts/fillerCounts';
import { loadSessionProgress } from '@/services/progress/loadSessionProgress';

// A more specific type for the internal, undocumented API
interface jsPDFInternal {
  getNumberOfPages: () => number;
  pageSize: {
    height: number;
    width: number;
  };
}

import { toast } from '@/lib/toast';
import { resolveTranscriptView } from './storage';

const PDF_WATERMARK_TEXT = 'SpeakSharp';

const formatOptionalNumber = (value: number | null | undefined, formatter: (value: number) => string, fallback = 'N/A') =>
  typeof value === 'number' ? formatter(value) : fallback;

// #1306 metrics-only: read the STORED flat filler_counts ({ um: 3 }); never a nested map or a transcript.
const getFillerTableData = (fillerCounts?: Record<string, number> | null): Array<[string, number]> =>
  Object.entries(fillerCounts || {})
    .filter(([word]) => word !== 'total')
    .filter(([, count]) => typeof count === 'number' && count > 0)
    .map(([word, count]) => [word, count as number]);

const formatDuration = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0 seconds';

  const roundedSeconds = Math.round(seconds);
  const minutes = Math.floor(roundedSeconds / 60);
  const remainingSeconds = roundedSeconds % 60;

  if (minutes === 0) return `${remainingSeconds} second${remainingSeconds === 1 ? '' : 's'}`;
  if (remainingSeconds === 0) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  return `${minutes} minute${minutes === 1 ? '' : 's'} ${remainingSeconds} second${remainingSeconds === 1 ? '' : 's'}`;
};

export const getPdfFillerTableData = (session: Session): Array<[string, number]> => {
  // #1306 metrics-only: the stored flat filler_counts is authoritative; there is no transcript to recount.
  if (readPersistedFillerCounts(session.filler_counts) === null) return [];
  return getFillerTableData(session.filler_counts);
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
    // Reuse the exact persisted Progress read model used by the saved review (loaded ONCE). A PDF must
    // never recompute its own comparison, and it must not label evidence "comparable" unless this
    // authoritative read model actually classifies the session eligible.
    const progress = await loadSessionProgress(session.id).catch(() => null);
    const clarityComparable = progress?.status === 'eligible';
    // #1306 metrics-only: a metric shows iff its own value is persisted (metric-presence provenance).
    const derivedCell = (persistedIsRealNumber: boolean, render: () => string): string =>
      persistedIsRealNumber ? render() : 'N/A';
    const wordsCell = derivedCell(typeof session.total_words === 'number', () => `${metrics.wordCount}`);
    const wpmCell = derivedCell(typeof session.wpm === 'number', () => `${metrics.wpm} (${metrics.wpmLabel})`);
    // `clarity_score` is an internal evidence input, not a user-facing universal score. Only claim it is
    // "Available for comparable Progress" when the authoritative read model classifies the session
    // eligible; when it is insufficient/ineligible/unavailable, say so neutrally rather than implying a
    // comparison the Progress model would not make.
    const clarityCell = derivedCell(
      typeof session.clarity_score === 'number',
      () => clarityComparable ? 'Available for comparable Progress' : 'Recorded — not yet comparable',
    );
    const fillerCell = derivedCell(metrics.fillerCount !== null, () => `${metrics.fillerCount}`);
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
      ['Total Words', wordsCell],
      ['Speaking Pace (WPM)', wpmCell],
      ['Clear-delivery evidence', clarityCell],
      ['Total Filler Words', fillerCell],
      ['Transcription Mode', formatSessionRecordingMode(session)],
      ['Engine Details', engineDetails || 'Not recorded'],
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

    // #1306 Step 3: the transcript page is included ONLY for a session the server states is `available`.
    //
    // The decision comes from resolveTranscriptView on the ALREADY-OPENED detail row — the same resolver the
    // review surface uses. The PDF never refetches and never reconstructs text: an expired or not-captured
    // session simply has no transcript page, and a malformed row that still carries text after expiry is
    // suppressed here exactly as it is on screen. Reconstructing would export content past its retention.
    const transcriptView = resolveTranscriptView(session as { transcript_state?: string | null; transcript?: string | null });
    if (transcriptView.kind === 'available') {
      doc.addPage();
      doc.setFontSize(16);
      doc.text('Transcript', 14, 22);
      doc.setFontSize(10);
      // PAGINATED. The v2 contract permits up to 50,000 characters; handing every split line to one
      // `doc.text` call writes them all onto a single page, where the overflow is silently lost and the
      // footer overprints the body. writePaginatedText breaks pages at the bottom margin so the tail of a
      // long transcript actually reaches the exported artifact.
      writePaginatedText(doc, transcriptView.text, 14, 34, 180);
    }

    // NO free-form AI coaching page. The exported report contains metrics + the ONE structured next action
    // (rendered from next_action_signal below / the Progress section).
    const naSignal = session.next_action_signal;
    const naValidated = naSignal ? validateNextActionSignal(naSignal) : null;
    if (naValidated?.ok) {
      const copy = renderNextActionCopy(naValidated.value);
      doc.addPage();
      doc.setFontSize(16);
      doc.text('Your Next Action', 14, 22);
      doc.setFontSize(12);
      doc.text(copy.title, 14, 34);
      doc.setFontSize(10);
      writePaginatedText(doc, copy.body, 14, 42, 180, 5);
    } else if (session.status === 'completed') {
      // #1306: a COMPLETED session MUST carry exactly one valid next action — its absence is a data-integrity
      // failure that the export records honestly, never hides.
      doc.addPage();
      doc.setFontSize(16);
      doc.text('Your Next Action', 14, 22);
      doc.setFontSize(10);
      doc.text('Data integrity error: this completed session is missing its next action.', 14, 34);
    }

    // The Progress read model was loaded once above (reused here) — the PDF must never recompute its own
    // comparison or substitute AI coaching for the one durable next action.
    if (progress?.status === 'eligible') {
      doc.addPage();
      doc.setFontSize(16);
      doc.text('Comparable Progress', 14, 22);
      doc.setFontSize(11);
      doc.text('Practice this next', 14, 34);
      doc.setFontSize(10);
      let progressY = writePaginatedText(doc, progress.takeaways.practiceThisNext, 18, 41, 180, 5) + 8;
      doc.setFontSize(11);
      doc.text('Supporting comparison', 14, progressY);
      doc.setFontSize(10);
      progressY = writePaginatedText(doc, progress.direction.text, 18, progressY + 7, 180, 5) + 5;
      writePaginatedText(doc, progress.baselineContext, 18, progressY, 180, 5);
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
