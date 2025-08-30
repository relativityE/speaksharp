import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center justify-center font-semibold rounded-full px-2 py-1 text-xs',
  {
    variants: {
      variant: {
        primary: 'bg-primary text-primary-fg',
        secondary: 'bg-secondary text-secondary-fg',
        success: 'bg-success text-success-fg',
        error: 'bg-danger text-danger-fg',
        accent: 'bg-accent text-accent-fg',
        outline: 'border border-input',
      },
      size: {
        sm: 'text-xs px-2 py-1',
        md: 'text-sm px-3 py-1',
        lg: 'text-base px-4 py-2',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

const Badge = React.forwardRef<HTMLDivElement, BadgeProps>(
  ({ className, variant, size, ...props }, ref) => {
    return <div ref={ref} className={cn(badgeVariants({ variant, size }), className)} {...props} />;
  }
);
Badge.displayName = 'Badge';

export { Badge, badgeVariants };
