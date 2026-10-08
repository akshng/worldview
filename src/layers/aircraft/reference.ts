/**
 * Small reference tables for aircraft details: country of registration from
 * the ICAO 24-bit address block (ICAO Annex 10 allocations), common ICAO type
 * designators, airline ICAO prefixes, emitter categories and special squawks.
 * Deliberately compact — common cases only; unknown values stay null.
 */

/** [start, end (inclusive), ISO alpha-2, name] — the most specific (smallest) block wins. */
const ICAO_BLOCKS: Array<[number, number, string, string]> = [
  [0x008000, 0x00ffff, "ZA", "South Africa"], [0x010000, 0x017fff, "EG", "Egypt"], [0x06a000, 0x06a3ff, "QA", "Qatar"],
  [0x0ac000, 0x0acfff, "CO", "Colombia"], [0x0d0000, 0x0d7fff, "MX", "Mexico"], [0x100000, 0x1fffff, "RU", "Russia"],
  [0x300000, 0x33ffff, "IT", "Italy"], [0x340000, 0x37ffff, "ES", "Spain"], [0x380000, 0x3bffff, "FR", "France"],
  [0x3c0000, 0x3fffff, "DE", "Germany"], [0x400000, 0x43ffff, "GB", "United Kingdom"], [0x440000, 0x447fff, "AT", "Austria"],
  [0x448000, 0x44ffff, "BE", "Belgium"], [0x450000, 0x457fff, "BG", "Bulgaria"], [0x458000, 0x45ffff, "DK", "Denmark"],
  [0x460000, 0x467fff, "FI", "Finland"], [0x468000, 0x46ffff, "GR", "Greece"], [0x470000, 0x477fff, "HU", "Hungary"],
  [0x478000, 0x47ffff, "NO", "Norway"], [0x480000, 0x487fff, "NL", "Netherlands"], [0x488000, 0x48ffff, "PL", "Poland"],
  [0x490000, 0x497fff, "PT", "Portugal"], [0x498000, 0x49ffff, "CZ", "Czechia"], [0x4a0000, 0x4a7fff, "RO", "Romania"],
  [0x4a8000, 0x4affff, "SE", "Sweden"], [0x4b0000, 0x4b7fff, "CH", "Switzerland"], [0x4b8000, 0x4bffff, "TR", "Türkiye"],
  [0x4c0000, 0x4c7fff, "RS", "Serbia"], [0x4c8000, 0x4c83ff, "CY", "Cyprus"], [0x4ca000, 0x4cafff, "IE", "Ireland"],
  [0x4cc000, 0x4ccfff, "IS", "Iceland"], [0x4d0000, 0x4d03ff, "LU", "Luxembourg"], [0x4d2000, 0x4d23ff, "MT", "Malta"],
  [0x500000, 0x5003ff, "SM", "San Marino"], [0x501000, 0x5013ff, "AL", "Albania"], [0x501c00, 0x501fff, "HR", "Croatia"],
  [0x502c00, 0x502fff, "LV", "Latvia"], [0x503c00, 0x503fff, "LT", "Lithuania"], [0x504c00, 0x504fff, "MD", "Moldova"],
  [0x505c00, 0x505fff, "SK", "Slovakia"], [0x506c00, 0x506fff, "SI", "Slovenia"], [0x507c00, 0x507fff, "UZ", "Uzbekistan"],
  [0x508000, 0x50ffff, "UA", "Ukraine"], [0x510000, 0x5103ff, "BY", "Belarus"], [0x511000, 0x5113ff, "EE", "Estonia"],
  [0x512000, 0x5123ff, "MK", "North Macedonia"], [0x513000, 0x5133ff, "BA", "Bosnia and Herzegovina"], [0x514000, 0x5143ff, "GE", "Georgia"],
  [0x600000, 0x6003ff, "AM", "Armenia"], [0x600800, 0x600bff, "AZ", "Azerbaijan"], [0x683000, 0x6833ff, "KZ", "Kazakhstan"],
  [0x700000, 0x700fff, "AF", "Afghanistan"], [0x702000, 0x702fff, "BD", "Bangladesh"], [0x704000, 0x704fff, "MM", "Myanmar"],
  [0x706000, 0x706fff, "KW", "Kuwait"], [0x708000, 0x708fff, "LA", "Laos"], [0x70a000, 0x70afff, "NP", "Nepal"],
  [0x70c000, 0x70c3ff, "OM", "Oman"], [0x70e000, 0x70efff, "KH", "Cambodia"], [0x710000, 0x717fff, "SA", "Saudi Arabia"],
  [0x718000, 0x71ffff, "KR", "South Korea"], [0x720000, 0x727fff, "KP", "North Korea"], [0x728000, 0x72ffff, "IQ", "Iraq"],
  [0x730000, 0x737fff, "IR", "Iran"], [0x738000, 0x73ffff, "IL", "Israel"], [0x740000, 0x747fff, "JO", "Jordan"],
  [0x748000, 0x74ffff, "LB", "Lebanon"], [0x750000, 0x757fff, "MY", "Malaysia"], [0x758000, 0x75ffff, "PH", "Philippines"],
  [0x760000, 0x767fff, "PK", "Pakistan"], [0x768000, 0x76ffff, "SG", "Singapore"], [0x770000, 0x777fff, "LK", "Sri Lanka"],
  [0x778000, 0x77ffff, "SY", "Syria"], [0x780000, 0x7bffff, "CN", "China"], [0x7c0000, 0x7fffff, "AU", "Australia"],
  [0x800000, 0x83ffff, "IN", "India"], [0x840000, 0x87ffff, "JP", "Japan"], [0x880000, 0x887fff, "TH", "Thailand"],
  [0x888000, 0x88ffff, "VN", "Vietnam"], [0x890000, 0x890fff, "YE", "Yemen"], [0x894000, 0x894fff, "BH", "Bahrain"],
  [0x895000, 0x8953ff, "BN", "Brunei"], [0x896000, 0x896fff, "AE", "United Arab Emirates"], [0x899000, 0x8993ff, "TW", "Taiwan"],
  [0x8a0000, 0x8a7fff, "ID", "Indonesia"], [0x900000, 0x9003ff, "MH", "Marshall Islands"], [0xa00000, 0xafffff, "US", "United States"],
  [0xc00000, 0xc3ffff, "CA", "Canada"], [0xc80000, 0xc87fff, "NZ", "New Zealand"], [0xc88000, 0xc88fff, "FJ", "Fiji"],
  [0xe00000, 0xe3ffff, "AR", "Argentina"], [0xe40000, 0xe7ffff, "BR", "Brazil"], [0xe80000, 0xe80fff, "CL", "Chile"],
  [0xe84000, 0xe84fff, "EC", "Ecuador"], [0xe88000, 0xe88fff, "PY", "Paraguay"], [0xe8c000, 0xe8cfff, "PE", "Peru"],
  [0xe90000, 0xe90fff, "UY", "Uruguay"], [0xe94000, 0xe94fff, "BO", "Bolivia"],
  [0x0b0000, 0x0b0fff, "CU", "Cuba"], [0x0d8000, 0x0dffff, "VE", "Venezuela"], [0x0a0000, 0x0a7fff, "DZ", "Algeria"],
  [0x020000, 0x027fff, "MA", "Morocco"], [0x028000, 0x02ffff, "TN", "Tunisia"], [0x018000, 0x01ffff, "LY", "Libya"],
  [0x040000, 0x040fff, "ET", "Ethiopia"], [0x04c000, 0x04cfff, "KE", "Kenya"], [0x064000, 0x064fff, "NG", "Nigeria"],
];

