import { cva } from 'class-variance-authority';

export const badgeVariants = cva(
  'inline-flex items-center justify-center font-semibold rounded-full px-2 py-1 text-xs',
  {
    variants: {
      variant: {
        primary: 'bg-primary text-primary-fg',
        secondary: 'bg-secondary text-secondary-fg',
        'secondary-outline': 'bg-secondary/10 text-secondary border-secondary/30 border',
        destructive: 'bg-danger text-danger-fg',
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