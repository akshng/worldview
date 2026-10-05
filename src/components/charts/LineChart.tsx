"use client";
/**
 * Small SVG line chart: 2px lines, recessive grid, one y-axis, crosshair +
 * tooltip on hover. Up to two series; with two, a legend and direct end labels
 * carry identity (never colour alone).
 */
import { useMemo, useRef, useState } from "react";

export interface Series {
  name: string;
  color: string;
  points: Array<[number, number]>; // [x, y]
  dashed?: boolean;
}

interface Props {
  series: Series[];
  width?: number;
  height?: number;
  formatX: (x: number) => string;
  formatY: (y: number) => string;
  /** Optional discrete x tick values (e.g. tenors); otherwise 5 evenly spaced */
  xTicks?: number[];
  ariaLabel: string;
}

export function LineChart({ series, width = 620, height = 220, formatX, formatY, xTicks, ariaLabel }: Props) {
  const ref = useRef<SVGSVGElement>(null);
  const [hoverX, setHoverX] = useState<number | null>(null);
  const pad = { l: 8, r: 56, t: 10, b: 22 };
  const all = series.flatMap((s) => s.points);
  const { x0, x1, y0, y1 } = useMemo(() => {
    const xs = all.map((p) => p[0]), ys = all.map((p) => p[1]);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const padY = (maxY - minY || Math.abs(maxY) || 1) * 0.08;
    return { x0: Math.min(...xs), x1: Math.max(...xs), y0: minY - padY, y1: maxY + padY };
  }, [all]);
  if (!all.length) return <div className="grid h-[120px] place-items-center text-[12px] text-faint">No data</div>;

  const W = width - pad.l - pad.r, H = height - pad.t - pad.b;
  const sx = (x: number) => pad.l + ((x - x0) / (x1 - x0 || 1)) * W;
  const sy = (y: number) => pad.t + (1 - (y - y0) / (y1 - y0 || 1)) * H;
  const path = (pts: Array<[number, number]>) => pts.map(([x, y], i) => `${i ? "L" : "M"}${sx(x).toFixed(1)},${sy(y).toFixed(1)}`).join("");
  const yTicks = Array.from({ length: 4 }, (_, i) => y0 + ((y1 - y0) * (i + 0.5)) / 4);
  const xt = xTicks ?? Array.from({ length: 5 }, (_, i) => x0 + ((x1 - x0) * i) / 4);

  // nearest point per series at hover x
  const nearest = hoverX === null ? [] : series.map((s) => {
    let best = s.points[0];
    for (const p of s.points) if (Math.abs(p[0] - hoverX) < Math.abs(best[0] - hoverX)) best = p;
    return { s, p: best };
  });

  const onMove = (e: React.MouseEvent) => {
    const r = ref.current!.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * width;
    if (px < pad.l || px > pad.l + W) return setHoverX(null);
    setHoverX(x0 + ((px - pad.l) / W) * (x1 - x0));
  };

  return (
    <div className="relative">
      <svg ref={ref} viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label={ariaLabel} onMouseMove={onMove} onMouseLeave={() => setHoverX(null)}>
        {yTicks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={pad.l + W} y1={sy(t)} y2={sy(t)} stroke="rgba(255,255,255,0.06)" />
            <text x={pad.l + W + 6} y={sy(t) + 3.5} fontSize="10" fill="var(--text-faint)" className="tabular">{formatY(t)}</text>
          </g>
        ))}
        {xt.map((t, i) => (
          <text key={i} x={sx(t)} y={height - 6} fontSize="10" fill="var(--text-faint)" textAnchor={i === 0 ? "start" : i === xt.length - 1 ? "end" : "middle"}>
            {formatX(t)}
          </text>
        ))}
        {series.map((s) => (
          <path key={s.name} d={path(s.points)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" strokeDasharray={s.dashed ? "4 3" : undefined} />
        ))}
        {series.length > 1 &&
          series.map((s) => {
            const last = s.points[s.points.length - 1];
            return (
              <text key={s.name} x={sx(last[0]) + 4} y={sy(last[1]) - 6} fontSize="10" fill="var(--text-muted)" textAnchor="end">
                {s.name}
              </text>
            );
          })}
        {hoverX !== null && nearest.length > 0 && (
          <g>
            <line x1={sx(nearest[0].p[0])} x2={sx(nearest[0].p[0])} y1={pad.t} y2={pad.t + H} stroke="rgba(255,255,255,0.25)" />
            {nearest.map(({ s, p }) => (
              <circle key={s.name} cx={sx(p[0])} cy={sy(p[1])} r={4} fill={s.color} stroke="var(--panel-solid)" strokeWidth={2} />
            ))}
          </g>
        )}
      </svg>
      {hoverX !== null && nearest.length > 0 && (
        <div
          className="pointer-events-none absolute top-1 rounded border border-line-strong bg-panel-solid px-2 py-1 text-[11px] shadow-lg"
          style={{ left: `${Math.min(70, Math.max(0, (sx(nearest[0].p[0]) / width) * 100 - 10))}%` }}
        >
          <div className="text-faint">{formatX(nearest[0].p[0])}</div>
          {nearest.map(({ s, p }) => (
            <div key={s.name} className="flex items-center gap-1.5">
              <span className="h-[2px] w-3" style={{ background: s.color }} />
              {series.length > 1 && <span className="text-muted">{s.name}</span>}
              <span className="tabular text-fg">{formatY(p[1])}</span>
            </div>
          ))}
        </div>
      )}
      {series.length > 1 && (
        <div className="mt-1 flex gap-4 text-[11px] text-muted">
          {series.map((s) => (
            <span key={s.name} className="flex items-center gap-1.5">
              <span className="h-[2px] w-4" style={{ background: s.color, borderTop: s.dashed ? `2px dashed ${s.color}` : undefined }} />
              {s.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