/** Country of registration implied by an ICAO 24-bit address (hex). */
export function icaoCountry(hex: string | null | undefined): { code: string; name: string } | null {
  if (!hex || !/^[0-9a-f]{6}$/i.test(hex)) return null;
  const n = parseInt(hex, 16);
  let best: [number, number, string, string] | null = null;
  for (const b of ICAO_BLOCKS) if (n >= b[0] && n <= b[1] && (!best || b[1] - b[0] < best[1] - best[0])) best = b;
  return best ? { code: best[2], name: best[3] } : null;
}

/** Common ICAO aircraft type designators. */
const TYPES: Record<string, string> = {
  A19N: "Airbus A319neo", A20N: "Airbus A320neo", A21N: "Airbus A321neo", A318: "Airbus A318", A319: "Airbus A319", A320: "Airbus A320",
  A321: "Airbus A321", A332: "Airbus A330-200", A333: "Airbus A330-300", A338: "Airbus A330-800neo", A339: "Airbus A330-900neo",
  A343: "Airbus A340-300", A346: "Airbus A340-600", A359: "Airbus A350-900", A35K: "Airbus A350-1000", A388: "Airbus A380-800",
  A400: "Airbus A400M Atlas", BCS1: "Airbus A220-100", BCS3: "Airbus A220-300", B712: "Boeing 717", B733: "Boeing 737-300",
  B734: "Boeing 737-400", B735: "Boeing 737-500", B736: "Boeing 737-600", B737: "Boeing 737-700", B738: "Boeing 737-800",
  B739: "Boeing 737-900", B37M: "Boeing 737 MAX 7", B38M: "Boeing 737 MAX 8", B39M: "Boeing 737 MAX 9", B3XM: "Boeing 737 MAX 10",
  B744: "Boeing 747-400", B748: "Boeing 747-8", B752: "Boeing 757-200", B753: "Boeing 757-300", B762: "Boeing 767-200",
  B763: "Boeing 767-300", B764: "Boeing 767-400", B772: "Boeing 777-200", B77L: "Boeing 777-200LR/F", B773: "Boeing 777-300",
  B77W: "Boeing 777-300ER", B778: "Boeing 777-8", B779: "Boeing 777-9", B788: "Boeing 787-8", B789: "Boeing 787-9", B78X: "Boeing 787-10",
  E170: "Embraer 170", E175: "Embraer 175", E190: "Embraer 190", E195: "Embraer 195", E290: "Embraer E190-E2", E295: "Embraer E195-E2",
  E135: "Embraer ERJ-135", E145: "Embraer ERJ-145", CRJ2: "Bombardier CRJ200", CRJ7: "Bombardier CRJ700", CRJ9: "Bombardier CRJ900",
  CRJX: "Bombardier CRJ1000", DH8A: "Dash 8-100", DH8C: "Dash 8-300", DH8D: "Dash 8-400", AT43: "ATR 42-300", AT45: "ATR 42-500",
  AT72: "ATR 72", AT75: "ATR 72-500", AT76: "ATR 72-600", SF34: "Saab 340", SB20: "Saab 2000", C208: "Cessna 208 Caravan",
  C172: "Cessna 172", C182: "Cessna 182", C152: "Cessna 152", PC12: "Pilatus PC-12", PC24: "Pilatus PC-24", BE20: "Beech King Air 200",
  B350: "Beech King Air 350", C56X: "Cessna Citation Excel", C680: "Cessna Citation Sovereign", C68A: "Cessna Citation Latitude",
  C700: "Cessna Citation Longitude", CL30: "Bombardier Challenger 300", CL35: "Bombardier Challenger 350", CL60: "Bombardier Challenger 600",
  GLEX: "Bombardier Global Express", GL5T: "Bombardier Global 5000", GL7T: "Bombardier Global 7500", GLF4: "Gulfstream IV",
  GLF5: "Gulfstream V", GLF6: "Gulfstream G650", G280: "Gulfstream G280", F2TH: "Dassault Falcon 2000", FA7X: "Dassault Falcon 7X",
  FA8X: "Dassault Falcon 8X", LJ45: "Learjet 45", PC6T: "Pilatus PC-6", DA40: "Diamond DA40", DA42: "Diamond DA42", SR22: "Cirrus SR22",
  P28A: "Piper PA-28", EC35: "Airbus H135", EC45: "Airbus H145", EC30: "Airbus H130", AS50: "Airbus AS350", A139: "Leonardo AW139",
  A169: "Leonardo AW169", S76: "Sikorsky S-76", S92: "Sikorsky S-92", R44: "Robinson R44", R22: "Robinson R22", B06: "Bell 206",
  B407: "Bell 407", B412: "Bell 412", H60: "Sikorsky H-60 Black Hawk", H47: "Boeing CH-47 Chinook", H53S: "Sikorsky CH-53E",
  V22: "Bell Boeing V-22 Osprey", C130: "Lockheed C-130 Hercules", C30J: "Lockheed C-130J Super Hercules", C17: "Boeing C-17 Globemaster III",
  C5M: "Lockheed C-5M Galaxy", K35R: "Boeing KC-135R Stratotanker", KC46: "Boeing KC-46 Pegasus", E3TF: "Boeing E-3 Sentry",
  P8: "Boeing P-8 Poseidon", RC35: "Boeing RC-135", E6: "Boeing E-6 Mercury", F16: "General Dynamics F-16", F35: "Lockheed F-35",
  EUFI: "Eurofighter Typhoon", A10: "Fairchild A-10", B52: "Boeing B-52", GLID: "Glider", BALL: "Balloon",
};
export const typeName = (designator: string | null | undefined) => (designator ? TYPES[designator.toUpperCase()] ?? null : null);

