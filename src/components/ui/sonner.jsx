import { useTheme } from "next-themes" import { Toaster as Sonner } from "sonner";

const Toaster = ({ ...props }) => { const { theme = "system" } = useTheme()

return ( <Sonner theme={theme} className="toaster group" position="mid-right" toastOptions={{ classNames: { toast: "group toast group-[.toaster]:bg-gray-700 dark:group-[.toaster]:bg-gray-800 group-[.toaster]:text-white group-[.toaster]:border-border group-[.toaster]:shadow-lg group-[.toaster]:text-base-xl group-[.toaster]:px-6 group-[.toaster]:py-3 rounded-full", description: "group-[.toast]:text-muted-foreground", actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground", cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground", }, }} {...props} /> ); }

export { Toaster }
