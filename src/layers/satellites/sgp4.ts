/**
 * Minimal SGP4 propagator (near-Earth branch of Vallado et al., "Revisiting
 * Spacetrack Report #3", AIAA 2006-6753), WGS-72 constants, plus TEME →
 * geodetic conversion. Pure TypeScript; runs in the browser.
 *
 * Deep-space objects (period ≥ 225 min, e.g. GPS) are propagated with the same
 * secular J2–J4 / drag model but WITHOUT the SDP4 lunisolar and resonance
 * terms. Within a day or two of the element epoch that costs tens of km at
 * most — fine for drawing them on a globe, not for precise work.
 */

const TWO_PI = Math.PI * 2;
const DEG = Math.PI / 180;
const X2O3 = 2 / 3;

// WGS-72 (the constants the published element sets are fitted with)
const MU = 398600.8;
export const RE_KM = 6378.135;
const XKE = 60 / Math.sqrt((RE_KM * RE_KM * RE_KM) / MU);
const J2 = 0.001082616;
const J3 = -0.00000253881;
const J4 = -0.00000165597;
const J3OJ2 = J3 / J2;
const VKMPERSEC = (RE_KM * XKE) / 60;

/** Mean elements in the CelesTrak OMM/JSON vocabulary. */
export interface MeanElements {
  /** Epoch, ms since Unix epoch (UTC) */
  epochMs: number;
  /** revolutions per day */
  meanMotion: number;
  eccentricity: number;
  /** degrees */
  inclination: number;
  raan: number;
  argOfPericenter: number;
  meanAnomaly: number;
  /** 1 / earth radii */
  bstar: number;
}

export interface SatRec {
  epochMs: number;
  deep: boolean;
  isimp: boolean;
  no: number;
  ecco: number;
  inclo: number;
  nodeo: number;
  argpo: number;
  mo: number;
  bstar: number;
  con41: number;
  x1mth2: number;
  x7thm1: number;
  cc1: number;
  cc4: number;
  cc5: number;
  d2: number;
  d3: number;
  d4: number;
  delmo: number;
  eta: number;
  argpdot: number;
  omgcof: number;
  sinmao: number;
  t2cof: number;
  t3cof: number;
  t4cof: number;
  t5cof: number;
  xmcof: number;
  mdot: number;
  nodedot: number;
  nodecf: number;
  xlcof: number;
  aycof: number;
  /** orbital period, minutes */
  periodMin: number;
}

