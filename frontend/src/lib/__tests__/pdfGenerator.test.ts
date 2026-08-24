import { generateSessionPdf, getSessionPdfFilename, getPdfFillerTableData } from '../pdfGenerator';
import autoTable from 'jspdf-autotable';
import { saveAs } from 'file-saver';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PracticeSession as Session } from '../../types/session';

const loadSessionProgress = vi.fn();
vi.mock('@/services/progress/loadSessionProgress', () => ({
  loadSessionProgress: (...args: unknown[]) => loadSessionProgress(...args),
}));

vi.mock('jspdf', async (importOriginal) => {
  return await importOriginal<typeof import('jspdf')>();
});

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
  default: vi.fn((doc: unknown) => {
    // Add lastAutoTable property to match internal autoTable behavior
    (doc as { lastAutoTable?: { finalY: number } }).lastAutoTable = { finalY: 100 };
  }),
}));

// Mock file-saver to avoid initMouseEvent error in test environment
vi.mock('file-saver', () => ({
  saveAs: vi.fn(),
}));

// Mock DOM methods
const mockCreateElement = vi.fn(() => ({
  href: '',
  download: '',
  click: vi.fn(),
}));
const mockAppendChild = vi.fn();
const mockRemoveChild = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  loadSessionProgress.mockResolvedValue({ status: 'insufficient', sessionId: '123' });
  // Mock document methods
  vi.spyOn(document, 'createElement').mockImplementation(mockCreateElement as unknown as typeof document.createElement);
  vi.spyOn(document.body, 'appendChild').mockImplementation(mockAppendChild);
  vi.spyOn(document.body, 'removeChild').mockImplementation(mockRemoveChild);
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-url');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(vi.fn());
});

afterEach(() => {
  vi.useRealTimers();
});

const getSavedPdf = async () => {
  const saveAsCalls = vi.mocked(saveAs).mock.calls;
  const savedPdf = saveAsCalls[saveAsCalls.length - 1];
  expect(savedPdf).toBeDefined();
  const [blob, filename] = savedPdf as [Blob, string];

  return {
    filename,
    text: await blob.text(),
  };
};

