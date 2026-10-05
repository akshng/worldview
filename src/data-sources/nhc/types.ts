/** National Hurricane Center CurrentStorms.json (Atlantic + Eastern/Central Pacific). */
export interface NhcStorm {
  id: string;
  binNumber: string;
  name: string;
  /** TD tropical depression · TS tropical storm · HU hurricane · STD/STS subtropical · PTC potential TC · PC post-tropical */
  classification: string;
  intensity: string | null;
  pressure: string | null;
  latitudeNumeric: number;
  longitudeNumeric: number;
  movementDir: number | null;
  movementSpeed: number | null;
  lastUpdate: string;
  publicAdvisory?: { advNum: string; issuance: string; url: string } | null;
}
export interface NhcRaw {
  activeStorms: NhcStorm[];
}
