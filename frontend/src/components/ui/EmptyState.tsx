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
    testId?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
    title,
    description,
    action,
    secondaryAction,
    icon,
    className,
    testId,
}) => {
    return (
        <div className={cn("flex flex-col items-center justify-center text-center p-8 md:p-12 border-2 border-dashed rounded-xl bg-card/50", className)} data-testid={testId}>
            <div className="flex items-center justify-center w-20 h-20 rounded-full bg-primary/10 mb-6 animate-pulse-ring">
                {icon || (
                    <svg
                        className="w-10 h-10 text-primary"
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
            <h3 className="text-xl font-semibold text-foreground mb-2">{title}</h3>
            <p className="text-muted-foreground max-w-sm mb-8">{description}</p>
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
                <p className="mt-4 text-xs text-muted-foreground">
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
