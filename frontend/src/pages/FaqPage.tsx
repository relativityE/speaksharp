import React from 'react';
import { ChevronDown } from 'lucide-react';

/**
 * In-app FAQ / help home (#1200).
 *
 * This is the single place explanations live. Detail that used to sit in per-surface
 * "?" popovers and in the paragraphs embedded in the session mic card is consolidated
 * here so the session UI can stay scannable — the "?" affordances retire into this page
 * rather than each carrying its own copy.
 *
 * Rendered with native <details>/<summary> disclosure: keyboard-operable and
 * screen-reader-labelled with no ARIA wiring, and readable with JS disabled.
 */
interface FaqItem {
    /** Stable slug — drives the per-item test id and the deep-link anchor. */
    id: string;
    question: string;
    /** Paragraphs; each renders as its own <p>. */
    answer: string[];
}

interface FaqGroup {
    id: string;
    title: string;
    items: FaqItem[];
}

const FAQ_GROUPS: readonly FaqGroup[] = [
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
                    'Combining these four levels out the natural swing of any single one, so the number is steadier and harder to game. It compares this session with your baseline (your first session) — a personal, session-over-session read, never a grade or a comparison with other people.',
                    'The number is deliberately in the background. What matters most is the two takeaways — what worked and what to try next — drawn straight from what you actually did this session. Acting on those next time is the real goal.',
                ],
            },
            {
                id: 'baseline-signal',
                question: 'What is the "baseline signal"?',
                answer: [
                    'The baseline signal is your first session’s combined reading of the same four signals — filler rate, clarity, speaking pace, and pause rhythm — taken together as your personal starting point. Because there is nothing earlier to compare it with, your first session shows this baseline signal instead of a change percentage.',
                    'From your next session on, progress is shown as the change in those four signals versus this baseline. If a signal is too short or has no usable evidence, we leave it out rather than invent a number — again, in the interest of showing you only what we can actually measure.',
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
                question: 'What is the difference between Open Floor and Focus Points?',
                answer: [
                    'Open Floor — speak freely on anything, for as long as you like. Best for warming up or thinking out loud.',
                    'Focus Points — set a few things you want to cover, then see which ones you actually hit while speaking.',
                ],
            },
        ],
    },
];

const FaqItemRow: React.FC<{ item: FaqItem }> = ({ item }) => (
    <details
        id={`faq-${item.id}`}
        data-testid={`faq-item-${item.id}`}
        className="group border-b border-border last:border-b-0"
    >
        <summary
            className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 text-left text-base font-semibold text-foreground marker:content-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
        >
            <span>{item.question}</span>
            <ChevronDown
                aria-hidden="true"
                className="h-5 w-5 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-180"
            />
        </summary>
        <div className="space-y-2 pb-4 text-sm leading-relaxed text-muted-foreground">
            {item.answer.map((paragraph, i) => (
                <p key={i}>{paragraph}</p>
            ))}
        </div>
    </details>
);

const FaqPage: React.FC = () => (
    <main
        data-testid="faq-page"
        className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6 lg:py-14"
    >
        <header className="mb-8">
            <h1 className="text-3xl font-bold tracking-tight text-foreground">
                Frequently asked questions
            </h1>
            <p className="mt-2 text-base text-muted-foreground">
                Short answers to how SpeakSharp works. Can&apos;t find what you need? Use the
                report button in the top bar to reach us.
            </p>
        </header>

        <div className="space-y-8">
            {FAQ_GROUPS.map((group) => (
                <section key={group.id} data-testid={`faq-group-${group.id}`} aria-labelledby={`faq-group-heading-${group.id}`}>
                    <h2
                        id={`faq-group-heading-${group.id}`}
                        className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground"
                    >
                        {group.title}
                    </h2>
                    <div className="rounded-xl border border-border bg-card px-5 shadow-sm">
                        {group.items.map((item) => (
                            <FaqItemRow key={item.id} item={item} />
                        ))}
                    </div>
                </section>
            ))}
        </div>
    </main>
);

export default FaqPage;
