/**
 * Shared FAQ content (#1200 / #1222).
 *
 * This is the single source of truth for the in-app FAQ copy. It was extracted out of
 * the former standalone FaqPage so the FAQ can be rendered inline from the global nav
 * (see @/components/faq/FaqMenu) on whatever page the user is currently on, with no
 * navigation and no dedicated /faq route.
 *
 * Keep the copy verbatim — the explanations here are the canonical wording for privacy,
 * progress, and the two practice modes.
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
                id: 'private-transcription',
                question: 'How does transcription work — and is it private?',
                answer: [
                    'SpeakSharp transcribes your speech on your own device. Your audio stays local; it is never uploaded to a server.',
                    'There is nothing to set up or choose — every session uses this private, on-device transcription.',
                ],
            },
            {
                id: 'what-is-private-stt',
                question: 'What is Private transcription, and why does it download something the first time?',
                answer: [
                    'Private transcription (Private STT) is a small speech-to-text model that runs entirely inside your browser. The first time you use it, that model is downloaded to your device — a one-time step. You will see the download progress on the mic card, and the mic unlocks as soon as it is ready.',
                    'After that first download the model is cached, so later sessions start quickly. Because the model runs locally, your audio is processed on your device and never sent to us or anyone else — that is what makes it private.',
                ],
            },
            {
                id: 'audio-stored',
                question: 'Is my audio recorded or stored?',
                answer: [
                    'No. The transcription runs live on your device and your audio is not saved or sent anywhere. What you keep is the text transcript and the practice signals from your session.',
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
                    'Session progress is one percentage built — in the open — from four signals we measure in your own session: filler rate (filler words per minute), clarity, speaking pace (words per minute), and pause rhythm. Nothing hidden feeds it.',
                    'Combining these four levels out the natural swing of any single one, so the number is steadier and harder to game. It compares this session with your previous session — a personal, session-over-session read, never a grade or a comparison with other people.',
                    'The number stays in the background. What matters most is the review: two things that went well and two things to improve, drawn from what you actually did this session. Acting on one improvement next time is the real goal.',
                ],
            },
            {
                id: 'baseline-signal',
                question: 'What is the "baseline signal"?',
                answer: [
                    'Your first session is your starting point: it is a combined reading of the same four signals — filler rate, clarity, speaking pace, and pause rhythm — taken together. Because there is nothing earlier to compare it with, your first session shows this reading instead of a change percentage.',
                    'From your next session on, progress is shown as the change in those four signals versus the session right before it — not versus your first session. If a signal is too short or has no usable evidence, we leave it out rather than invent a number — again, in the interest of showing you only what we can actually measure.',
                ],
            },
            {
                id: 'first-session-no-percent',
                question: 'Why doesn’t my first session show a progress percentage?',
                answer: [
                    'A percentage is always a change versus an earlier session, and your first session has nothing before it to compare against — so it shows “baseline set”, not a number. This is by design, for every user.',
                    'You start seeing a progress percentage from your second qualifying session onward, and it is always the change versus your previous session. A session qualifies once it is long enough to measure (about 30 seconds); very short takes are skipped so a stray few seconds never sets or moves your progress. So if you already see a percentage like “+5% vs your previous session”, it means your account has at least two qualifying sessions on record.',
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
                    'Open Mic — speak freely on anything, for as long as you like. Best for warming up or thinking out loud.',
                    'Focus Points — set a few things you want to cover, then see which ones you actually hit while speaking.',
                ],
            },
        ],
    },
];
