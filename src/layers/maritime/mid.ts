/**
 * AIS reference tables: flag state from an MMSI's Maritime Identification
 * Digits (ITU MID table), ship-type labels, and the packed AIS ETA field.
 * Pure functions — shared by the server (detail API) and the browser.
 */

/** ITU Maritime Identification Digits → [ISO 3166 alpha-2, name]. */
const MID: Record<number, [string, string]> = {};
const add = (code: string, name: string, ...mids: number[]) => mids.forEach((m) => (MID[m] = [code, name]));
add("AL", "Albania", 201); add("AD", "Andorra", 202); add("AT", "Austria", 203); add("PT", "Portugal (Azores)", 204);
add("BE", "Belgium", 205); add("BY", "Belarus", 206); add("BG", "Bulgaria", 207); add("VA", "Vatican", 208);
add("CY", "Cyprus", 209, 210, 212); add("DE", "Germany", 211, 218); add("GE", "Georgia", 213); add("MD", "Moldova", 214);
add("MT", "Malta", 215, 229, 248, 249, 256); add("AM", "Armenia", 216); add("DK", "Denmark", 219, 220); add("ES", "Spain", 224, 225);
add("FR", "France", 226, 227, 228); add("FI", "Finland", 230); add("FO", "Faroe Islands", 231); add("GB", "United Kingdom", 232, 233, 234, 235);
add("GI", "Gibraltar", 236); add("GR", "Greece", 237, 239, 240, 241); add("HR", "Croatia", 238); add("MA", "Morocco", 242);
add("HU", "Hungary", 243); add("NL", "Netherlands", 244, 245, 246); add("IT", "Italy", 247); add("IE", "Ireland", 250);
add("IS", "Iceland", 251); add("LI", "Liechtenstein", 252); add("LU", "Luxembourg", 253); add("MC", "Monaco", 254);
add("PT", "Portugal (Madeira)", 255); add("NO", "Norway", 257, 258, 259); add("PL", "Poland", 261); add("ME", "Montenegro", 262);
add("PT", "Portugal", 263); add("RO", "Romania", 264); add("SE", "Sweden", 265, 266); add("SK", "Slovakia", 267);
add("SM", "San Marino", 268); add("CH", "Switzerland", 269); add("CZ", "Czechia", 270); add("TR", "Türkiye", 271);
add("UA", "Ukraine", 272); add("RU", "Russia", 273); add("MK", "North Macedonia", 274); add("LV", "Latvia", 275);
add("EE", "Estonia", 276); add("LT", "Lithuania", 277); add("SI", "Slovenia", 278); add("RS", "Serbia", 279);
add("AI", "Anguilla", 301); add("US", "United States", 303, 338, 366, 367, 368, 369); add("AG", "Antigua and Barbuda", 304, 305);
add("CW", "Curaçao", 306); add("AW", "Aruba", 307); add("BS", "Bahamas", 308, 309, 311); add("BM", "Bermuda", 310);
add("BZ", "Belize", 312); add("BB", "Barbados", 314); add("CA", "Canada", 316); add("KY", "Cayman Islands", 319);
add("CR", "Costa Rica", 321); add("CU", "Cuba", 323); add("DM", "Dominica", 325); add("DO", "Dominican Republic", 327);
add("GP", "Guadeloupe", 329); add("GD", "Grenada", 330); add("GL", "Greenland", 331); add("GT", "Guatemala", 332);
add("HN", "Honduras", 334); add("HT", "Haiti", 336); add("JM", "Jamaica", 339); add("KN", "Saint Kitts and Nevis", 341);
add("LC", "Saint Lucia", 343); add("MX", "Mexico", 345); add("MQ", "Martinique", 347); add("MS", "Montserrat", 348);
add("NI", "Nicaragua", 350); add("PA", "Panama", 351, 352, 353, 354, 355, 356, 357, 370, 371, 372, 373, 374);
add("PR", "Puerto Rico", 358); add("SV", "El Salvador", 359); add("PM", "Saint Pierre and Miquelon", 361); add("TT", "Trinidad and Tobago", 362);
add("TC", "Turks and Caicos", 364); add("VC", "Saint Vincent and the Grenadines", 375, 376, 377); add("VG", "British Virgin Islands", 378);
add("VI", "US Virgin Islands", 379); add("AF", "Afghanistan", 401); add("SA", "Saudi Arabia", 403); add("BD", "Bangladesh", 405);
add("BH", "Bahrain", 408); add("BT", "Bhutan", 410); add("CN", "China", 412, 413, 414); add("TW", "Taiwan", 416);
add("LK", "Sri Lanka", 417); add("IN", "India", 419); add("IR", "Iran", 422); add("AZ", "Azerbaijan", 423); add("IQ", "Iraq", 425);
add("IL", "Israel", 428); add("JP", "Japan", 431, 432); add("TM", "Turkmenistan", 434); add("KZ", "Kazakhstan", 436);
add("UZ", "Uzbekistan", 437); add("JO", "Jordan", 438); add("KR", "South Korea", 440, 441); add("PS", "Palestine", 443);
add("KP", "North Korea", 445); add("KW", "Kuwait", 447); add("LB", "Lebanon", 450); add("KG", "Kyrgyzstan", 451);
add("MO", "Macao", 453); add("MV", "Maldives", 455); add("MN", "Mongolia", 457); add("NP", "Nepal", 459); add("OM", "Oman", 461);
add("PK", "Pakistan", 463); add("QA", "Qatar", 466); add("SY", "Syria", 468); add("AE", "United Arab Emirates", 470, 471);
add("TJ", "Tajikistan", 472); add("YE", "Yemen", 473, 475); add("HK", "Hong Kong", 477); add("BA", "Bosnia and Herzegovina", 478);
add("AU", "Australia", 503); add("MM", "Myanmar", 506); add("BN", "Brunei", 508); add("FM", "Micronesia", 510); add("PW", "Palau", 511);
add("NZ", "New Zealand", 512); add("KH", "Cambodia", 514, 515); add("CK", "Cook Islands", 518); add("FJ", "Fiji", 520);
add("ID", "Indonesia", 525); add("KI", "Kiribati", 529); add("LA", "Laos", 531); add("MY", "Malaysia", 533);
add("MP", "Northern Mariana Islands", 536); add("MH", "Marshall Islands", 538); add("NC", "New Caledonia", 540); add("NU", "Niue", 542);
add("NR", "Nauru", 544); add("PF", "French Polynesia", 546); add("PH", "Philippines", 548); add("TL", "Timor-Leste", 550);
add("PG", "Papua New Guinea", 553); add("SB", "Solomon Islands", 557); add("AS", "American Samoa", 559); add("WS", "Samoa", 561);
add("SG", "Singapore", 563, 564, 565, 566); add("TH", "Thailand", 567); add("TO", "Tonga", 570); add("TV", "Tuvalu", 572);
add("VN", "Vietnam", 574); add("VU", "Vanuatu", 576, 577); add("WF", "Wallis and Futuna", 578); add("ZA", "South Africa", 601);
add("AO", "Angola", 603); add("DZ", "Algeria", 605); add("BJ", "Benin", 610); add("BW", "Botswana", 611); add("CM", "Cameroon", 613);
add("CG", "Congo", 615); add("KM", "Comoros", 616, 620); add("CV", "Cabo Verde", 617); add("CI", "Côte d'Ivoire", 619);
add("DJ", "Djibouti", 621); add("EG", "Egypt", 622); add("ET", "Ethiopia", 624); add("ER", "Eritrea", 625); add("GA", "Gabon", 626);
add("GH", "Ghana", 627); add("GM", "Gambia", 629); add("GW", "Guinea-Bissau", 630); add("GQ", "Equatorial Guinea", 631);
add("GN", "Guinea", 632); add("KE", "Kenya", 634); add("LR", "Liberia", 636, 637); add("LY", "Libya", 642); add("MU", "Mauritius", 645);
add("MG", "Madagascar", 647); add("MZ", "Mozambique", 650); add("MR", "Mauritania", 654); add("NG", "Nigeria", 657);
add("NA", "Namibia", 659); add("RE", "Réunion", 660); add("SD", "Sudan", 662); add("SN", "Senegal", 663); add("SC", "Seychelles", 664);
add("SH", "Saint Helena", 665); add("SO", "Somalia", 666); add("SL", "Sierra Leone", 667); add("ST", "São Tomé and Príncipe", 668);
add("TG", "Togo", 671); add("TN", "Tunisia", 672); add("TZ", "Tanzania", 674, 677); add("CD", "DR Congo", 676);
add("AR", "Argentina", 701); add("BR", "Brazil", 710); add("BO", "Bolivia", 720); add("CL", "Chile", 725); add("CO", "Colombia", 730);
add("EC", "Ecuador", 735); add("FK", "Falkland Islands", 740); add("GY", "Guyana", 750); add("PY", "Paraguay", 755); add("PE", "Peru", 760);
add("SR", "Suriname", 765); add("UY", "Uruguay", 770); add("VE", "Venezuela", 775);

