import * as React from "react";
import { cn } from "@/src/lib/utils";

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "success" | "warning" | "error" | "info" | "outline";
  pulse?: boolean;
}

const Badge = React.forwardRef<HTMLDivElement, BadgeProps>(
  ({ className, variant = "info", pulse = false, ...props }, ref) => {
    const variants = {
      success: "bg-emerald-600 text-white border-emerald-600 shadow-lg shadow-emerald-600/20",
      warning: "bg-amber-500 text-white border-amber-500 shadow-lg shadow-amber-500/20",
      error: "bg-red-600 text-white border-red-600 shadow-lg shadow-red-600/20",
      info: "bg-slate-900 text-white border-slate-900 shadow-lg shadow-slate-900/20",
      outline: "border-2 border-slate-100 text-slate-600 bg-white",
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
