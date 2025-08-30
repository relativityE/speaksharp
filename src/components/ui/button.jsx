import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva } from "class-variance-authority";

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-base font-medium transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        // New system classes
        primary: "btn-primary",
        secondary: "btn-secondary",
        accent: "btn-accent",
        ghost: "btn-ghost",
        destructive: "btn-destructive",
        outline: "btn-outline",

        // Legacy aliases (map to new ones)
        // TODO: Deprecate these variants and migrate to new system
        default: "btn-secondary",
        brand: "btn-primary",
        link: "btn-ghost",
      },
      size: {
        // New system sizes
        sm: "btn-sm",
        md: "btn-md",
        lg: "btn-lg",

        // Legacy aliases
        default: "btn-md",
        icon: "size-9", // maintain icon size for now
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  }
)

const Button = React.forwardRef(({
  className,
  variant,
  size,
  asChild = false,
  ...props
}, ref) => {
  const Comp = asChild ? Slot : "button"

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      ref={ref}
      {...props} />
  );
})
Button.displayName = "Button"

export { Button, buttonVariants }