export type MmsiKind = "ship" | "coast station" | "SAR aircraft" | "aid to navigation" | "craft associated with a ship" | "handheld" | "other";

/**
 * Flag (country of registration) and station kind from an MMSI. Ships carry
 * MID in the first three digits; coast stations (00MID…), aids to navigation
 * (99MID…), SAR aircraft (111MID…) etc. carry it further in.
 */
export function mmsiInfo(mmsi: number | string): { mid: number | null; country: string | null; countryName: string | null; kind: MmsiKind } {
  const s = String(mmsi).padStart(9, "0");
  let kind: MmsiKind = "other";
  let mid: number | null = null;
  if (!/^\d{9}$/.test(s)) return { mid: null, country: null, countryName: null, kind };
  if (/^[2-7]/.test(s)) [kind, mid] = ["ship", +s.slice(0, 3)];
  else if (s.startsWith("00")) [kind, mid] = ["coast station", +s.slice(2, 5)];
  else if (s.startsWith("111")) [kind, mid] = ["SAR aircraft", +s.slice(3, 6)];
  else if (s.startsWith("99")) [kind, mid] = ["aid to navigation", +s.slice(2, 5)];
  else if (s.startsWith("98")) [kind, mid] = ["craft associated with a ship", +s.slice(2, 5)];
  else if (s.startsWith("8")) [kind, mid] = ["handheld", +s.slice(1, 4)];
  const hit = mid !== null ? MID[mid] : undefined;
  return { mid, country: hit?.[0] ?? null, countryName: hit?.[1] ?? null, kind };
}

