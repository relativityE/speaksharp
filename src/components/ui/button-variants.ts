import { cva } from "class-variance-authority";

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary-light shadow-md hover:shadow-elegant transform hover:-translate-y-0.5",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline: "border border-border bg-card text-foreground hover:bg-muted hover:border-primary/30",
        secondary: "bg-gradient-secondary text-secondary-foreground hover:opacity-90 shadow-md hover:shadow-elegant transform hover:-translate-y-0.5",
        accent: "bg-gradient-accent text-accent-foreground hover:opacity-90 shadow-md hover:shadow-elegant transform hover:-translate-y-0.5",
        hero: "bg-gradient-hero text-white font-semibold shadow-elegant hover:shadow-2xl transform hover:-translate-y-1 hover:scale-105 transition-all duration-300",
        ghost: "hover:bg-muted text-foreground hover:text-primary",
        link: "text-primary underline-offset-4 hover:underline hover:text-primary-light",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3",
        lg: "h-11 rounded-md px-8",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);