describe('generateSessionPdf', () => {
  // #1306 metrics-only: a saved session carries persisted measurements and a flat filler_counts map — NO
  // transcript, NO free-form AI prose, NO per-session custom words ever cross into the export.
  const mockSession: Session = {
    id: '123',
    user_id: 'user1',
    created_at: '2025-09-23T10:00:00Z',
    duration: 300,
    total_words: 120,
    wpm: 140,
    clarity_score: 88,
    filler_counts: { um: 5, like: 3 },
  } as unknown as Session;

  it('generates a metrics-only PDF (persisted measurements + filler table, never a transcript or custom-word rows)', async () => {
    await generateSessionPdf(mockSession, 'TestUser');
    const savedPdf = await getSavedPdf();

    // Verify first call: Vocal Analytics — every value is a persisted measurement, not a transcript recount.
    expect(autoTable).toHaveBeenNthCalledWith(1, expect.anything(), expect.objectContaining({
      startY: 70,
      body: expect.arrayContaining([
        ['Metric', 'Value'],
        ['Session ID', '123'],
        ['Total Words', '120'],
        ['Speaking Pace (WPM)', '140 (Optimal Range)'],
        // The read model classifies this session `insufficient`, so the PDF must NOT claim "Available for
        // comparable Progress" — it uses neutral wording derived from eligibility.
        ['Clear-delivery evidence', 'Recorded — not yet comparable'],
        // #1306 + #1231: the headline is the TRUE-filler tier — um(5). "like"(3) is a discourse marker, shown
        // in the per-word breakdown below but excluded from the headline.
        ['Total Filler Words', '5'],
        ['Transcription Mode', 'Not recorded'],
        ['Engine Details', 'Not recorded'],
      ])
    }));

    // The retired per-session custom-word rows must never appear.
    const analyticsBody = vi.mocked(autoTable).mock.calls[0][1].body as string[][];
    expect(analyticsBody.flat()).not.toContain('Tracked Custom Words');
    expect(analyticsBody.flat()).not.toContain('Custom Words Detected');

    // Verify second call: Filler words table (breakdown of the stored flat map).
    expect(autoTable).toHaveBeenNthCalledWith(2, expect.anything(), expect.objectContaining({
      head: [['Filler Word', 'Frequency']],
      body: [['um', 5], ['like', 3]]
    }));

    // Verify actual generated PDF text commands, not only DOM/export signals.
    expect(savedPdf.text).toContain('(SpeakSharp Session Report) Tj');
    expect(savedPdf.text).toContain('(Date: September 23rd, 2025) Tj');
    expect(savedPdf.text).toContain('(Duration: 5 minutes) Tj');
    // No transcript ever crosses into the export.
    expect(savedPdf.text).not.toContain('(Transcript) Tj');
    expect(savedPdf.filename).toBe('TestUser_session_0_20250923.pdf');
  });

  it('exports the same persisted comparable Progress action and contexts as saved review', async () => {
    loadSessionProgress.mockResolvedValue({
      status: 'eligible',
      sessionId: '123',
      comparison: 'previous',
      direction: { direction: 'improved', deltaPoints: 6, deltaPercent: 7.14, reason: null, text: 'Clear delivery improved 7.1% vs your previous comparable session.' },
      baselineContext: 'Clear delivery improved 12.5% vs your first comparable session.',
      disclosure: {
        referenceSessionId: 'prev-1', referenceRole: 'previous comparable session', alsoFirstComparable: false,
        cohortKey: 'private|v2|base|clarity_v1', currentClarityPoints: 90, referenceClarityPoints: 84,
        deltaPoints: 6, deltaPercent: 7.14, units: 'clear-delivery points',
      },
      takeaways: {
        whatWorked: 'Very few filler words',
        practiceThisNext: 'Cut filler words toward 3%',
        target: { metric: 'filler_rate', direction: 'decrease', targetValue: 3, units: 'percent of words' },
      },
      recommendationId: 'rec-123',
      latestAttempt: null,
    });

    await generateSessionPdf(mockSession, 'TestUser');
    const savedPdf = await getSavedPdf();
    expect(savedPdf.text).toContain('(Comparable Progress) Tj');
    expect(savedPdf.text).toContain('(Practice this next) Tj');
    expect(savedPdf.text).toContain('(Cut filler words toward 3%) Tj');
    expect(savedPdf.text).toContain('(Clear delivery improved 7.1% vs your previous comparable session.) Tj');
    expect(savedPdf.text).toContain('(Clear delivery improved 12.5% vs your first comparable session.) Tj');
  });

  it('still exports the session when comparable Progress cannot be loaded', async () => {
    loadSessionProgress.mockRejectedValue(new Error('offline'));
    await expect(generateSessionPdf(mockSession, 'TestUser')).resolves.toBeUndefined();
    const savedPdf = await getSavedPdf();
    expect(savedPdf.text).toContain('(SpeakSharp Session Report) Tj');
    expect(savedPdf.text).not.toContain('(Comparable Progress) Tj');
  });

  it('names same-day sessions by user, session number, and date', () => {
    const firstSession = {
      ...mockSession,
      id: 'session-a',
      created_at: '2025-09-23T09:00:00Z',
    };
    const secondSession = {
      ...mockSession,
      id: 'session-b',
      created_at: '2025-09-23T10:00:00Z',
    };
    const nextDaySession = {
      ...mockSession,
      id: 'session-c',
      created_at: '2025-09-24T10:00:00Z',
    };

    expect(getSessionPdfFilename(firstSession, 'speaker@example.com', [firstSession, secondSession, nextDaySession]))
      .toBe('speaker_example_com_session_0_20250923.pdf');
    expect(getSessionPdfFilename(secondSession, 'speaker@example.com', [firstSession, secondSession, nextDaySession]))
      .toBe('speaker_example_com_session_1_20250923.pdf');
    expect(getSessionPdfFilename(nextDaySession, 'speaker@example.com', [firstSession, secondSession, nextDaySession]))
      .toBe('speaker_example_com_session_0_20250924.pdf');
  });

  it('formats short session durations in seconds instead of rounding to 0 minutes', async () => {
    await generateSessionPdf({
      ...mockSession,
      duration: 14,
    });
    const savedPdf = await getSavedPdf();

    expect(savedPdf.text).toContain('(Duration: 14 seconds) Tj');
  });

  it('excludes synthetic total filler rows and preserves zero pause metrics', async () => {
    await generateSessionPdf({
      ...mockSession,
      engine: 'private',
      model_name: 'whisper-tiny.en',
      engine_version: 'transformers-js-2.17',
      device_type: 'cpu',
      filler_counts: {
        um: 2,
        like: 3,
      },
      pause_metrics: {
        silencePercentage: 0,
        transitionPauses: 0,
        extendedPauses: 0,
        longestPause: 0,
      },
    } as unknown as Session);

    expect(autoTable).toHaveBeenNthCalledWith(1, expect.anything(), expect.objectContaining({
      body: expect.arrayContaining([
        ['Transcription Mode', 'Private'],
        ['Silence Percentage', '0.0%'],
        ['Short Pauses (0.5-1.5s)', '0'],
        ['Long Pauses (>1.5s)', '0'],
        ['Longest Pause', '0.0s'],
      ])
    }));

    expect(autoTable).toHaveBeenNthCalledWith(2, expect.anything(), expect.objectContaining({
      body: [['um', 2], ['like', 3]]
    }));
  });

  it('handles sessions with no measured filler map (NULL → no filler table)', async () => {
    const noFillers = { ...mockSession, filler_counts: null };
    await generateSessionPdf(noFillers as unknown as Session);

    // autoTable is called ONCE for analytics — an unmeasured filler map produces no filler table.
    expect(autoTable).toHaveBeenCalledTimes(1);
    expect(autoTable).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      body: expect.arrayContaining([['Metric', 'Value']])
    }));
  });

  it('a measured filler ZERO ({}) renders NO filler table and a headline of 0', async () => {
    await generateSessionPdf({
      ...mockSession,
      filler_counts: {}, // measured zero — a genuine "no fillers", never recounted from anything
    } as unknown as Session);

    // Measured zero is the headline, but there are no per-word rows to tabulate.
    expect(autoTable).toHaveBeenNthCalledWith(1, expect.anything(), expect.objectContaining({
      body: expect.arrayContaining([['Total Filler Words', '0']]),
    }));
    const fillerTableRendered = vi.mocked(autoTable).mock.calls.some(
      ([, opts]) => JSON.stringify((opts as { head?: unknown })?.head ?? null).includes('Filler Word'),
    );
    expect(fillerTableRendered).toBe(false);
  });

  it('#1306: NEVER renders a transcript page or free-form AI coaching page (metrics-only)', async () => {
    await generateSessionPdf({
      ...mockSession,
      next_action_signal: {
        reasonCode: 'HIGH_FILLER_RATE', actionCode: 'REDUCE_FILLERS', metric: 'filler_rate',
        value: 0.08, comparator: 'above_baseline', templateVersion: 'rec_v1',
      },
    } as unknown as Session);
    const savedPdf = await getSavedPdf();

    // No transcript page, no AI coaching page — content never crosses into the export.
    expect(savedPdf.text).not.toContain('(Transcript) Tj');
    expect(savedPdf.text).not.toContain('(AI Coaching Suggestions) Tj');
    // The structured next action IS rendered (copy comes from code, not the database).
    expect(savedPdf.text).toContain('(Your Next Action) Tj');
    expect(savedPdf.text).toContain('(Trim the filler words) Tj');
  });

  it('#1306: omits the next-action page when a non-completed session has no next_action_signal', async () => {
    await generateSessionPdf({ ...mockSession } as unknown as Session);
    const savedPdf = await getSavedPdf();
    expect(savedPdf.text).not.toContain('(Your Next Action) Tj');
    expect(savedPdf.text).not.toContain('(Transcript) Tj');
  });

  it('#1306: a COMPLETED session missing its next action prints a data-integrity failure, never hides it', async () => {
    await generateSessionPdf({
      ...mockSession,
      status: 'completed',
      next_action_signal: undefined,
    } as unknown as Session);
    const savedPdf = await getSavedPdf();
    expect(savedPdf.text).toContain('(Your Next Action) Tj');
    expect(savedPdf.text).toContain('(Data integrity error: this completed session is missing its next action.) Tj');
  });

  it.each([
    ['Free', false],
    ['Pro', true],
  ])('adds the SpeakSharp watermark to every generated page for %s exports', async (_tier, isPro) => {
    // A next action gives the report a second page, so the watermark must appear across multiple pages.
    await generateSessionPdf({
      ...mockSession,
      next_action_signal: {
        reasonCode: 'ON_TRACK', actionCode: 'MAINTAIN', metric: 'none',
        value: 0, comparator: 'within_target', templateVersion: 'rec_v1',
      },
    } as unknown as Session, 'TestUser', isPro);
    const savedPdf = await getSavedPdf();

    const visibleWatermarkCommands = savedPdf.text.match(/\(SpeakSharp\) Tj/g) ?? [];
    expect(visibleWatermarkCommands.length).toBeGreaterThanOrEqual(8);
    expect(savedPdf.text).not.toContain('(Generated by SpeakSharp) Tj');
    expect(document.body).toHaveAttribute('data-pdf-token', 'watermarked');
  });
});

