import React from "react";
import { cn } from "../lib/utils";

interface AgentXLogoProps {
  variant?: "horizontal" | "compact" | "badge";
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
  inverted?: boolean;
}

export const AgentXIcon = ({ size = 28, className }: { size?: number; className?: string }) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("shrink-0", className)}
    >
      <defs>
        <linearGradient id="kazixGrad1" x1="4" y1="4" x2="44" y2="44" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#10B981" />
          <stop offset="50%" stopColor="#06B6D4" />
          <stop offset="100%" stopColor="#6366F1" />
        </linearGradient>
        <linearGradient id="kazixGrad2" x1="44" y1="4" x2="4" y2="44" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#6366F1" />
          <stop offset="50%" stopColor="#06B6D4" />
          <stop offset="100%" stopColor="#10B981" />
        </linearGradient>
        <filter id="kazixGlow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>
      </defs>

      {/* Outer rounded geometric container */}
      <rect x="2" y="2" width="44" height="44" rx="14" fill="#0F172A" />
      <rect x="2" y="2" width="44" height="44" rx="14" stroke="url(#kazixGrad1)" strokeWidth="1.5" strokeOpacity="0.4" />

      {/* Dynamic diagonal X beams */}
      <path
        d="M13 13L35 35"
        stroke="url(#kazixGrad1)"
        strokeWidth="4"
        strokeLinecap="round"
      />
      <path
        d="M35 13L13 35"
        stroke="url(#kazixGrad2)"
        strokeWidth="4"
        strokeLinecap="round"
      />

      {/* Core autonomous nexus node */}
      <circle cx="24" cy="24" r="5" fill="#0F172A" stroke="#10B981" strokeWidth="2.5" />
      <circle cx="24" cy="24" r="2.5" fill="#10B981" filter="url(#kazixGlow)" />
    </svg>
  );
};

export default function AgentXLogo({
  variant = "horizontal",
  size = "md",
  className,
  inverted = false
}: AgentXLogoProps) {
  const iconSizes = {
    sm: 24,
    md: 36,
    lg: 44,
    xl: 56
  };

  const textSizes = {
    sm: "text-lg",
    md: "text-2xl",
    lg: "text-3xl",
    xl: "text-4xl"
  };

  const subSizes = {
    sm: "text-[9px]",
    md: "text-[10px]",
    lg: "text-xs",
    xl: "text-sm"
  };

  if (variant === "compact") {
    return <AgentXIcon size={iconSizes[size]} className={className} />;
  }

  return (
    <div className={cn("flex items-center gap-3.5 select-none", className)}>
      <AgentXIcon size={iconSizes[size]} />
      <div className="flex flex-col leading-none">
        <div className="flex items-center gap-1.5">
          <span
            className={cn(
              "font-black tracking-tight font-sans",
              textSizes[size],
              inverted ? "text-white" : "text-slate-900"
            )}
          >
            Agent<span className="text-emerald-500">X</span>
          </span>
          <span className="text-[10px] font-extrabold uppercase px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
            2.0
          </span>
        </div>
        <span
          className={cn(
            "font-semibold tracking-widest uppercase mt-1",
            subSizes[size],
            inverted ? "text-slate-400" : "text-slate-500"
          )}
        >
          by <span className="font-bold text-slate-800 dark:text-slate-200">Kazix</span>
        </span>
      </div>
    </div>
  );
}

