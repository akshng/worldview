/**
 * Minimal NMEA 0183 AIS (AIVDM/AIVDO) decoder for the message types that carry
 * vessel positions and static/voyage data: 1–3 (class A position), 5 (class A
 * static and voyage), 18/19 (class B position) and 24 (class B static).
 * Reference: ITU-R M.1371 and https://gpsd.gitlab.io/gpsd/AIVDM.html
 */

export interface AisPosition {
  kind: "position";
  type: number;
  mmsi: number;
  lon: number;
  lat: number;
  sog: number | null;
  cog: number | null;
  heading: number | null;
  navStatus: number | null;
  /** Class B type 19 also carries static data */
  name?: string;
  shipType?: number | null;
  dims?: [number, number, number, number];
}

export interface AisStatic {
  kind: "static";
  type: number;
  mmsi: number;
  imo?: number | null;
  callSign?: string;
  name?: string;
  shipType?: number | null;
  dims?: [number, number, number, number];
  eta?: { month: number; day: number; hour: number; minute: number };
  draughtM?: number | null;
  destination?: string;
}

export type AisDecoded = AisPosition | AisStatic;

/** Payload armoured ASCII → bit string. */
function toBits(payload: string, fill = 0): string {
  let bits = "";
  for (let i = 0; i < payload.length; i++) {
    let v = payload.charCodeAt(i) - 48;
    if (v > 40) v -= 8;
    if (v < 0 || v > 63) return "";
    bits += v.toString(2).padStart(6, "0");
  }
  return fill > 0 ? bits.slice(0, -fill) : bits;
}

const uint = (b: string, start: number, len: number) => (b.length >= start + len ? parseInt(b.slice(start, start + len), 2) : NaN);
function int(b: string, start: number, len: number) {
  const u = uint(b, start, len);
  return u >= 2 ** (len - 1) ? u - 2 ** len : u;
}
function text(b: string, start: number, len: number) {
  let s = "";
  for (let i = start; i + 6 <= Math.min(start + len, b.length); i += 6) {
    const v = parseInt(b.slice(i, i + 6), 2);
    s += String.fromCharCode(v < 32 ? v + 64 : v);
  }
  return s.replace(/@.*$/, "").trim();
}

const coord = (raw: number, limit: number) => (Number.isFinite(raw) && Math.abs(raw / 600000) <= limit ? Math.round((raw / 600000) * 1e5) / 1e5 : null);
const sogOf = (v: number) => (Number.isFinite(v) && v < 1023 ? v / 10 : null);
const cogOf = (v: number) => (Number.isFinite(v) && v < 3600 ? v / 10 : null);
const hdgOf = (v: number) => (Number.isFinite(v) && v < 360 ? v : null);
const typeOf = (v: number) => (Number.isFinite(v) && v > 0 && v < 100 ? v : null);

/** Decode one complete (reassembled) payload. */
export function decodeAisPayload(payload: string, fill = 0): AisDecoded | null {
  const b = toBits(payload, fill);
  if (b.length < 38) return null;
  const type = uint(b, 0, 6);
  const mmsi = uint(b, 8, 30);
  if (!mmsi) return null;
  if (type >= 1 && type <= 3) {
    if (b.length < 137) return null;
    const lon = coord(int(b, 61, 28), 180), lat = coord(int(b, 89, 27), 90);
    if (lon === null || lat === null) return null;
    const nav = uint(b, 38, 4);
    return { kind: "position", type, mmsi, lon, lat, sog: sogOf(uint(b, 50, 10)), cog: cogOf(uint(b, 116, 12)), heading: hdgOf(uint(b, 128, 9)), navStatus: nav === 15 ? null : nav };
  }
  if (type === 18 || type === 19) {
    if (b.length < 133) return null;
    const lon = coord(int(b, 57, 28), 180), lat = coord(int(b, 85, 27), 90);
    if (lon === null || lat === null) return null;
    const pos: AisPosition = { kind: "position", type, mmsi, lon, lat, sog: sogOf(uint(b, 46, 10)), cog: cogOf(uint(b, 112, 12)), heading: hdgOf(uint(b, 124, 9)), navStatus: null };
    if (type === 19 && b.length >= 301) {
      pos.name = text(b, 143, 120);
      pos.shipType = typeOf(uint(b, 263, 8));
      pos.dims = [uint(b, 271, 9), uint(b, 280, 9), uint(b, 289, 6), uint(b, 295, 6)];
    }
    return pos;
  }
  if (type === 5) {
    if (b.length < 420) return null;
    const imo = uint(b, 40, 30);
    const draught = uint(b, 294, 8);
    return {
      kind: "static",
      type,
      mmsi,
      imo: imo > 0 ? imo : null,
      callSign: text(b, 70, 42),
      name: text(b, 112, 120),
      shipType: typeOf(uint(b, 232, 8)),
      dims: [uint(b, 240, 9), uint(b, 249, 9), uint(b, 258, 6), uint(b, 264, 6)],
      eta: { month: uint(b, 274, 4), day: uint(b, 278, 5), hour: uint(b, 283, 5), minute: uint(b, 288, 6) },
      draughtM: draught > 0 ? draught / 10 : null,
      destination: text(b, 302, 120),
    };
  }
  if (type === 24) {
    const part = uint(b, 38, 2);
    if (part === 0 && b.length >= 160) return { kind: "static", type, mmsi, name: text(b, 40, 120) };
    if (part === 1 && b.length >= 162)
      return { kind: "static", type, mmsi, shipType: typeOf(uint(b, 40, 8)), callSign: text(b, 90, 42), dims: [uint(b, 132, 9), uint(b, 141, 9), uint(b, 150, 6), uint(b, 156, 6)] };
  }
  return null;
}

/** XOR checksum of the characters between "!" and "*". */
export function nmeaChecksumOk(sentence: string): boolean {
  const m = /^!([^*]+)\*([0-9A-Fa-f]{2})/.exec(sentence);
  if (!m) return false;
  let x = 0;
  for (let i = 0; i < m[1].length; i++) x ^= m[1].charCodeAt(i);
  return x === parseInt(m[2], 16);
}

/**
 * Stateful line decoder: feed raw lines (optionally prefixed with an NMEA 4.0
 * tag block such as `\s:2573345,c:1696250390*0E\`); multi-sentence messages
 * are reassembled per channel and sequence id.
 */
export class AivdmDecoder {
  private parts = new Map<string, { total: number; got: string[]; at: number }>();

  line(raw: string, now = Date.now()): AisDecoded | null {
    const i = raw.indexOf("!");
    if (i < 0) return null;
    const sentence = raw.slice(i).trim();
    if (!/^!(AI|BS|AB|SA)VD[MO],/.test(sentence) || !nmeaChecksumOk(sentence)) return null;
    const f = sentence.split("*")[0].split(",");
    if (f.length < 7) return null;
    const total = +f[1], num = +f[2], seq = f[3], chan = f[4], payload = f[5], fill = +f[6] || 0;
    if (!(total >= 1 && num >= 1 && num <= total)) return null;
    if (total === 1) return decodeAisPayload(payload, fill);
    const key = `${chan}|${seq}`;
    let p = this.parts.get(key);
    if (num === 1 || !p || p.total !== total || now - p.at > 10_000) p = { total, got: [], at: now };
    p.got[num - 1] = payload;
    this.parts.set(key, p);
    if (num < total) return null;
    this.parts.delete(key);
    if (p.got.filter((x) => x !== undefined).length !== total) return null;
    if (this.parts.size > 200) this.parts.clear();
    return decodeAisPayload(p.got.join(""), fill);
  }
}