/** Airline / operator from the 3-letter ICAO prefix of an airline callsign. */
const AIRLINES: Record<string, string> = {
  AAL: "American Airlines", DAL: "Delta Air Lines", UAL: "United Airlines", SWA: "Southwest Airlines", ASA: "Alaska Airlines",
  JBU: "JetBlue", NKS: "Spirit Airlines", FFT: "Frontier Airlines", SKW: "SkyWest", RPA: "Republic Airways", ENY: "Envoy Air",
  EDV: "Endeavor Air", FDX: "FedEx", UPS: "UPS Airlines", ACA: "Air Canada", WJA: "WestJet", AMX: "Aeroméxico", VOI: "Volaris",
  BAW: "British Airways", VIR: "Virgin Atlantic", EZY: "easyJet", EJU: "easyJet Europe", RYR: "Ryanair", RUK: "Ryanair UK",
  WZZ: "Wizz Air", DLH: "Lufthansa", EWG: "Eurowings", CFG: "Condor", AFR: "Air France", KLM: "KLM", TRA: "Transavia",
  IBE: "Iberia", VLG: "Vueling", AEA: "Air Europa", TAP: "TAP Air Portugal", ITY: "ITA Airways", SWR: "Swiss", AUA: "Austrian Airlines",
  BEL: "Brussels Airlines", SAS: "SAS", NOZ: "Norwegian", NSZ: "Norwegian", FIN: "Finnair", LOT: "LOT Polish Airlines", AEE: "Aegean",
  THY: "Turkish Airlines", PGT: "Pegasus", SXS: "SunExpress", EIN: "Aer Lingus", ICE: "Icelandair", UAE: "Emirates", ETD: "Etihad",
  QTR: "Qatar Airways", SVA: "Saudia", ELY: "El Al", MSR: "EgyptAir", ETH: "Ethiopian Airlines", KQA: "Kenya Airways",
  SAA: "South African Airways", RAM: "Royal Air Maroc", AIC: "Air India", IGO: "IndiGo", SIA: "Singapore Airlines", CPA: "Cathay Pacific",
  JAL: "Japan Airlines", ANA: "All Nippon Airways", KAL: "Korean Air", AAR: "Asiana", CCA: "Air China", CES: "China Eastern",
  CSN: "China Southern", HDA: "Cathay Dragon", QFA: "Qantas", VOZ: "Virgin Australia", ANZ: "Air New Zealand", THA: "Thai Airways",
  MAS: "Malaysia Airlines", GIA: "Garuda Indonesia", PAL: "Philippine Airlines", VJC: "VietJet", HVN: "Vietnam Airlines",
  LAN: "LATAM", TAM: "LATAM Brasil", GLO: "Gol", AZU: "Azul", AVA: "Avianca", CMP: "Copa Airlines", ARG: "Aerolíneas Argentinas",
  GTI: "Atlas Air", CLX: "Cargolux", BCS: "European Air Transport (DHL)", DHK: "DHL Air UK", ABW: "AirBridgeCargo", NCA: "Nippon Cargo",
  RCH: "US Air Force (Air Mobility Command)", CNV: "US Navy", PAT: "US Army", RRR: "Royal Air Force", GAF: "German Air Force",
  CTM: "French Air Force", IAM: "Italian Air Force", NATO: "NATO", DUKE: "US Army",
};
export function airlineFromCallsign(callsign: string | null | undefined): string | null {
  const m = /^([A-Z]{3})\d/.exec((callsign ?? "").trim().toUpperCase());
  return m ? AIRLINES[m[1]] ?? null : null;
}

/** ADS-B emitter category. */
const CATEGORIES: Record<string, string> = {
  A1: "Light (< 7 t)", A2: "Small (7–34 t)", A3: "Large (34–136 t)", A4: "High-vortex large (B757)", A5: "Heavy (> 136 t)",
  A6: "High performance", A7: "Rotorcraft", B1: "Glider", B2: "Lighter than air", B3: "Parachutist", B4: "Ultralight",
  B6: "Unmanned aerial vehicle", B7: "Space vehicle", C1: "Surface emergency vehicle", C2: "Surface service vehicle", C3: "Ground obstruction",
};
export const categoryLabel = (c: string | null | undefined) => (c ? CATEGORIES[c.toUpperCase()] ?? null : null);

/** Meaning of the special-purpose transponder codes. */
export function squawkMeaning(squawk: string | null | undefined): string | null {
  switch (squawk) {
    case "7500": return "Unlawful interference (hijack)";
    case "7600": return "Radio failure";
    case "7700": return "General emergency";
    case "7000": return "VFR (Europe)";
    case "1200": return "VFR (North America)";
    case "2000": return "No assigned code";
    default: return null;
  }
}