describe('getPdfFillerTableData — the stored flat filler_counts is authoritative (no transcript to recount)', () => {
  const base = {
    id: 's', user_id: 'u', created_at: '', updated_at: '', title: 't', duration: 60,
  } as unknown as Session;

  it('a measured ZERO ({}) renders NO filler rows', () => {
    const rows = getPdfFillerTableData({
      ...base,
      filler_counts: {}, // measured zero
    } as unknown as Session);
    expect(rows).toEqual([]);
  });

  it('persisted fillers render from the saved flat map', () => {
    const rows = getPdfFillerTableData({
      ...base,
      filler_counts: { um: 3 },
    } as unknown as Session);
    expect(rows).toEqual([['um', 3]]);
  });

  it('an UNMEASURED map (null) renders NO rows (there is no transcript fallback to recount)', () => {
    const rows = getPdfFillerTableData({
      ...base,
      filler_counts: null,
    } as unknown as Session);
    expect(rows).toEqual([]);
  });

  it('an INVALID / prose-bearing map fails closed to NO rows (never smuggles a key through)', () => {
    const rows = getPdfFillerTableData({
      ...base,
      filler_counts: { 'a confidential phrase': 1 } as unknown as Record<string, number>,
    } as unknown as Session);
    expect(rows).toEqual([]);
  });
});

