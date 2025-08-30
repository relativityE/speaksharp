import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const alertVariants = cva(
  'rounded-lg px-4 py-3 shadow-md flex items-center gap-3',
  {
    variants: {
      variant: {
        success: 'bg-success text-success-fg',
        error: 'bg-danger text-danger-fg',
        warning: 'bg-warning text-warning-fg',
        info: 'bg-info text-info-fg',
      },
      size: {
        sm: 'text-sm px-3 py-2',
        md: 'text-base px-4 py-3',
        lg: 'text-lg px-6 py-4',
      },
    },
    defaultVariants: {
      variant: 'info',
      size: 'md',
    },
  }
);

export interface AlertProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof alertVariants> {}

const Alert = React.forwardRef<HTMLDivElement, AlertProps>(
  ({ className, variant, size, ...props }, ref) => {
    return (
      <div
        ref={ref}
        role="alert"
        className={cn(alertVariants({ variant, size }), className)}
        {...props}
      />
    );
  }
);
Alert.displayName = 'Alert';

export { Alert, alertVariants };
