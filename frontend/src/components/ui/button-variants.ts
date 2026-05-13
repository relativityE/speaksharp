import { cva } from "class-variance-authority";

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-semibold ring-offset-background transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-[#D97706] shadow-[0_4px_12px_rgba(245,158,11,0.25)] hover:shadow-[0_8px_18px_rgba(245,158,11,0.25)] transform hover:-translate-y-0.5",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90 shadow-sm hover:shadow-md",
        outline: "border border-border bg-white text-foreground hover:bg-muted hover:border-primary/50 shadow-sm",
        secondary: "bg-white text-foreground border border-border hover:bg-muted shadow-sm hover:shadow-md transform hover:-translate-y-0.5",
        accent: "bg-accent text-accent-foreground hover:bg-accent/90 shadow-md hover:shadow-lg transform hover:-translate-y-0.5",
        ghost: "text-muted-foreground hover:bg-muted hover:text-foreground",
        link: "text-primary underline-offset-4 hover:underline",
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
  }
);
