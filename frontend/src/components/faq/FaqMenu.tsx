import { useState } from 'react';
import { ChevronDown, HelpCircle } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { FAQ_SECTIONS } from '@/content/faqSections';

/**
 * Inline FAQ (#1200 / #1222).
 *
 * The FAQ is NOT a page and never navigates away. A "FAQ" trigger lives in the global
 * nav; clicking it drops the content open — as an accordion — on whatever page the user
 * is currently on.
 *
 * The dropdown is backed by the shared Popover primitive (Radix), which gives us the
 * accessibility contract for free: Escape and outside-click dismiss the panel, focus
 * returns to the trigger on close, and the trigger/panel are wired with the right ARIA.
 * The per-question disclosure state is local — each question button toggles its own
 * answer, and multiple can be open at once.
 */
export function FaqMenu() {
    const [openItems, setOpenItems] = useState<ReadonlySet<string>>(() => new Set());

    const toggleItem = (id: string) => {
        setOpenItems((prev) => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    };

    return (
        <Popover>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    data-testid="faq-trigger"
                    className="nav-item"
                >
                    <HelpCircle className="h-4 w-4" aria-hidden="true" />
                    <span>FAQ</span>
                </button>
            </PopoverTrigger>
            <PopoverContent
                align="end"
                data-testid="faq-panel"
                aria-label="Frequently asked questions"
                className="max-h-[70vh] w-[min(92vw,28rem)] overflow-y-auto border-[#dbe2ec] bg-card p-0 shadow-lg"
            >
                <div className="border-b border-[#dbe2ec] px-4 py-3">
                    <h2 className="text-sm font-bold tracking-tight text-foreground">
                        Frequently asked questions
                    </h2>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                        Short answers to how SpeakSharp works.
                    </p>
                </div>
                <div className="px-2 py-2">
                    {FAQ_SECTIONS.map((section) => (
                        <section
                            key={section.id}
                            data-testid={`faq-section-${section.id}`}
                            aria-labelledby={`faq-section-heading-${section.id}`}
                            className="px-2 py-1"
                        >
                            <h3
                                id={`faq-section-heading-${section.id}`}
                                className="px-1 pb-1 pt-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground"
                            >
                                {section.title}
                            </h3>
                            <div className="divide-y divide-[#dbe2ec] rounded-lg border border-[#dbe2ec] bg-white">
                                {section.items.map((item) => {
                                    const isOpen = openItems.has(item.id);
                                    const answerId = `faq-answer-${item.id}`;
                                    return (
                                        <div key={item.id}>
                                            <button
                                                type="button"
                                                data-testid="faq-question"
                                                aria-expanded={isOpen}
                                                aria-controls={answerId}
                                                onClick={() => toggleItem(item.id)}
                                                className="flex w-full cursor-pointer items-center justify-between gap-3 px-3 py-3 text-left text-sm font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                                            >
                                                <span>{item.question}</span>
                                                <ChevronDown
                                                    aria-hidden="true"
                                                    className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
                                                />
                                            </button>
                                            {isOpen && (
                                                <div
                                                    id={answerId}
                                                    data-testid="faq-answer"
                                                    className="space-y-2 px-3 pb-3 text-sm leading-relaxed text-muted-foreground"
                                                >
                                                    {item.answer.map((paragraph, i) => (
                                                        <p key={i}>{paragraph}</p>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </section>
                    ))}
                </div>
            </PopoverContent>
        </Popover>
    );
}

export default FaqMenu;
