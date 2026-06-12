import React from 'react';
import { Lock, Cloud } from 'lucide-react';
import { TEST_IDS } from '@/constants/testIds';
import { SESSION_INSET_SURFACE_CLASS, SESSION_SURFACE_CLASS } from './sessionSurface';
import { splitSettledActiveTranscript, hasSevereRepetitionLoop } from './liveTranscriptUtils';

import { parseTranscriptForHighlighting } from '@/utils/highlightUtils';

declare global {
    interface Window {
        /** #33 Native trust-disclaimer proof: latest trust-state snapshot. */
        __SS_TRUST_STATE__?: Record<string, unknown>;
        /** #33: append-only trace of trust-state snapshots (bounded). */
        __SS_TRUST_TRACE__?: Array<Record<string, unknown>>;
    }
}

interface LiveTranscriptPanelProps {
    transcript: string;
    interimTranscript?: string;
    isListening: boolean;
    sttMode?: string;
    micLevel?: number;
    hasSpeechActivity?: boolean;
    containerRef?: React.RefObject<HTMLDivElement>;
    userWords?: string[];
    className?: string;
    history?: Array<{ mode: string; text: string }>;
    /**
     * True while the engine is running the whole-utterance final decode after Stop.
     * Drives the "Processing speech locally…" state so the user is not staring at
     * stale/low-confidence draft text during multi-second CPU finalization.
     */
    isFinalizing?: boolean;
    /**
     * Native raw-first async formatting status (post-stop). Drives the threshold-only
     * "tidying up punctuation…" notice; defaults to idle (no notice). Only ever surfaces
     * in the `final` state for native mode, and only if formatting stays pending > ~1.5s.
     */
    nativeFormatting?: { status: 'idle' | 'pending' | 'complete' | 'failed'; startedAt: number | null };
}

/** Discrete UI state for the live transcript, exposed via data-transcript-state. */
type LiveTranscriptUiState = 'listening' | 'drafting' | 'finalizing' | 'final' | 'idle';

const WaveformMeter: React.FC<{ level: number; isProcessing: boolean }> = ({ level, isProcessing }) => {
    const visibleLevel = Math.max(0.08, Math.min(level, 1));
    const bars = [0.35, 0.62, 0.9, 0.5, 0.74];

    return (
        <div className="flex h-8 items-center justify-center gap-1" aria-hidden="true">
            {bars.map((weight, index) => (
                <span
                    key={index}
                    className={`w-1.5 rounded-full bg-primary transition-[height,opacity] duration-150 ${isProcessing ? 'animate-pulse' : ''}`}
                    style={{
                        height: `${8 + (visibleLevel * weight * 24)}px`,
                        opacity: 0.35 + (visibleLevel * 0.65),
                    }}
                />
            ))}
        </div>
    );
};

/**
 * Presentational component for the live transcript display.
 * Extracted from SessionPage for better reusability and testability.
 */
