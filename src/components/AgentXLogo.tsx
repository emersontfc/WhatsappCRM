import { cn } from "../lib/utils";

interface AgentXLogoProps {
  variant?: "horizontal" | "compact" | "badge";
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
  inverted?: boolean;
}

export const AgentXIcon = ({ size = 28, className }: { size?: number; className?: string }) => {
  return (
    <img
      src={`${import.meta.env.BASE_URL}agentx-mark-v2.svg`}
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      className={cn("shrink-0", className)}
    />
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
          by <span className={cn("font-bold", inverted ? "text-slate-200" : "text-slate-800")}>Kazix</span>
        </span>
      </div>
    </div>
  );
}