/** Regional-indicator emoji flag for an ISO alpha-2 code. */
export const flagEmoji = (cc: string | null) =>
  cc && /^[A-Z]{2}$/.test(cc) ? String.fromCodePoint(...[...cc].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)) : "";

/** Human label for an AIS "type of ship and cargo" code (ITU-R M.1371). */
export function shipTypeLabel(code: number | null | undefined): string | null {
  if (code == null || code <= 0 || code > 99) return null;
  const hazard = (d: number) => (d >= 1 && d <= 4 ? ` (hazardous cat. ${"ABCD"[d - 1]})` : "");
  const tens = Math.floor(code / 10), d = code % 10;
  const special: Record<number, string> = {
    30: "Fishing", 31: "Towing", 32: "Towing (large)", 33: "Dredging / underwater ops", 34: "Diving ops", 35: "Military ops",
    36: "Sailing", 37: "Pleasure craft", 50: "Pilot vessel", 51: "Search and rescue", 52: "Tug", 53: "Port tender",
    54: "Anti-pollution", 55: "Law enforcement", 58: "Medical transport", 59: "Non-combatant ship",
  };
  if (special[code]) return special[code];
  switch (tens) {
    case 2: return `Wing in ground${hazard(d)}`;
    case 4: return `High-speed craft${hazard(d)}`;
    case 6: return `Passenger${hazard(d)}`;
    case 7: return `Cargo${hazard(d)}`;
    case 8: return `Tanker${hazard(d)}`;
    case 9: return `Other${hazard(d)}`;
    default: return "Other";
  }
}

/**
 * The AIS ETA field packed as month<<16 | day<<11 | hour<<6 | minute (UTC,
 * no year). Returns an ISO time in the next 11 months from `now`, or null
 * when any part is "not available".
 */
export function decodeAisEta(packed: number | null | undefined, now = Date.now()): string | null {
  if (packed == null || !Number.isFinite(packed) || packed <= 0) return null;
  const month = (packed >> 16) & 0xf, day = (packed >> 11) & 0x1f, hour = (packed >> 6) & 0x1f, minute = packed & 0x3f;
  return etaFromParts(month, day, hour, minute, now);
}

/** ETA from separate fields (AISStream / NMEA type 5). */
export function etaFromParts(month: number, day: number, hour: number, minute: number, now = Date.now()): string | null {
  if (!month || month > 12 || !day || day > 31 || hour > 23 || minute > 59) return null;
  const y = new Date(now).getUTCFullYear();
  let t = Date.UTC(y, month - 1, day, hour, minute);
  // ETAs are in the future; one more than ~a month in the past means next year.
  if (t < now - 31 * 86_400_000) t = Date.UTC(y + 1, month - 1, day, hour, minute);
  return new Date(t).toISOString();
}

/** Length / beam (m) from the AIS reference-point distances A+B and C+D. */
export function aisDimensions(a?: number | null, b?: number | null, c?: number | null, d?: number | null): { lengthM: number | null; beamM: number | null } {
  const sum = (x?: number | null, y?: number | null) => (x != null && y != null && x + y > 0 && x < 511 && y < 511 ? x + y : null);
  return { lengthM: sum(a, b), beamM: sum(c, d) };
}
