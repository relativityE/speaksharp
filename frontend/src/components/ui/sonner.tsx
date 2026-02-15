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
            "group toast group-[.toaster]:bg-yellow-400 group-[.toaster]:text-black group-[.toaster]:border-yellow-400 group-[.toaster]:shadow-xl group-[.toaster]:rounded-lg group-[.toaster]:px-4 group-[.toaster]:py-2 group-[.toaster]:text-sm group-[.toaster]:font-semibold",
          description: "group-[.toast]:text-black group-[.toast]:opacity-90 group-[.toast]:text-sm group-[.toast]:font-medium",
          title: "group-[.toast]:text-base group-[.toast]:font-bold group-[.toast]:text-black",
          actionButton:
            "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton:
            "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
          // Error: Destructive red with white text (keep for visibility)
          error: "group-[.toaster]:bg-destructive group-[.toaster]:text-white group-[.toaster]:border-destructive",
          // Success: Bright yellow with black text
          success: "group-[.toaster]:bg-yellow-400 group-[.toaster]:text-black group-[.toaster]:border-yellow-400",
          // Info: Bright yellow with black text  
          info: "group-[.toaster]:bg-yellow-400 group-[.toaster]:text-black group-[.toaster]:border-yellow-400",
          // Warning: Bright yellow with black text
          warning: "group-[.toaster]:bg-yellow-400 group-[.toaster]:text-black group-[.toaster]:border-yellow-400",
          // Loading: Bright yellow with black text
          loading: "group-[.toaster]:bg-yellow-400 group-[.toaster]:text-black group-[.toaster]:border-yellow-400",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
