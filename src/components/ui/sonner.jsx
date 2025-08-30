import { useTheme } from "next-themes";
import { Toaster as Sonner } from "sonner";
import { toastVariants } from "./toast.tsx";
import { buttonVariants } from "./button.tsx";

const Toaster = ({ ...props }) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme}
      className="toaster group"
      position="mid-right"
      toastOptions={{
        classNames: {
          toast: toastVariants(),
          description: "text-sm",
          success: toastVariants({ variant: "success" }),
          info: toastVariants({ variant: "info" }),
          warning: toastVariants({ variant: "warning" }),
          error: toastVariants({ variant: "error" }),
          actionButton: buttonVariants({ variant: "primary", size: "sm" }),
          cancelButton: buttonVariants({ variant: "outline", size: "sm" }),
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