describe('generateSessionPdf — metric-presence: unmeasured metrics render N/A, never a sentinel zero', () => {
  const base = (over: Partial<Session>): Session => ({
    id: 'mp', user_id: 'user1', created_at: '2025-09-23T10:00:00Z', duration: 300,
    ...over,
  } as unknown as Session);

  it('renders N/A (not measured zero) for absent words and an unmeasured filler map', async () => {
    await generateSessionPdf(base({ total_words: undefined, filler_counts: undefined }), 'TestUser');
    expect(autoTable).toHaveBeenNthCalledWith(1, expect.anything(), expect.objectContaining({
      body: expect.arrayContaining([
        ['Total Words', 'N/A'],
        ['Total Filler Words', 'N/A'],
      ]),
    }));
  });

  it('renders persisted measurements when they exist', async () => {
    await generateSessionPdf(base({ total_words: 120, filler_counts: { um: 2 } }), 'TestUser');
    expect(autoTable).toHaveBeenNthCalledWith(1, expect.anything(), expect.objectContaining({
      body: expect.arrayContaining([
        ['Total Words', '120'],
        ['Total Filler Words', '2'],
      ]),
    }));
  });

  it('a measured filler ZERO ({}) renders a headline 0, but an absent word count stays N/A', async () => {
    await generateSessionPdf(base({ total_words: undefined, filler_counts: {} }), 'TestUser');
    expect(autoTable).toHaveBeenNthCalledWith(1, expect.anything(), expect.objectContaining({
      body: expect.arrayContaining([
        ['Total Words', 'N/A'],
        ['Total Filler Words', '0'],
      ]),
    }));
    // No legacy universal-score / coaching rows for any session.
    const body = vi.mocked(autoTable).mock.calls[0][1].body as string[][];
    expect(body.flat()).not.toContain('SpeakSharp Score');
    expect(body.flat()).not.toContain('Coaching Suggestion');
  });

  // ---------------------------------------------------------------------------------------------
  // #1306 Step 3 subtask C — the PDF must export a transcript ONLY for an opened `available` session.
  //
  // It consumes the same resolved view the review surface uses, so screen and export cannot disagree
  // about the same session. It never refetches and never reconstructs text: exporting an expired
  // transcript would put content in a downloadable file after its retention window closed.
  // ---------------------------------------------------------------------------------------------
  describe('transcript export is gated on the server transcript_state', () => {
    const TRANSCRIPT_MARKER = 'PDFTRANSCRIPTCANARYa83f21';
    // Local fixture — this describe sits under a different parent than the outer mockSession, so it
    // owns its own data rather than depending on an enclosing scope it cannot see.
    const baseForTranscript = {
      id: 'pdf-transcript-1',
      user_id: 'user1',
      created_at: '2025-09-23T10:00:00Z',
      duration: 300,
      total_words: 120,
      wpm: 140,
      clarity_score: 88,
      filler_counts: { um: 5 },
    };
    const sessionWith = (state: string | null, transcript: string | null) => ({
      ...baseForTranscript,
      transcript_state: state,
      transcript,
    } as unknown as Session);

    it('INCLUDES the transcript when the server says available', async () => {
      await generateSessionPdf(sessionWith('available', `spoken ${TRANSCRIPT_MARKER} words`), 'TestUser');
      const { text } = await getSavedPdf();
      // Positive control for every absence assertion below: the marker IS exportable when permitted.
      expect(text).toContain(TRANSCRIPT_MARKER);
    });

    it.each([
      ['expired', 'expired'],
      ['not_captured', 'not_captured'],
    ])('EXCLUDES the transcript when the server says %s — even though the text is present', async (_l, state) => {
      // The row still carries text (a stale/malformed response). Exporting it would leak content past
      // retention into a file that outlives the session.
      await generateSessionPdf(sessionWith(state, `spoken ${TRANSCRIPT_MARKER} words`), 'TestUser');
      const { text } = await getSavedPdf();
      expect(text).not.toContain(TRANSCRIPT_MARKER);
    });

    it('does not fabricate a transcript page when available carries no usable text', async () => {
      await generateSessionPdf(sessionWith('available', '   '), 'TestUser');
      const { text } = await getSavedPdf();
      expect(text).not.toContain(TRANSCRIPT_MARKER);
    });

    it('fails closed on an unknown state rather than exporting on a guess', async () => {
      await generateSessionPdf(sessionWith('something_new', `spoken ${TRANSCRIPT_MARKER} words`), 'TestUser');
      const { text } = await getSavedPdf();
      expect(text).not.toContain(TRANSCRIPT_MARKER);
    });
  });
});
