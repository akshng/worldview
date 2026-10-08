/**
 * Short position histories ("trails") for tracked objects, kept in server
 * memory from the snapshots/streams we already receive — no extra upstream
 * requests. Bounded by points per object, age and object count.
 */
export type TrailPoint = [lon: number, lat: number, t: number];

export class TrailStore {
  private trails = new Map<string, TrailPoint[]>();
  constructor(
    private readonly maxPoints = 16,
    private readonly maxAgeMs = 30 * 60_000,
    private readonly maxIds = 60_000,
    /** Ignore points closer in time than this to the previous one */
    private readonly minGapMs = 10_000,
  ) {}

  add(id: string, lon: number, lat: number, t: number) {
    let tr = this.trails.get(id);
    if (!tr) {
      if (this.trails.size >= this.maxIds) this.prune(t, true);
      this.trails.set(id, (tr = []));
    }
    const last = tr[tr.length - 1];
    if (last && (t - last[2] < this.minGapMs || (last[0] === lon && last[1] === lat))) {
      if (t > last[2] && last[0] === lon && last[1] === lat) last[2] = t;
      return;
    }
    if (last && t < last[2]) return;
    tr.push([lon, lat, t]);
    if (tr.length > this.maxPoints) tr.splice(0, tr.length - this.maxPoints);
  }

  get(id: string, now = Date.now()): TrailPoint[] {
    return (this.trails.get(id) ?? []).filter((p) => now - p[2] <= this.maxAgeMs);
  }

  /** Drop expired trails; with `hard`, also the oldest half when over capacity. */
  prune(now = Date.now(), hard = false) {
    for (const [id, tr] of this.trails) if (!tr.length || now - tr[tr.length - 1][2] > this.maxAgeMs) this.trails.delete(id);
    if (hard && this.trails.size >= this.maxIds) {
      const ids = [...this.trails.entries()].sort((a, b) => a[1][a[1].length - 1][2] - b[1][b[1].length - 1][2]).slice(0, this.maxIds / 2);
      for (const [id] of ids) this.trails.delete(id);
    }
  }

  get size() {
    return this.trails.size;
  }
}
