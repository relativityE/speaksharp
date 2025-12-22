"use client"

import { useTheme } from "next-themes"
import { Toaster as Sonner } from "sonner"
import type { ComponentProps } from "react"

type ToasterProps = ComponentProps<typeof Sonner>

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg group-[.toaster]:rounded-full group-[.toaster]:w-fit group-[.toaster]:px-6 group-[.toaster]:py-2 group-[.toaster]:mx-auto",
          description: "group-[.toast]:text-foreground group-[.toast]:opacity-100 group-[.toast]:text-base group-[.toast]:font-semibold",
          title: "group-[.toast]:text-lg group-[.toast]:font-black",
          actionButton:
            "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton:
            "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
          // Error: Destructive red with white text
          error: "group-[.toaster]:bg-destructive group-[.toaster]:text-destructive-foreground group-[.toaster]:border-destructive",
          // Success: Secondary orange (vibrant) with white text
          success: "group-[.toaster]:bg-secondary group-[.toaster]:text-secondary-foreground group-[.toaster]:border-secondary",
          // Info: Primary blue with white text
          info: "group-[.toaster]:bg-primary group-[.toaster]:text-primary-foreground group-[.toaster]:border-primary",
          // Warning: Accent teal with white text
          warning: "group-[.toaster]:bg-accent group-[.toaster]:text-accent-foreground group-[.toaster]:border-accent",
          // Loading: Primary blue with white text
          loading: "group-[.toaster]:bg-primary group-[.toaster]:text-primary-foreground group-[.toaster]:border-primary",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
