import React from 'react';
import { cn } from '@/lib/utils';

interface FadeInProps {
    children: React.ReactNode;
    className?: string;
    delay?: number; // Delay in ms
    direction?: 'up' | 'down' | 'left' | 'right' | 'none';
}

export const FadeIn: React.FC<FadeInProps> = ({
    children,
    className,
    delay = 0,
    direction = 'up'
}) => {
    const directionClasses = {
        up: 'slide-in-from-bottom-4',
        down: 'slide-in-from-top-4',
        left: 'slide-in-from-right-4',
        right: 'slide-in-from-left-4',
        none: '',
    };

    return (
        <div
            className={cn(
                "animate-in fade-in duration-700 fill-mode-forwards opacity-0",
                directionClasses[direction],
                className
            )}
            style={{ animationDelay: `${delay}ms`, animationFillMode: 'forwards' }}
        >
            {children}
        </div>
    );
};
