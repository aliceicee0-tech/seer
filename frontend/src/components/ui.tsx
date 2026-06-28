import { type ReactNode } from "react";
import { cx } from "../lib/format";
import { Inbox } from "lucide-react";

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("card", className)}>{children}</div>;
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "yes" | "no" | "warn" | "info";
}) {
  const tones: Record<string, string> = {
    neutral: "border-zinc-200 bg-zinc-50 text-zinc-500",
    yes: "border-blue-100 bg-blue-50/50 text-blue-600",
    no: "border-rose-100 bg-rose-50/50 text-rose-600",
    warn: "border-amber-100 bg-amber-50/50 text-amber-600",
    info: "border-zinc-200 bg-zinc-100 text-zinc-650",
  };
  return <span className={cx("badge", tones[tone])}>{children}</span>;
}

export function Spinner() {
  return (
    <div className="flex justify-center py-10">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-200 border-t-blue-600" />
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  hint,
}: {
  icon?: ReactNode;
  title: string;
  hint?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="mb-4 text-zinc-400">
        {icon ?? <Inbox className="h-10 w-10 stroke-[1.5px]" />}
      </div>
      <p className="text-xs font-bold uppercase tracking-wider text-zinc-700">{title}</p>
      {hint && <p className="mt-1 text-[11px] text-zinc-450 font-semibold">{hint}</p>}
    </div>
  );
}

/** Barre OUI / NON visualisant les probabilités. */
export function ProbabilityBar({
  yes,
  no,
}: {
  yes: string | number;
  no: string | number;
}) {
  const y = typeof yes === "number" ? yes : parseFloat(yes);
  const yPct = Math.round(y * 100);
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between font-display text-[9px] font-extrabold tracking-widest uppercase">
        <span className="text-blue-600">OUI {yPct}%</span>
        <span className="text-rose-500">{100 - yPct}% NON</span>
      </div>
      <div className="h-[4px] w-full overflow-hidden rounded-full bg-rose-100 flex">
        <div
          className="h-full bg-blue-600 transition-all duration-700 ease-out animate-pulse-once"
          style={{ width: `${yPct}%` }}
        />
        <div
          className="h-full bg-rose-500 transition-all duration-700 ease-out flex-grow"
        />
      </div>
    </div>
  );
}
