/**
 * Day/night terminator. Produces polygons covering the parts of Earth where the
 * sun is below a given elevation (0° = night edge, -6/-12° = twilight bands).
 * Accuracy ≈ 0.1°, more than enough for a visual overlay.
 */
const rad = Math.PI / 180;

export function sunPosition(date: Date): { lat: number; lon: number } {
  const jd = date.getTime() / 86_400_000 + 2440587.5;
  const n = jd - 2451545.0;
  const L = (280.46 + 0.9856474 * n) % 360;
  const g = ((357.528 + 0.9856003 * n) % 360) * rad;
  const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * rad;
  const epsilon = (23.439 - 0.0000004 * n) * rad;
  const decl = Math.asin(Math.sin(epsilon) * Math.sin(lambda));
  const ra = Math.atan2(Math.cos(epsilon) * Math.sin(lambda), Math.cos(lambda));
  const gmst = (18.697374558 + 24.06570982441908 * n) % 24;
  let lon = (ra / rad - gmst * 15) % 360;
  if (lon > 180) lon -= 360;
  if (lon < -180) lon += 360;
  return { lat: decl / rad, lon };
}

function elevation(lat: number, lon: number, sun: { lat: number; lon: number }) {
  const h = (lon - sun.lon) * rad;
  return Math.asin(
    Math.sin(lat * rad) * Math.sin(sun.lat * rad) + Math.cos(lat * rad) * Math.cos(sun.lat * rad) * Math.cos(h),
  ) / rad;
}

/** Polygon of the region where solar elevation < `below` degrees. */
export function nightPolygon(date: Date, below = 0): GeoJSON.Feature<GeoJSON.Polygon> {
  const sun = sunPosition(date);
  // The darker pole is opposite the sun's declination.
  const pole = sun.lat >= 0 ? -90 : 90;
  const step = pole < 0 ? 0.25 : -0.25;
  const ring: [number, number][] = [];
  for (let lon = -180; lon <= 180; lon += 2) {
    let boundary = -pole;
    for (let lat = pole; Math.abs(lat) <= 90; lat += step) {
      if (elevation(lat, lon, sun) >= below) {
        boundary = lat;
        break;
      }
    }
    ring.push([lon, boundary]);
  }
  ring.push([180, pole], [-180, pole], ring[0]);
  return { type: "Feature", properties: { below }, geometry: { type: "Polygon", coordinates: [ring] } };
}

export function nightCollection(date: Date): GeoJSON.FeatureCollection<GeoJSON.Polygon> {
  return { type: "FeatureCollection", features: [nightPolygon(date, 0), nightPolygon(date, -6), nightPolygon(date, -12)] };
}