/** Initialise a propagator record (sgp4init). Throws on non-physical elements. */
export function sgp4init(el: MeanElements): SatRec {
  const ecco = el.eccentricity;
  const inclo = el.inclination * DEG;
  const nodeo = el.raan * DEG;
  const argpo = el.argOfPericenter * DEG;
  const mo = el.meanAnomaly * DEG;
  const bstar = el.bstar;
  let no = (el.meanMotion * TWO_PI) / 1440; // rad/min
  if (!(no > 0) || !(ecco >= 0 && ecco < 1)) throw new Error("invalid elements");

  // ---- initl: recover original mean motion and semi-major axis
  const eccsq = ecco * ecco;
  const omeosq = 1 - eccsq;
  const rteosq = Math.sqrt(omeosq);
  const cosio = Math.cos(inclo);
  const cosio2 = cosio * cosio;
  const ak = Math.pow(XKE / no, X2O3);
  const d1 = (0.75 * J2 * (3 * cosio2 - 1)) / (rteosq * omeosq);
  let del = d1 / (ak * ak);
  const adel = ak * (1 - del * del - del * (1 / 3 + (134 * del * del) / 81));
  del = d1 / (adel * adel);
  no = no / (1 + del);
  const ao = Math.pow(XKE / no, X2O3);
  const sinio = Math.sin(inclo);
  const po = ao * omeosq;
  const con42 = 1 - 5 * cosio2;
  const con41 = -con42 - cosio2 - cosio2;
  const posq = po * po;
  const rp = ao * (1 - ecco);
  const periodMin = TWO_PI / no;

  // ---- sgp4init
  const ss = 78 / RE_KM + 1;
  const qzms2t = Math.pow((120 - 78) / RE_KM, 4);
  const isimp = rp < 220 / RE_KM + 1;
  let sfour = ss;
  let qzms24 = qzms2t;
  const perige = (rp - 1) * RE_KM;
  if (perige < 156) {
    sfour = perige < 98 ? 20 : perige - 78;
    qzms24 = Math.pow((120 - sfour) / RE_KM, 4);
    sfour = sfour / RE_KM + 1;
  }
  const pinvsq = 1 / posq;
  const tsi = 1 / (ao - sfour);
  const eta = ao * ecco * tsi;
  const etasq = eta * eta;
  const eeta = ecco * eta;
  const psisq = Math.abs(1 - etasq);
  const coef = qzms24 * Math.pow(tsi, 4);
  const coef1 = coef / Math.pow(psisq, 3.5);
  const cc2 =
    coef1 * no * (ao * (1 + 1.5 * etasq + eeta * (4 + etasq)) + ((0.375 * J2 * tsi) / psisq) * con41 * (8 + 3 * etasq * (8 + etasq)));
  const cc1 = bstar * cc2;
  const cc3 = ecco > 1e-4 ? (-2 * coef * tsi * J3OJ2 * no * sinio) / ecco : 0;
  const x1mth2 = 1 - cosio2;
  const cc4 =
    2 *
    no *
    coef1 *
    ao *
    omeosq *
    (eta * (2 + 0.5 * etasq) +
      ecco * (0.5 + 2 * etasq) -
      ((J2 * tsi) / (ao * psisq)) *
        (-3 * con41 * (1 - 2 * eeta + etasq * (1.5 - 0.5 * eeta)) + 0.75 * x1mth2 * (2 * etasq - eeta * (1 + etasq)) * Math.cos(2 * argpo)));
  const cc5 = 2 * coef1 * ao * omeosq * (1 + 2.75 * (etasq + eeta) + eeta * etasq);
  const cosio4 = cosio2 * cosio2;
  const temp1 = 1.5 * J2 * pinvsq * no;
  const temp2 = 0.5 * temp1 * J2 * pinvsq;
  const temp3 = -0.46875 * J4 * pinvsq * pinvsq * no;
  const mdot = no + 0.5 * temp1 * rteosq * con41 + 0.0625 * temp2 * rteosq * (13 - 78 * cosio2 + 137 * cosio4);
  const argpdot = -0.5 * temp1 * con42 + 0.0625 * temp2 * (7 - 114 * cosio2 + 395 * cosio4) + temp3 * (3 - 36 * cosio2 + 49 * cosio4);
  const xhdot1 = -temp1 * cosio;
  const nodedot = xhdot1 + (0.5 * temp2 * (4 - 19 * cosio2) + 2 * temp3 * (3 - 7 * cosio2)) * cosio;
  const omgcof = bstar * cc3 * Math.cos(argpo);
  const xmcof = ecco > 1e-4 ? (-X2O3 * coef * bstar) / eeta : 0;
  const nodecf = 3.5 * omeosq * xhdot1 * cc1;
  const t2cof = 1.5 * cc1;
  const xlcof = (-0.25 * J3OJ2 * sinio * (3 + 5 * cosio)) / (Math.abs(cosio + 1) > 1.5e-12 ? 1 + cosio : 1.5e-12);
  const aycof = -0.5 * J3OJ2 * sinio;
  const delmo = Math.pow(1 + eta * Math.cos(mo), 3);
  const sinmao = Math.sin(mo);
  const x7thm1 = 7 * cosio2 - 1;

  const deep = periodMin >= 225;
  let d2 = 0, d3 = 0, d4 = 0, t3cof = 0, t4cof = 0, t5cof = 0;
  if (!isimp && !deep) {
    const cc1sq = cc1 * cc1;
    d2 = 4 * ao * tsi * cc1sq;
    const temp = (d2 * tsi * cc1) / 3;
    d3 = (17 * ao + sfour) * temp;
    d4 = 0.5 * temp * ao * tsi * (221 * ao + 31 * sfour) * cc1;
    t3cof = d2 + 2 * cc1sq;
    t4cof = 0.25 * (3 * d3 + cc1 * (12 * d2 + 10 * cc1sq));
    t5cof = 0.2 * (3 * d4 + 12 * cc1 * d3 + 6 * d2 * d2 + 15 * cc1sq * (2 * d2 + cc1sq));
  }

  return {
    epochMs: el.epochMs,
    deep,
    isimp: isimp || deep,
    no,
    ecco,
    inclo,
    nodeo,
    argpo,
    mo,
    bstar,
    con41,
    x1mth2,
    x7thm1,
    cc1,
    cc4,
    cc5,
    d2,
    d3,
    d4,
    delmo,
    eta,
    argpdot,
    omgcof,
    sinmao,
    t2cof,
    t3cof,
    t4cof,
    t5cof,
    xmcof,
    mdot,
    nodedot,
    nodecf,
    xlcof,
    aycof,
    periodMin,
  };
}

