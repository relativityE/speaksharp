/** #1475 G12 — the Practice Loop. In the light body this is the ONLY ink card. */
const STEPS = [
    { name: 'Speak', detail: 'Record a take in Open Mic or Focus Points.' },
    { name: 'Feedback', detail: 'See what to fix from that take.' },
    { name: 'Practice again', detail: 'Say it again with one thing to work on.' },
] as const;

export const PracticeLoopSection = () => (
    <section aria-label="Practice Loop" className="w-full bg-background pb-14 md:pb-20">
        <div className="mx-auto max-w-5xl px-4 md:px-6">
            <div className="rounded-lg bg-landing-ink p-6 text-landing-ink-foreground md:p-10">
                <h2 className="text-3xl font-bold tracking-tight [text-wrap:balance] sm:text-4xl">The Practice Loop</h2>
                <ol className="mt-8 grid gap-6 md:grid-cols-3">
                    {STEPS.map((step, index) => (
                        <li key={step.name} className="flex min-w-0 flex-col gap-2">
                            <span className="text-sm font-semibold uppercase tracking-[0.12em] text-landing-signature">
                                {index + 1}
                                <span aria-hidden="true">{index < STEPS.length - 1 ? ' →' : ''}</span>
                            </span>
                            <span className="text-2xl font-bold">{step.name}</span>
                            <span className="text-[17px] leading-relaxed text-landing-ink-muted">{step.detail}</span>
                        </li>
                    ))}
                </ol>
            </div>
        </div>
    </section>
);
