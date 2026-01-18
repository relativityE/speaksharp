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
            "group toast group-[.toaster]:bg-orange-500 group-[.toaster]:text-black group-[.toaster]:border-orange-500 group-[.toaster]:shadow-lg group-[.toaster]:rounded-full group-[.toaster]:w-fit group-[.toaster]:px-4 group-[.toaster]:py-1.5 group-[.toaster]:mx-auto group-[.toaster]:text-sm group-[.toaster]:font-semibold",
          description: "group-[.toast]:text-black group-[.toast]:opacity-90 group-[.toast]:text-sm group-[.toast]:font-medium",
          title: "group-[.toast]:text-base group-[.toast]:font-bold group-[.toast]:text-black",
          actionButton:
            "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton:
            "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
          // Error: Destructive red with white text (keep for visibility)
          error: "group-[.toaster]:bg-destructive group-[.toaster]:text-white group-[.toaster]:border-destructive",
          // Success: Bright orange with black text
          success: "group-[.toaster]:bg-orange-500 group-[.toaster]:text-black group-[.toaster]:border-orange-500",
          // Info: Bright orange with black text  
          info: "group-[.toaster]:bg-orange-500 group-[.toaster]:text-black group-[.toaster]:border-orange-500",
          // Warning: Bright orange with black text
          warning: "group-[.toaster]:bg-orange-500 group-[.toaster]:text-black group-[.toaster]:border-orange-500",
          // Loading: Bright orange with black text
          loading: "group-[.toaster]:bg-orange-500 group-[.toaster]:text-black group-[.toaster]:border-orange-500",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
