import clsx from "clsx";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { CATEGORIES, IMPORTANCE_LEVELS, importanceLevel } from "@/lib/categories";
import type { EventCategory, EventStatus } from "@/types/events";

export function IconButton({ className, active, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      {...props}
      className={clsx(
        "inline-flex h-8 items-center justify-center gap-1.5 rounded-md px-2 text-muted transition-colors hover:bg-panel-hover hover:text-fg focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent",
        active && "bg-panel-hover text-fg",
        className,
      )}
    />
  );
}

export function CategoryLabel({ type, className }: { type: EventCategory; className?: string }) {
  const c = CATEGORIES[type];
  return (
    <span className={clsx("meta inline-flex items-center gap-1.5", className)} style={{ color: c.color }}>
      <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: c.color }} />
      {c.label}
    </span>
  );
}

/** Five-segment importance meter + numeric score. */
export function ImportanceMeter({ score, showLabel = false }: { score: number; showLabel?: boolean }) {
  const level = importanceLevel(score);
  const meta = IMPORTANCE_LEVELS[level];
  const filled = Math.max(1, Math.ceil(score / 20));
  return (
    <span className="inline-flex items-center gap-1.5" title={`Importance ${score}/100 — ${meta.label}`}>
      <span className="flex gap-[2px]">
        {[1, 2, 3, 4, 5].map((i) => (
          <span key={i} className="h-2.5 w-[3px] rounded-[1px]" style={{ background: i <= filled ? meta.color : "rgba(255,255,255,0.1)" }} />
        ))}
      </span>
      <span className="meta tabular" style={{ color: meta.color }}>
        {score}
        {showLabel && <span className="ml-1.5">{meta.label}</span>}
      </span>
    </span>
  );
}

const STATUS_STYLE: Record<EventStatus, { label: string; color: string }> = {
  CONFIRMED: { label: "Confirmed", color: "#3fd68f" },
  PARTIALLY_CONFIRMED: { label: "Partially confirmed", color: "#9be3b9" },
  REPORTED: { label: "Reported", color: "#7cc4ff" },
  UNVERIFIED: { label: "Unverified", color: "#f2b84b" },
  RESOLVED: { label: "Resolved", color: "#8a94a3" },
};

export function StatusBadge({ status }: { status: EventStatus }) {
  const s = STATUS_STYLE[status];
  return (
    <span className="meta inline-flex items-center rounded-sm border px-1.5 py-[1px]" style={{ color: s.color, borderColor: `${s.color}40` }}>
      {s.label}
    </span>
  );
}

export function SimulatedBadge() {
  return (
    <span className="meta inline-flex items-center rounded-sm border border-warn/40 bg-warn/10 px-1.5 py-[1px] text-warn">Simulated</span>
  );
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between">
      <h3 className="meta text-faint">{children}</h3>
      {right}
    </div>
  );
}

/** External link that never leaks referrer/opener and only allows http(s). */
export function SafeLink({ href, children, className, title }: { href: string | null; children: ReactNode; className?: string; title?: string }) {
  if (!href || !/^https?:\/\//i.test(href)) return <span className={className} title={title}>{children}</span>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer nofollow" className={className} title={title}>
      {children}
    </a>
  );
}
