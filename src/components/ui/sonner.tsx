import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { Toaster as Sonner, type ToasterProps } from "sonner";

/**
 * `theme` is fixed rather than read from a theme provider. This app has no provider and
 * `index.html` hard-codes `class="dark"`, so asking for the *system* theme — which is what the
 * shadcn default did — put light toasts on top of a dark app for anyone whose machine was set
 * to light. Whoever gives the shell a light mode should change this at the same time.
 */
const Toaster = ({ ...props }: ToasterProps) => (
  <Sonner
    theme="dark"
    className="toaster group"
    icons={{
      success: <CircleCheckIcon className="size-4" />,
      info: <InfoIcon className="size-4" />,
      warning: <TriangleAlertIcon className="size-4" />,
      error: <OctagonXIcon className="size-4" />,
      loading: <Loader2Icon className="size-4 animate-spin" />,
    }}
    style={
      {
        "--normal-bg": "var(--popover)",
        "--normal-text": "var(--popover-foreground)",
        "--normal-border": "var(--border)",
        "--border-radius": "var(--radius)",
      } as React.CSSProperties
    }
    toastOptions={{
      classNames: {
        toast: "cn-toast",
      },
    }}
    {...props}
  />
);

export { Toaster };