const mod2pi = (x: number) => ((x % TWO_PI) + TWO_PI) % TWO_PI;

/** TEME position (km) and velocity (km/s) `tsince` minutes after epoch, or null if the orbit has decayed / diverged. */
export function sgp4(s: SatRec, tsince: number): { r: [number, number, number]; v: [number, number, number] } | null {
  const t = tsince;
  const xmdf = s.mo + s.mdot * t;
  const argpdf = s.argpo + s.argpdot * t;
  const nodedf = s.nodeo + s.nodedot * t;
  let argpm = argpdf;
  let mm = xmdf;
  const t2 = t * t;
  let nodem = nodedf + s.nodecf * t2;
  let tempa = 1 - s.cc1 * t;
  let tempe = s.bstar * s.cc4 * t;
  let templ = s.t2cof * t2;
  if (!s.isimp) {
    const delomg = s.omgcof * t;
    const delm = s.xmcof * (Math.pow(1 + s.eta * Math.cos(xmdf), 3) - s.delmo);
    const temp = delomg + delm;
    mm = xmdf + temp;
    argpm = argpdf - temp;
    const t3 = t2 * t;
    const t4 = t3 * t;
    tempa = tempa - s.d2 * t2 - s.d3 * t3 - s.d4 * t4;
    tempe = tempe + s.bstar * s.cc5 * (Math.sin(mm) - s.sinmao);
    templ = templ + s.t3cof * t3 + t4 * (s.t4cof + t * s.t5cof);
  }
  const am = Math.pow(XKE / s.no, X2O3) * tempa * tempa;
  const nm = XKE / Math.pow(am, 1.5);
  let em = s.ecco - tempe;
  if (!(am > 0) || em >= 1 || em < -0.001) return null;
  if (em < 1e-6) em = 1e-6;
  mm = mm + s.no * templ;
  const xlm = mod2pi(mm + argpm + nodem);
  nodem = mod2pi(nodem);
  argpm = mod2pi(argpm);
  mm = mod2pi(xlm - argpm - nodem);
  const sinip = Math.sin(s.inclo);
  const cosip = Math.cos(s.inclo);

  // ---- long-period periodics
  const axnl = em * Math.cos(argpm);
  let temp = 1 / (am * (1 - em * em));
  const aynl = em * Math.sin(argpm) + temp * s.aycof;
  const xl = mm + argpm + nodem + temp * s.xlcof * axnl;

  // ---- Kepler's equation
  const u = mod2pi(xl - nodem);
  let eo1 = u;
  let tem5 = 9999.9;
  let sineo1 = 0, coseo1 = 0;
  for (let ktr = 1; Math.abs(tem5) >= 1e-12 && ktr <= 10; ktr++) {
    sineo1 = Math.sin(eo1);
    coseo1 = Math.cos(eo1);
    tem5 = 1 - coseo1 * axnl - sineo1 * aynl;
    tem5 = (u - aynl * coseo1 + axnl * sineo1 - eo1) / tem5;
    if (Math.abs(tem5) >= 0.95) tem5 = tem5 > 0 ? 0.95 : -0.95;
    eo1 += tem5;
  }

  // ---- short-period periodics
  const ecose = axnl * coseo1 + aynl * sineo1;
  const esine = axnl * sineo1 - aynl * coseo1;
  const el2 = axnl * axnl + aynl * aynl;
  const pl = am * (1 - el2);
  if (pl < 0) return null;
  const rl = am * (1 - ecose);
  const rdotl = (Math.sqrt(am) * esine) / rl;
  const rvdotl = Math.sqrt(pl) / rl;
  const betal = Math.sqrt(1 - el2);
  temp = esine / (1 + betal);
  const sinu = (am / rl) * (sineo1 - aynl - axnl * temp);
  const cosu = (am / rl) * (coseo1 - axnl + aynl * temp);
  let su = Math.atan2(sinu, cosu);
  const sin2u = (cosu + cosu) * sinu;
  const cos2u = 1 - 2 * sinu * sinu;
  temp = 1 / pl;
  const temp1 = 0.5 * J2 * temp;
  const temp2 = temp1 * temp;
  const mrt = rl * (1 - 1.5 * temp2 * betal * s.con41) + 0.5 * temp1 * s.x1mth2 * cos2u;
  if (mrt < 1) return null; // decayed
  su = su - 0.25 * temp2 * s.x7thm1 * sin2u;
  const xnode = nodem + 1.5 * temp2 * cosip * sin2u;
  const xinc = s.inclo + 1.5 * temp2 * cosip * sinip * cos2u;
  const mvt = rdotl - (nm * temp1 * s.x1mth2 * sin2u) / XKE;
  const rvdot = rvdotl + (nm * temp1 * (s.x1mth2 * cos2u + 1.5 * s.con41)) / XKE;

  // ---- orientation vectors
  const sinsu = Math.sin(su), cossu = Math.cos(su);
  const snod = Math.sin(xnode), cnod = Math.cos(xnode);
  const sini = Math.sin(xinc), cosi = Math.cos(xinc);
  const xmx = -snod * cosi;
  const xmy = cnod * cosi;
  const ux = xmx * sinsu + cnod * cossu;
  const uy = xmy * sinsu + snod * cossu;
  const uz = sini * sinsu;
  const vx = xmx * cossu - cnod * sinsu;
  const vy = xmy * cossu - snod * sinsu;
  const vz = sini * cossu;
  const k = mrt * RE_KM;
  return {
    r: [k * ux, k * uy, k * uz],
    v: [(mvt * ux + rvdot * vx) * VKMPERSEC, (mvt * uy + rvdot * vy) * VKMPERSEC, (mvt * uz + rvdot * vz) * VKMPERSEC],
  };
}

