/**
 * #1258 PR 4 (Rev 2 §4.2, D1) — the completed session, restored read-only from its saved row.
 *
 * Shown on `/session?review=<id>` when the page was re-entered (browser Back from Progress, a reload) and so no longer
 * holds the take in memory: the after-state flag lives in the session lifecycle hook and resets on remount (Production
 * diagnostic run 37706942773 — the saved marker and id survived, the page fell back to its idle `before` state).
 *
 * Read-only on entry: the review band is `SavedPracticeLoopReview`, which never calls the coaching function; nothing
 * here starts a recording. The one exception (PO 2026-10-09): a session with no saved coaching offers an explicit
 * Try again (`RestoredReviewRetry`), and only that press requests coaching. Its own "Practice again?" opens a fresh `/session`, which leaves this view.
 */
import React from 'react';
import { Button } from '@/components/ui/button';
import { SavedPracticeLoopReview } from '@/components/analytics/SavedPracticeLoopReview';
import { SavedFocusPointsCoverage } from '@/components/analytics/SavedFocusPointsCoverage';
import { resolveTranscriptView } from '@/lib/storage';
import { getSessionAnalysisMetrics } from '@/utils/sessionAnalysis';
import { plural, shortDate, shortTime } from '@/lib/displayFormat';
import type { PracticeSession } from '@/types/session';
import { ThisRunCard } from './ThisRunCard';
import { RestoredReviewRetry } from './RestoredReviewRetry';

// The Analytics session detail's approved copy, verbatim (one wording per transcript state).
const TRANSCRIPT_STATE_COPY: Record<'expired' | 'not_captured' | 'unavailable', string> = {
    expired: 'This transcript is no longer available; session metrics are unaffected.',
    not_captured: 'No transcript was captured for this session. Session metrics are unaffected.',
    unavailable: 'This transcript could not be loaded. Session metrics are unaffected.',
};

interface SavedSessionReturnProps {
    session: PracticeSession;
    onSeeAllSessions: () => void;
}

export const SavedSessionReturn: React.FC<SavedSessionReturnProps> = ({ session, onSeeAllSessions }) => {
    const metrics = getSessionAnalysisMetrics(session);
    const transcript = resolveTranscriptView(session);
    const words = typeof session.total_words === 'number' ? session.total_words : null;
    const wpm = typeof session.wpm === 'number' ? Math.round(session.wpm) : null;
    const label = `${shortDate(session.created_at)}, ${shortTime(session.created_at)}`;
    const fillersPerMinute = metrics.fillerCount !== null && session.duration > 0 ? (metrics.fillerCount / session.duration) * 60 : null;

    return (
        <section className="space-y-6" data-testid="saved-session-return" data-session-id={session.id}>
            <SavedPracticeLoopReview
                sessionId={session.id}
                sessionLabel={label}
                // §4.2: no saved review → the §2 band with an explicit Try again (never an automatic request).
                // #1577 Codex P2: the review's own practice action and RESOLVED product, never the raw row's product alone.
                noneFallback={({ action, product, retryReady }) => (
                    <RestoredReviewRetry sessionId={session.id} product={product ?? session.product ?? null} sessionLabel={label}
                        transcriptAvailable={transcript.kind === 'available'} resultsReady={retryReady} action={action} />
                )}
            />

            <div className="grid gap-6 md:grid-cols-[1fr_320px] md:items-start">
                <div className="rounded-2xl border border-neutral-border-strong bg-white p-5" data-testid="saved-session-return-transcript">
                    <p className="text-[15px] font-extrabold text-neutral-heading">
                        Transcript{words !== null && <span className="font-semibold text-neutral-secondary"> · {plural(words, 'word', 'words')}</span>}
                    </p>
                    {transcript.kind === 'available' ? (
                        <p className="mt-3 whitespace-pre-wrap text-[15px] leading-relaxed text-neutral-body" data-testid="review-transcript">{transcript.text}</p>
                    ) : (
                        <p className="mt-3 text-sm text-neutral-secondary" data-testid={`saved-session-return-transcript-${transcript.kind}`}>
                            {TRANSCRIPT_STATE_COPY[transcript.kind]}
                        </p>
                    )}
                </div>
                <div className="space-y-4">
                    <ThisRunCard fillers={metrics.fillerCount} fillersPerMinute={fillersPerMinute} wordsPerMinute={wpm} words={words} />
                    {/* The saved Focus Points result, read-only; renders nothing for Open Mic. */}
                    <SavedFocusPointsCoverage sessionId={session.id} />
                    <Button variant="outline" className="w-full" onClick={onSeeAllSessions} data-testid="saved-session-return-see-all">
                        See all sessions
                    </Button>
                </div>
            </div>
        </section>
    );
};
