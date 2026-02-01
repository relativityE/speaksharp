// components/ui/toast.tsx
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import * as React from "react"

const toastVariants = cva(
  "flex items-start gap-3 rounded-lg shadow-md transition-all",
  {
    variants: {
      variant: {
        info: "bg-info text-info-fg",
        success: "bg-success text-success-fg",
        warning: "bg-warning text-warning-fg",
        error: "bg-danger text-danger-fg",
      },
      size: {
        sm: "p-3 text-sm max-w-xs",
        md: "p-4 text-base max-w-md",
        lg: "p-6 text-lg max-w-lg",
      },
      responsive: {
        true: "sm:max-w-sm md:max-w-md lg:max-w-lg",
      },
    },
    defaultVariants: {
      variant: "info",
      size: "md",
    },
  }
)

export interface ToastProps
  extends React.HTMLAttributes<HTMLDivElement>,
  VariantProps<typeof toastVariants> { }

export const Toast = React.forwardRef<HTMLDivElement, ToastProps>(
  ({ className, variant, size, responsive, ...props }, ref) => {
    return (
      <div ref={ref} className={cn(toastVariants({ variant, size, responsive }), className)} {...props} />
    )
  }
)
Toast.displayName = "Toast"