/** Greenwich mean sidereal time (IAU-82), radians, for a Unix ms time. */
export function gmst(ms: number): number {
  const jd = ms / 86_400_000 + 2440587.5;
  const tut1 = (jd - 2451545) / 36525;
  const sec = -6.2e-6 * tut1 * tut1 * tut1 + 0.093104 * tut1 * tut1 + (876600 * 3600 + 8640184.812866) * tut1 + 67310.54841;
  return mod2pi((sec * DEG) / 240);
}

/** TEME position (km) → geodetic lon/lat (degrees, WGS-84) and altitude (km). */
export function temeToGeodetic(r: [number, number, number], ms: number): { lon: number; lat: number; altKm: number } {
  const a = 6378.137;
  const f = 1 / 298.257223563;
  const e2 = f * (2 - f);
  const [x, y, z] = r;
  const lonRad = Math.atan2(y, x) - gmst(ms);
  const p = Math.hypot(x, y);
  let lat = Math.atan2(z, p);
  for (let i = 0; i < 5; i++) {
    const sl = Math.sin(lat);
    lat = Math.atan2(z + (a / Math.sqrt(1 - e2 * sl * sl)) * e2 * sl, p);
  }
  const sl = Math.sin(lat);
  const n = a / Math.sqrt(1 - e2 * sl * sl);
  // Form that stays well-conditioned at the poles (no division by cos φ).
  const altKm = p * Math.cos(lat) + (z + e2 * n * sl) * sl - n;
  let lon = (lonRad / DEG) % 360;
  if (lon > 180) lon -= 360;
  if (lon < -180) lon += 360;
  return { lon, lat: lat / DEG, altKm };
}

/** Sub-satellite point at `ms`, or null when propagation fails. */
export function subPoint(s: SatRec, ms: number): { lon: number; lat: number; altKm: number; speedKms: number } | null {
  const pv = sgp4(s, (ms - s.epochMs) / 60_000);
  if (!pv) return null;
  const g = temeToGeodetic(pv.r, ms);
  if (!Number.isFinite(g.lat) || !Number.isFinite(g.lon)) return null;
  return { ...g, speedKms: Math.hypot(...pv.v) };
}

/** Ground track samples [lon, lat] from `fromMs` to `toMs` (inclusive) every `stepMs`. */
export function groundTrack(s: SatRec, fromMs: number, toMs: number, stepMs: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let t = fromMs; t <= toMs; t += stepMs) {
    const p = subPoint(s, t);
    if (p) out.push([p.lon, p.lat]);
  }
  return out;
}
