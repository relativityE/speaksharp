import { ArrowRight } from 'lucide-react';

const LOOP_STEPS = ['Speak', 'Feedback', 'Practice again'] as const;

/**
 * #1475 G12 Rev 2 §2 section 4 and §6 — "Private, and built to repeat". The Practice Loop column sits on ink because
 * it is the product's mechanism, not a third privacy bullet; its last chip is the action, in signature yellow.
 *
 * Rev 2's "Last run only" column is deliberately absent (ruling C on #1475): the PM ACCEPT correction forbids a fixed
 * retention count on the homepage, and newest-one retention is not activated on Production.
 */
export const PrivateRepeatSection = () => (
    <section
        aria-label="Private, and built to repeat"
        className="w-full bg-neutral-page px-5 pb-12 pt-[42px] md:px-7 lg:px-[34px]"
    >
        <h2 className="mb-6 text-xs font-extrabold uppercase tracking-[0.1em] text-neutral-secondary">
            Private, and built to repeat
        </h2>
        <div className="flex flex-wrap items-start gap-[30px]">
            <div className="min-w-0 flex-[1_1_220px]">
                <h3 className="mb-[9px] text-[22px] font-extrabold tracking-[-0.03em] text-neutral-heading md:text-[26px]">
                    Never uploaded
                </h3>
                <p className="text-[17px] font-medium leading-[1.6] text-neutral-body">
                    Your practice audio stays on your device. There is no recording to leak or delete.
                </p>
            </div>
            <div
                role="region"
                aria-label="The Practice Loop"
                className="min-w-0 flex-[1.25_1_270px] rounded-[14px] bg-ink px-6 pb-6 pt-[22px]"
            >
                <h3 className="mb-[9px] text-[22px] font-extrabold tracking-[-0.03em] text-signature md:text-[26px]">
                    The Practice Loop
                </h3>
                <p className="mb-[18px] text-[17px] font-medium leading-[1.6] text-ink-text">
                    Every run ends with one thing to change — then you run it again. Same loop in Open Mic and Focus Points.
                </p>
                <ol className="flex flex-wrap items-center gap-[10px]">
                    {LOOP_STEPS.map((step, index) => (
                        <li key={step} className="flex items-center gap-[10px]">
                            <span
                                className={`inline-flex items-center rounded-lg px-[13px] py-2 text-[13px] font-extrabold ${
                                    index === LOOP_STEPS.length - 1
                                        ? 'bg-signature text-ink'
                                        : 'border border-ink-hairline bg-ink-raised text-ink-text'
                                }`}
                            >
                                {step}
                            </span>
                            {index < LOOP_STEPS.length - 1 && (
                                <ArrowRight className="size-[14px] shrink-0 text-signature" aria-hidden="true" />
                            )}
                        </li>
                    ))}
                </ol>
            </div>
        </div>
    </section>
);
