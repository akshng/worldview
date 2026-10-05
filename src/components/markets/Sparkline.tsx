"use client";
/** Minimal sparkline: muted line, current point in the direction colour. */
export function Sparkline({ values, color, width = 84, height = 24, label }: { values: number[]; color: string; width?: number; height?: number; label: string }) {
  if (values.length < 2) return <svg width={width} height={height} aria-hidden />;
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || 1;
  const pad = 3;
  const pts = values.map((v, i) => [pad + (i / (values.length - 1)) * (width - pad * 2), pad + (1 - (v - min) / span) * (height - pad * 2)] as const);
  const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join("");
  const [lx, ly] = pts[pts.length - 1];
  return (
    <svg width={width} height={height} role="img" aria-label={label}>
      <title>{label}</title>
      <path d={d} fill="none" stroke="rgba(160,170,185,0.55)" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lx} cy={ly} r={2.5} fill={color} stroke="var(--panel-solid)" strokeWidth={1.5} />
    </svg>
  );
}
