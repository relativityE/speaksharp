import React from 'react';
import { ArrowUp, ArrowDown, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ProgressIndicatorProps {
    value: number;
    previousValue: number;
    label: string;
    unit?: string;
    inverse?: boolean; // For metrics where lower is better (e.g., filler words)
}

export const ProgressIndicator: React.FC<ProgressIndicatorProps> = ({
    value,
    previousValue,
    label,
    unit = '',
    inverse = false,
}) => {
    const delta = value - previousValue;
    const percentChange = previousValue !== 0 ? (delta / previousValue) * 100 : 0;

    // Determine if this is an improvement
    const isImprovement = inverse ? delta < 0 : delta > 0;
    const isRegression = inverse ? delta > 0 : delta < 0;

    const Icon = delta > 0 ? ArrowUp : delta < 0 ? ArrowDown : Minus;
    const colorClass = isImprovement
        ? 'text-green-500'
        : isRegression
            ? 'text-red-500'
            : 'text-muted-foreground';

    return (
        <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{label}:</span>
            <span className="text-lg font-bold">
                {value}
                {unit}
            </span>
            <div className={cn('flex items-center gap-1 text-sm', colorClass)} data-testid="improvement-indicator">
                <Icon className="h-4 w-4" />
                <span>
                    {Math.abs(percentChange).toFixed(1)}%
                </span>
            </div>
        </div>
    );
};
