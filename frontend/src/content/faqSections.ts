/**
 * Shared FAQ content (#1200 / #1222).
 *
 * This is the single source of truth for the in-app FAQ copy. It was extracted out of
 * the former standalone FaqPage so the FAQ can be rendered inline from the global nav
 * (see @/components/faq/FaqMenu) on whatever page the user is currently on, with no
 * navigation and no dedicated /faq route.
 *
 * Every answer is a product claim, so each one is checked against the contract it describes
 * (2026-09-18 currentization). If a contract changes, change the answer in the same PR:
 *   - Progress: the headline is the change in CLARITY versus the previous comparable session
 *     (`loadSessionProgress` deltaPoints = clarityRaw − previous), the first eligible session is
 *     the baseline, and clarity = 100 − filler rate × 1.5 − 3 per [inaudible]-style marker − a pace
 *     penalty outside ~90–170 wpm (`20260812030000_progress_cohort_mode_separation_1265.sql`).
 *     Pause rhythm is NOT an input.
 *   - Eligibility: ≥30 s AND ≥75 words, a saved transcript, clarity evidence, verified engine
 *     attribution and a complete engine identity; a changed setup restarts the comparison.
 *   - Recording length: capped at 15 minutes (`MAX_UTTERANCE_SECONDS: 900`).
 *   - Audio: processed in memory on the device, never uploaded or saved.
 *   - Retention: no deletion schedule is claimed here — newest-one retention is installed inert.
 */

export interface FaqItem {
    /** Stable slug — drives the per-item anchor/test hooks. */
    id: string;
    question: string;
    /** Paragraphs; each renders as its own <p>. */
    answer: string[];
}

export interface FaqSection {
    id: string;
    title: string;
    items: FaqItem[];
}

export const FAQ_SECTIONS: readonly FaqSection[] = [
    {
        id: 'privacy',
        title: 'Your privacy',
        items: [
            {
                id: 'audio-private',
                question: 'Is my audio private?',
                answer: [
                    'Yes. Your speech is transcribed inside your browser, on your device. The audio is processed in memory while you record and is never uploaded or saved — which is also why there is no recording to play back.',
                ],
            },
            {
                id: 'model-download',
                question: 'Why does Private transcription download a model?',
                answer: [
                    'The speech model runs on your device, so your browser downloads it the first time. You will see its progress on the mic, and the mic unlocks as soon as it is ready.',
                    'Your browser normally keeps it, so later sessions usually start without downloading it again. It can download again if the browser clears this site’s storage or runs short of space.',
                ],
            },
            {
                id: 'what-is-saved',
                question: 'What is saved after a session?',
                answer: [
                    'The session’s text transcript and its measurements — words, fillers, pace — plus your review, so you can come back to them. Audio is never saved.',
                ],
            },
        ],
    },
    {
        id: 'progress',
        title: 'Your progress',
        items: [
            {
                id: 'how-progress-measured',
                question: 'How is my progress measured?',
                answer: [
                    'Progress follows one clarity score from your own session. Filler words lower it, so do stretches the transcript marks as unclear, such as [inaudible], and so does a pace far outside roughly 90–170 words per minute.',
                    'Each session is compared with your previous qualifying session recorded the same way — same practice mode and transcription setup. It is a personal read, never a grade or a comparison with other people.',
                ],
            },
            {
                id: 'first-session-no-percent',
                question: 'Why doesn’t my first session show a progress percentage?',
                answer: [
                    'A percentage is a change, and your first qualifying session has nothing before it — so it shows “baseline set” instead. From your second qualifying session on, you see the change versus the one before.',
                ],
            },
            {
                id: 'why-not-counted',
                question: 'Why wasn’t my session counted toward progress?',
                answer: [
                    'A session counts only when there is enough to measure fairly: at least 30 seconds and 75 words, a saved transcript, clear filler and clarity evidence, and a verified record of which transcription model produced it. Anything less is left out rather than given an invented number.',
                    'If your transcription setup changed since your last qualifying session, the comparison restarts rather than comparing unlike recordings.',
                ],
            },
            {
                id: 'filler-words',
                question: 'What counts as a filler word?',
                answer: [
                    'Words that interrupt your flow — "um", "uh", "like", "you know". SpeakSharp detects them live so you can see your own patterns, and you can add your own in session settings.',
                ],
            },
        ],
    },
    {
        id: 'basics',
        title: 'The basics',
        items: [
            {
                id: 'open-floor-vs-focus-points',
                question: 'What is the difference between Open Mic and Focus Points?',
                answer: [
                    'Open Mic — speak freely on anything, up to 15 minutes per recording. Good for warming up or thinking out loud.',
                    'Focus Points — list the points you want to cover, then speak. Afterwards each point shows whether your transcript has evidence you covered it.',
                ],
            },
            {
                id: 'focus-points-detect',
                question: 'What can Focus Points detect?',
                answer: [
                    'It looks in your transcript for wording that matches each point. “Covered” means matching words were found — not that you made the point well — and an unusual phrasing can be missed.',
                ],
            },
            {
                id: 'review-status',
                question: 'Why is my review still coming, or unavailable?',
                answer: [
                    'Your review is written after the session saves, so it can take a moment, and it retries automatically if it is delayed.',
                    'While you wait — or if it can’t be written — your filler and pace counts still show, because they are counted on your device and never depended on the network.',
                ],
            },
            {
                id: 'report-problem',
                question: 'How do I report a wrong count or another problem?',
                answer: [
                    'Use Share feedback in the menu, choose “Something broke”, and say what you saw. Your transcript and audio aren’t attached automatically.',
                ],
            },
        ],
    },
];
