import React from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Link } from 'react-router-dom';

interface EmptyStateProps {
    title: string;
    description: string;
    action?: {
        label: string;
        href?: string;
        onClick?: () => void;
    };
    /** Optional subtle secondary action (text link or button) */
    secondaryAction?: {
        label: string;
        href?: string;  // Either href or onClick should be provided
        onClick?: () => void;
        prefix?: string;
        testId?: string;
    };
    icon?: React.ReactNode;
    className?: string;
    compact?: boolean;
    testId?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
    title,
    description,
    action,
    secondaryAction,
    icon,
    className,
    compact = false,
    testId,
}) => {
    return (
        <div className={cn("flex flex-col items-center justify-center rounded-xl border border-dashed border-[hsl(var(--border-strong))] bg-white text-center surface-shadow", compact ? "p-6 md:p-6" : "p-8 md:p-12", className)} data-testid={testId}>
            <div className={cn("flex items-center justify-center rounded-full bg-primary/10 animate-pulse-ring", compact ? "mb-4 h-12 w-12" : "mb-6 h-20 w-20")}>
                {icon || (
                    <svg
                        className={cn("text-primary", compact ? "h-6 w-6" : "h-10 w-10")}
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        aria-hidden="true"
                    >
                        <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={1.5}
                            d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
                        />
                    </svg>
                )}
            </div>
            <h3 className={cn("font-semibold text-foreground", compact ? "mb-2 text-lg" : "mb-2 text-xl")}>{title}</h3>
            <p className={cn("font-medium text-foreground/70", compact ? "mb-5 max-w-md text-sm" : "mb-8 max-w-sm")}>{description}</p>
            {action && (
                action.href ? (
                    <Button asChild size="lg" className="font-medium">
                        <Link to={action.href}>{action.label}</Link>
                    </Button>
                ) : (
                    <Button onClick={action.onClick} size="lg" className="font-medium">
                        {action.label}
                    </Button>
                )
            )}
            {/* Subtle secondary action - text link or clickable text */}
            {secondaryAction && (
                <p className="mt-4 text-xs font-medium text-foreground/70">
                    {secondaryAction.prefix && <span>{secondaryAction.prefix} </span>}
                    {secondaryAction.href ? (
                        <Link
                            to={secondaryAction.href}
                            className="text-primary hover:underline"
                            data-testid={secondaryAction.testId}
                        >
                            {secondaryAction.label}
                        </Link>
                    ) : (
                        <button
                            onClick={secondaryAction.onClick}
                            className="text-primary hover:underline cursor-pointer bg-transparent border-none p-0"
                            data-testid={secondaryAction.testId}
                        >
                            {secondaryAction.label}
                        </button>
                    )}
                </p>
            )}
        </div>
    );
};
