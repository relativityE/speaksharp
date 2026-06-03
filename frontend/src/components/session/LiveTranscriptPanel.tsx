import React from 'react';
import { Lock, Cloud } from 'lucide-react';
import { TEST_IDS } from '@/constants/testIds';
import { SESSION_INSET_SURFACE_CLASS, SESSION_SURFACE_CLASS } from './sessionSurface';

import { parseTranscriptForHighlighting } from '@/utils/highlightUtils';

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
}) => {
    const tokens = parseTranscriptForHighlighting(transcript, userWords);
    const hasTranscript = transcript.trim() !== '';
    const displayInterimTranscript =
        transcript.trim() === interimTranscript.trim() ? '' : interimTranscript;
    const hasInterimTranscript = displayInterimTranscript.trim() !== '';
    const livePreviewText = displayInterimTranscript.trim();

    // Discrete UI state for styling + browser-test assertions.
    const uiState: LiveTranscriptUiState = isFinalizing
        ? 'finalizing'
        : isListening
            ? (hasInterimTranscript || hasTranscript ? 'drafting' : 'listening')
            : (hasTranscript ? 'final' : 'idle');
    const isDrafting = uiState === 'drafting';
    const showDraftTrustBanner = isListening && !isFinalizing;
    const showPrivateFeedback = sttMode === 'private' && isListening;
    const privateStatus = hasTranscript || hasInterimTranscript ? 'Live text' : 'Private local';
    const visibleTranscript = [transcript.trim(), displayInterimTranscript.trim()].filter(Boolean).join(' ').trim();

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

    return (
        <div
            className={`${SESSION_SURFACE_CLASS} p-4 flex flex-col ${className}`}
            data-testid={TEST_IDS.TRANSCRIPT_PANEL}
        >
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
                        Processing speech locally…
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
                        <span className="ml-2 text-xs text-foreground/60">Text may change before the final transcript is saved.</span>
                    </div>
                )}

                {isListening && livePreviewText && (
                    <div
                        className="mb-3 rounded-md border border-dashed border-primary/25 bg-primary/5 px-3 py-2 text-sm font-medium italic leading-relaxed text-foreground/70"
                        data-testid="live-transcript-current-line"
                        data-transcript-draft="true"
                        aria-label="Draft transcript, still being recognized"
                    >
                        {livePreviewText}
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
                    sttMode === 'private' ? (
                        <div className="flex min-h-[120px] flex-col items-center justify-center gap-3 text-center text-foreground/80">
                            <div className={`relative flex h-14 w-14 items-center justify-center rounded-full border border-primary/25 bg-primary/5 ${hasSpeechActivity ? 'shadow-[0_0_0_8px_hsl(var(--primary)/0.08)]' : ''}`}>
                                {hasSpeechActivity && <span className="absolute inset-0 rounded-full border border-primary/30 animate-ping" />}
                                <WaveformMeter level={micLevel} isProcessing={hasSpeechActivity} />
                            </div>
                            <p className={hasSpeechActivity ? 'text-primary font-medium' : 'animate-pulse'}>
                                {hasSpeechActivity ? 'Processing speech locally…' : 'Listening locally…'}
                            </p>
                        </div>
                    ) : (
                        <p className="text-sm font-semibold text-foreground/75 animate-pulse">Listening...</p>
                    )
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
                        {isListening && hasInterimTranscript && (
                            <span
                                className="italic text-foreground/60"
                                data-transcript-draft="true"
                                aria-label="Draft transcript, still being recognized"
                            >
                                {hasTranscript ? ' ' : ''}
                                {displayInterimTranscript}
                            </span>
                        )}
                    </div>
                ) : isFinalizing ? (
                    <div
                        className="flex min-h-[120px] flex-col items-center justify-center gap-2 text-center text-foreground/80"
                        data-testid="live-transcript-finalizing-empty"
                    >
                        <p className="text-sm font-semibold text-primary">Finalizing local transcript…</p>
                        <p className="max-w-sm text-xs text-foreground/60">
                            Your final transcript will appear here when local processing finishes.
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
