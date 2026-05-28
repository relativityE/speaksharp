"use client"

import { useTheme } from "next-themes"
import { Toaster as Sonner } from "sonner"
import type { ComponentProps } from "react"

type ToasterProps = ComponentProps<typeof Sonner>

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={(theme === "dark" ? "light" : theme) as ToasterProps["theme"]}
      className="toaster group"
      toastOptions={{
        duration: 3500,
        classNames: {
          toast:
            "group toast surface-shadow group-[.toaster]:bg-white group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:rounded-xl group-[.toaster]:px-4 group-[.toaster]:py-3 group-[.toaster]:text-sm group-[.toaster]:font-medium",
          description: "group-[.toast]:!text-slate-600 group-[.toast]:!opacity-100 group-[.toast]:text-[13px] group-[.toast]:font-normal group-[.toast]:leading-snug group-[.toast]:line-clamp-2",
          title: "group-[.toast]:text-sm group-[.toast]:font-semibold group-[.toast]:text-foreground group-[.toast]:leading-tight",
          actionButton:
            "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton:
            "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
          error: "group-[.toaster]:bg-red-50 group-[.toaster]:text-red-900 group-[.toaster]:border-red-200",
          success: "group-[.toaster]:bg-emerald-50 group-[.toaster]:text-emerald-900 group-[.toaster]:border-emerald-200",
          info: "group-[.toaster]:bg-white group-[.toaster]:text-foreground group-[.toaster]:border-border",
          warning: "group-[.toaster]:bg-amber-50 group-[.toaster]:text-amber-900 group-[.toaster]:border-amber-200",
          loading: "group-[.toaster]:bg-white group-[.toaster]:text-foreground group-[.toaster]:border-primary/60",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