export const LiveTranscriptPanel: React.FC<LiveTranscriptPanelProps> = ({
    transcript,
    interimTranscript = '',
    isListening,
    sttMode,
    micLevel = 0,
    hasSpeechActivity = false,
    containerRef,
    userWords = [],
    className = "",
    history = [],
    isFinalizing = false,
    nativeFormatting = { status: 'idle', startedAt: null },
}) => {
    const tokens = parseTranscriptForHighlighting(transcript, userWords);
    const hasTranscript = transcript.trim() !== '';
    const displayInterimTranscript =
        transcript.trim() === interimTranscript.trim() ? '' : interimTranscript;
    const hasInterimTranscript = displayInterimTranscript.trim() !== '';
    // Option 1 (live-view segment finalization): show completed draft sentences as
    // settled/recognized so a long speech is not one giant Draft block, while the
    // trailing in-progress sentence stays clearly Draft. Display only — saved path
    // (whole-utterance final) is untouched.
    const { settled: settledDraft, active: activeDraft } = splitSettledActiveTranscript(displayInterimTranscript);
    const hasSettledDraft = settledDraft !== '';
    // What the trailing Draft line shows: the in-progress sentence when we have
    // settled sentences, else the whole draft (prior single-Draft behaviour).
    const draftLineText = hasSettledDraft ? activeDraft : displayInterimTranscript;

    // Discrete UI state for styling + browser-test assertions.
    const uiState: LiveTranscriptUiState = isFinalizing
        ? 'finalizing'
        : isListening
            ? (hasInterimTranscript || hasTranscript ? 'drafting' : 'listening')
            : (hasTranscript ? 'final' : 'idle');
    const normalizedSttMode = (sttMode ?? '').toLowerCase();
    const isPrivateMode = normalizedSttMode === 'private';
    // LIVE-TRANSCRIPT-REPEATED-DISPLAY (A+): release containment for the v4 Whisper streaming
    // repetition-loop failure mode. When the live (committed or interim) text is severely looped,
    // WITHHOLD it from the surface and show the existing "Processing…" state until the clean
    // whole-utterance final replaces it. Display-only: no transcript data is mutated/de-duplicated;
    // gated to private mode so Native/Cloud are untouched, and the detector only fires on v4-grade
    // loops so healthy private-v2 text is unaffected. (Proper fix tracked separately: keep v4
    // streaming hypotheses out of the committed transcript store.)
    const withholdLoopedLive = isPrivateMode
        && (hasSevereRepetitionLoop(transcript) || hasSevereRepetitionLoop(interimTranscript));
    const isDrafting = uiState === 'drafting';
    const showDraftTrustBanner = isListening && !isFinalizing;
    const showPrivateFeedback = isPrivateMode && isListening;
    const privateStatus = hasTranscript || hasInterimTranscript ? 'Live text' : 'Private local';
    const visibleTranscript = [transcript.trim(), displayInterimTranscript.trim()].filter(Boolean).join(' ').trim();
    const finalizingBannerText = isPrivateMode ? 'Processing speech locally…' : 'Processing transcript…';
    const finalizingEmptyTitle = isPrivateMode ? 'Finalizing local transcript…' : 'Finalizing transcript…';
    const finalizingEmptyDescription = isPrivateMode
        ? 'Your final transcript will appear here when local processing finishes.'
        : 'Your final transcript will appear here when processing finishes.';
    const listeningEmptyText = isPrivateMode
        ? (hasSpeechActivity ? 'Processing speech locally…' : 'Listening locally…')
        : (hasSpeechActivity ? 'Processing speech…' : 'Listening...');

    // Threshold-only Native formatting notice: post-stop, the raw transcript is already
    // saved+shown; punctuation/casing is polished in the background. We surface a notice
    // ONLY if that polish is still pending past ~1.5s, so the common sub-second case stays
    // silent and the UI never feels slow. Idle/complete/failed → no notice.
    const NATIVE_FORMATTING_NOTICE_DELAY_MS = 1500;
    const isNativeMode = normalizedSttMode === 'native';
    const [showFormattingNotice, setShowFormattingNotice] = React.useState(false);
    React.useEffect(() => {
        if (uiState !== 'final' || !isNativeMode || nativeFormatting.status !== 'pending') {
            setShowFormattingNotice(false);
            return;
        }
        const elapsed = nativeFormatting.startedAt ? Date.now() - nativeFormatting.startedAt : 0;
        const remaining = Math.max(0, NATIVE_FORMATTING_NOTICE_DELAY_MS - elapsed);
        const timerId = window.setTimeout(() => setShowFormattingNotice(true), remaining);
        return () => window.clearTimeout(timerId);
    }, [uiState, isNativeMode, nativeFormatting.status, nativeFormatting.startedAt]);

    React.useEffect(() => {
        if (typeof window === 'undefined' || !visibleTranscript) return;
        const traceWindow = window as Window & {
            __SS_TRANSCRIPT_TRACE__?: Array<Record<string, unknown>>;
            __SS_TRANSCRIPT_TRACE_SEQ__?: number;
        };
        traceWindow.__SS_TRANSCRIPT_TRACE__ = traceWindow.__SS_TRANSCRIPT_TRACE__ ?? [];
        traceWindow.__SS_TRANSCRIPT_TRACE_SEQ__ = (traceWindow.__SS_TRANSCRIPT_TRACE_SEQ__ ?? 0) + 1;
        traceWindow.__SS_TRANSCRIPT_TRACE__.push({
            sequence: traceWindow.__SS_TRANSCRIPT_TRACE_SEQ__,
            t: Number(performance.now().toFixed(1)),
            stage: 'ui:visible',
            timestamp: Date.now(),
            textLength: visibleTranscript.length,
            preview: visibleTranscript.slice(0, 80),
        });
        if (traceWindow.__SS_TRANSCRIPT_TRACE__.length > 1000) {
            traceWindow.__SS_TRANSCRIPT_TRACE__.shift();
        }
    }, [visibleTranscript]);

    // #33 Native trust-disclaimer proof hooks: publish a timestamped trust-state
    // snapshot (+ append-only trace) so the harness can prove WHEN each trust state
    // became visible without DOM polling. Test-only telemetry; no behavior change.
    React.useEffect(() => {
        if (typeof window === 'undefined') return;
        const w = window as Window & {
            __SS_TRUST_STATE__?: Record<string, unknown>;
            __SS_TRUST_TRACE__?: Array<Record<string, unknown>>;
        };
        const snapshot = {
            uiState,
            draftBannerVisible: showDraftTrustBanner,
            processingVisible: isFinalizing,
            finalStateVisible: uiState === 'final',
            listeningVisible: uiState === 'listening',
            sttMode: sttMode ?? null,
            at: Date.now(),
            t: Number(performance.now().toFixed(1)),
        };
        w.__SS_TRUST_STATE__ = snapshot;
        w.__SS_TRUST_TRACE__ = w.__SS_TRUST_TRACE__ ?? [];
        w.__SS_TRUST_TRACE__.push(snapshot);
        if (w.__SS_TRUST_TRACE__.length > 500) w.__SS_TRUST_TRACE__.shift();
    }, [uiState, showDraftTrustBanner, isFinalizing, sttMode]);

    return (
        <div
            className={`${SESSION_SURFACE_CLASS} p-4 flex flex-col ${className}`}
            data-testid={TEST_IDS.TRANSCRIPT_PANEL}
            // #33 Native trust-disclaimer proof hooks: explicit booleans so the test
            // harness can assert each trust state without scraping nested DOM.
            data-draft-banner-visible={showDraftTrustBanner ? 'true' : 'false'}
            data-processing-visible={isFinalizing ? 'true' : 'false'}
            data-final-state-visible={uiState === 'final' ? 'true' : 'false'}
            data-listening-visible={uiState === 'listening' ? 'true' : 'false'}
        >
            {/*
              Clean transcript surface for tests: ONLY the committed user transcript —
              no Draft/Processing/Listening/helper copy, no interim text. Scraping the
              visible container mixes those in (the `basically3um2like2…` contamination);
              read this instead. Visually hidden; never affects layout/UX.
            */}
            <span
                data-testid="transcript-text-only"
                data-transcript-text-only={transcript.trim()}
                className="sr-only"
                aria-hidden="true"
            >
                {transcript.trim()}
            </span>
            <div className="mb-2 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                    <div className="w-1 h-5 bg-primary rounded"></div>
                    <h3 className="text-lg font-semibold text-foreground">Live Transcript</h3>
                </div>
                {showPrivateFeedback && (
                    <div className="flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-2.5 py-1 text-xs font-medium text-primary">
                        <WaveformMeter level={micLevel} isProcessing={hasSpeechActivity && !hasTranscript && !hasInterimTranscript} />
                        <span>{privateStatus}</span>
                    </div>
                )}
            </div>
            <div
                ref={containerRef}
                className={`live-transcript-scroll flex-1 overflow-y-auto p-3 pr-5 ${SESSION_INSET_SURFACE_CLASS} leading-relaxed transition-all min-h-[160px]`}
                data-testid={TEST_IDS.TRANSCRIPT_CONTAINER}
                data-scrollable-transcript="true"
                data-transcript-state={uiState}
                aria-live="polite"
                aria-label="Live transcript of your speech"
                role="log"
            >
                {/* Finalizing banner: post-Stop whole-utterance decode in progress.
                    Keeps the user informed during multi-second CPU finalization so
                    stale draft text is never mistaken for the saved result. */}
                {isFinalizing && (
                    <div
                        className="sticky top-0 z-20 mb-3 flex items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm font-medium text-primary"
                        data-testid="live-transcript-finalizing"
                    >
                        <span className="h-2 w-2 animate-pulse rounded-full bg-primary" aria-hidden="true" />
                        {finalizingBannerText}
                    </div>
                )}

                {showDraftTrustBanner && (
                    <div
                        className="sticky top-0 z-20 mb-3 rounded-md border border-dashed border-primary/30 bg-background/95 px-3 py-2 text-sm text-foreground/80 shadow-sm backdrop-blur"
                        data-testid="live-transcript-trust-banner"
                        data-transcript-trust="draft"
                        aria-label="Draft transcript notice"
                    >
                        <span className="font-semibold text-primary">Draft transcript</span>
                        {/* Real whitespace text node so extracted/AT text reads
                            "Draft transcript Text may change…" not glued "transcriptText". */}
                        {' '}
                        <span className="ml-2 text-xs text-foreground/60">Text may change before the final transcript is saved.</span>
                    </div>
                )}

                {/* Segmented History (Chapters) */}
                {history.map((segment, idx) => (
                    <div key={`history-${idx}`} className="mb-6 last:mb-4 group">
                        <div className="flex items-center gap-2 mb-2">
                            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-white border border-[hsl(var(--border-strong))] surface-shadow">
                                {segment.mode === 'private' ? (
                                    <>
                                        <Lock className="h-3 w-3 text-success" />
                                        <span className="text-[10px] font-semibold text-success">Chapter {idx + 1}: Private</span>
                                    </>
                                ) : (
                                    <>
                                        <Cloud className="h-3 w-3 text-accent" />
                                        <span className="text-[10px] font-semibold text-accent">Chapter {idx + 1}: Cloud</span>
                                    </>
                                )}
                            </div>
                            <div className="flex-1 h-px bg-gradient-to-r from-border to-transparent" />
                        </div>
                        <div className="pl-2 border-l-2 border-primary/30 text-sm leading-relaxed text-foreground/80 italic">
                            {segment.text}
                        </div>
                    </div>
                ))}

                {/* Engine Handoff Separator */}
                {history.length > 0 && hasTranscript && (
                    <div className="flex items-center gap-4 my-6 select-none pointer-events-none">
                        <div className="flex-1 h-px bg-gradient-to-r from-transparent via-primary/30 to-transparent" />
                        <span className="text-[10px] font-semibold text-primary/80">Engine Handoff</span>
                        <div className="flex-1 h-px bg-gradient-to-r from-transparent via-primary/30 to-transparent" />
                    </div>
                )}

                {/* Current Active Segment */}
                {isListening && !hasTranscript && !hasInterimTranscript ? (
                    isPrivateMode ? (
                        <div className="flex min-h-[120px] flex-col items-center justify-center gap-3 text-center text-foreground/80">
                            <div className={`relative flex h-14 w-14 items-center justify-center rounded-full border border-primary/25 bg-primary/5 ${hasSpeechActivity ? 'shadow-[0_0_0_8px_hsl(var(--primary)/0.08)]' : ''}`}>
                                {hasSpeechActivity && <span className="absolute inset-0 rounded-full border border-primary/30 animate-ping" />}
                                <WaveformMeter level={micLevel} isProcessing={hasSpeechActivity} />
                            </div>
                            <p className={hasSpeechActivity ? 'text-primary font-medium' : 'animate-pulse'}>
                                {listeningEmptyText}
                            </p>
                        </div>
                    ) : (
                        <p className="text-sm font-semibold text-foreground/75 animate-pulse">{listeningEmptyText}</p>
                    )
                ) : withholdLoopedLive ? (
                    // A+ release containment: a severe v4 streaming repetition loop is withheld from
                    // the surface; show Processing until the clean whole-utterance final lands.
                    <div
                        className="flex min-h-[120px] flex-col items-center justify-center gap-2 text-center text-foreground/80"
                        data-testid="live-transcript-loop-withheld"
                        data-transcript-loop-withheld="true"
                    >
                        <p className="text-sm font-semibold text-primary">{finalizingBannerText}</p>
                        <p className="max-w-sm text-xs text-foreground/60">{finalizingEmptyDescription}</p>
                    </div>
                ) : hasTranscript || hasInterimTranscript ? (
                    <div
                        className={`text-foreground text-lg leading-relaxed ${isDrafting ? 'rounded-md border border-dashed border-primary/30 bg-primary/5 p-3 text-foreground/80' : ''}`}
                        data-transcript-draft={isDrafting ? 'true' : undefined}
                        aria-label={isDrafting ? 'Draft transcript, still being recognized' : undefined}
                    >
                        {tokens.map((token) => {
                            if (token.type === 'error') {
                                return (
                                    <span key={token.id} className="text-destructive font-bold opacity-80 text-sm tracking-wide">
                                        {token.transcript}
                                    </span>
                                );
                            }
                            if (token.type === 'filler') {
                                return (
                                    <span
                                        key={token.id}
                                        style={{ color: token.color, backgroundColor: `${token.color}15` }}
                                        className="px-1.5 py-0.5 rounded font-bold transition-all border border-current"
                                    >
                                        {token.transcript}
                                    </span>
                                );
                            }
                            return <span key={token.id}>{token.transcript}</span>;
                        })}
                        {/* Settled: completed draft sentences read as recognized, not
                            a wall of Draft. Display only — saved path is unchanged. */}
                        {isListening && hasSettledDraft && (
                            <span
                                className="text-foreground/80"
                                data-testid="live-transcript-settled"
                                data-transcript-settled="true"
                                aria-label="Recognized so far"
                            >
                                {hasTranscript ? ' ' : ''}
                                {settledDraft}
                            </span>
                        )}
                        {/* Active: the in-progress sentence stays clearly Draft. */}
                        {isListening && draftLineText.trim() !== '' && (
                            <span
                                className="italic text-foreground/60"
                                data-testid="live-transcript-current-line"
                                data-transcript-draft="true"
                                aria-label="Draft transcript, still being recognized"
                            >
                                {(hasTranscript || hasSettledDraft) ? ' ' : ''}
                                {draftLineText}
                            </span>
                        )}
                        {showFormattingNotice && (
                            <div
                                className="mt-2 text-xs font-medium text-foreground/55"
                                data-native-formatting-notice="true"
                                aria-live="polite"
                            >
                                Saved — tidying up punctuation…
                            </div>
                        )}
                    </div>
                ) : isFinalizing ? (
                    <div
                        className="flex min-h-[120px] flex-col items-center justify-center gap-2 text-center text-foreground/80"
                        data-testid="live-transcript-finalizing-empty"
                    >
                        <p className="text-sm font-semibold text-primary">{finalizingEmptyTitle}</p>
                        <p className="max-w-sm text-xs text-foreground/60">
                            {finalizingEmptyDescription}
                        </p>
                    </div>
                ) : (
                    <p className="text-sm font-semibold text-foreground/75">Start recording and your words will appear here.</p>
                )}
            </div>
        </div>
    );
};

export default LiveTranscriptPanel;
