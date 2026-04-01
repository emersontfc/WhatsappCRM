import * as React from "react";
import { cn } from "@/src/lib/utils";

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "success" | "warning" | "error" | "info" | "outline";
  pulse?: boolean;
}

const Badge = React.forwardRef<HTMLDivElement, BadgeProps>(
  ({ className, variant = "info", pulse = false, ...props }, ref) => {
    const variants = {
      success: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
      warning: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
      error: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20",
      info: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
      outline: "border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400",
    };

    return (
      <div
        ref={ref}
        className={cn(
          "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-bold transition-colors",
          variants[variant],
          pulse && "animate-pulse-soft",
          className
        )}
        {...props}
      />
    );
  }
);

Badge.displayName = "Badge";

export { Badge };
