/**
 * Connector registry. To add a data source, create src/data-sources/<id>/ and
 * add its connector here. See docs/DATA_SOURCES.md.
 */
import type { DataSourceConnector } from "./types";
import { usgsConnector } from "./usgs";
import { gdeltConnector } from "./gdelt";
import { gkgConnector } from "./gdelt-gkg";
import { firmsConnector } from "./nasa-firms";
import { weatherConnector } from "./weather";
import { gdacsConnector } from "./gdacs";
import { eonetConnector } from "./eonet";
import { spaceConnector } from "./space";
import { iodaConnector } from "./ioda";
import { faaConnector } from "./faa";
import { tsunamiConnector } from "./tsunami";
import { whoConnector } from "./who";
import { secConnector } from "./sec";
import { meteoalarmConnector } from "./meteoalarm";
import { emscConnector } from "./emsc";
import { usgsVolcanoConnector } from "./usgs-volcano";
import { cemsConnector } from "./copernicus-ems";
import { ukFloodsConnector } from "./uk-floods";
import { nhcConnector } from "./nhc";
import { spcReportsConnector } from "./spc-reports";
import { nifcConnector } from "./nifc";
import { newsRssConnector } from "./news-rss";
import { federalRegisterConnector } from "./federal-register";
import { travelAdvisoriesConnector } from "./travel-advisories";
import { fcdoTravelConnector } from "./fcdo-travel";
import { canadaTravelConnector } from "./canada-travel";
import { cdcTravelConnector } from "./cdc-travel";
import { adsbEmergencyConnector } from "./adsb-emergency";
import { wikipediaEventsConnector } from "./wikipedia-events";
import { airQualityConnector } from "./air-quality";
import { fdicFailuresConnector } from "./fdic-failures";
import { fireballsConnector } from "./fireballs";
import { ecccConnector } from "./eccc";
import { auEmergencyConnector } from "./au-emergency";
import { jmaQuakeConnector } from "./jma-quake";
import { jmaVolcanoConnector } from "./jma-volcano";
import { bmkgConnector } from "./bmkg";
import { geonetConnector } from "./geonet";
import { afadConnector } from "./afad";
import { ssnMexicoConnector } from "./ssn-mexico";
import { hkoWarningsConnector } from "./hko-warnings";
import { centralBanksConnector } from "./central-banks";
import { ofacSanctionsConnector } from "./ofac-sanctions";
import { sanctionsNewsConnector } from "./sanctions-news";
import { cloudStatusConnector, appStatusConnector } from "./status-pages";
import { fdaRecallsConnector } from "./fda-recalls";
import { cpscRecallsConnector } from "./cpsc-recalls";
import { hibpBreachesConnector } from "./hibp-breaches";
import { unPressConnector } from "./un-press";
import { nasdaqHaltsConnector } from "./nasdaq-halts";
import { secInsiderBuysConnector } from "./sec-insider-buys";
import { secEnforcementConnector } from "./sec-enforcement";
import { treasuryAuctionsConnector } from "./treasury-auctions";
import { ecdcConnector } from "./ecdc";
import { iaeaConnector } from "./iaea";
import { volcanicAshConnector } from "./volcanic-ash";
import { defenseReleasesConnector } from "./defense-releases";
import { eiaEnergyConnector } from "./eia-energy";
import { tradePolicyConnector } from "./trade-policy";
import { fdaMedwatchConnector } from "./fda-medwatch";
import { nasaNewsConnector } from "./nasa-news";
import { marketRegulatorsConnector } from "./market-regulators";
import { dojPressConnector } from "./doj-press";
import { euCommissionConnector } from "./eu-commission";
import { usEconomicReleasesConnector } from "./us-economic-releases";
import { ifrcAppealsConnector } from "./ifrc-appeals";
import { swpcAlertsConnector } from "./swpc-alerts";
import { faaTfrConnector } from "./faa-tfr";
import { riverFloodingConnector } from "./river-flooding";
import { spcWatchesConnector } from "./spc-watches";
import { geofonConnector } from "./geofon";
import { cyberAdvisoriesConnector } from "./cyber-advisories";
import { ukDefenceConnector } from "./uk-defence";
import { femaDeclarationsConnector } from "./fema-declarations";
import { sec13dConnector } from "./sec-13d";
import { ingvConnector } from "./ingv";
import { ignSpainConnector } from "./ign-spain";
import { nrcanQuakesConnector } from "./nrcan-quakes";
import { inmetAlertsConnector } from "./inmet-alerts";
import { effisBurntAreasConnector } from "./effis-burnt-areas";
import { cneosCloseApproachesConnector } from "./cneos-close-approaches";
import { panamaCanalConnector } from "./panama-canal";
import { whoAfroConnector } from "./who-afro";
import { esaNewsConnector } from "./esa-news";
import { ecbStatisticsConnector } from "./ecb-statistics";
import { demoConnector } from "./demo";

export const CONNECTORS = [
  usgsConnector,
  emscConnector,
  geofonConnector,
  ingvConnector,
  ignSpainConnector,
  nrcanQuakesConnector,
  jmaQuakeConnector,
  bmkgConnector,
  geonetConnector,
  afadConnector,
  ssnMexicoConnector,
  gdacsConnector,
  nhcConnector,
  spcReportsConnector,
  spcWatchesConnector,
  weatherConnector,
  meteoalarmConnector,
  ecccConnector,
  auEmergencyConnector,
  hkoWarningsConnector,
  inmetAlertsConnector,
  ukFloodsConnector,
  riverFloodingConnector,
  eonetConnector,
  usgsVolcanoConnector,
  jmaVolcanoConnector,
  volcanicAshConnector,
  cemsConnector,
  femaDeclarationsConnector,
  firmsConnector,
  nifcConnector,
  effisBurntAreasConnector,
  gdeltConnector,
  gkgConnector,
  newsRssConnector,
  wikipediaEventsConnector,
  spaceConnector,
  fireballsConnector,
  cneosCloseApproachesConnector,
  swpcAlertsConnector,
  nasaNewsConnector,
  esaNewsConnector,
  tsunamiConnector,
  faaConnector,
  faaTfrConnector,
  panamaCanalConnector,
  adsbEmergencyConnector,
  iodaConnector,
  cloudStatusConnector,
  appStatusConnector,
  cyberAdvisoriesConnector,
  // ransomwareLiveConnector — off: the API answers browsers but returns 404 to WorldView's
  // honest User-Agent, and we don't disguise the client. Re-enable if that changes.
  hibpBreachesConnector,
  whoConnector,
  ecdcConnector,
  whoAfroConnector,
  fdaRecallsConnector,
  cpscRecallsConnector,
  fdaMedwatchConnector,
  ifrcAppealsConnector,
  cdcTravelConnector,
  airQualityConnector,
  travelAdvisoriesConnector,
  fcdoTravelConnector,
  canadaTravelConnector,
  // smartravellerConnector — off: smartraveller.gov.au resets connections from automated
  // clients (0 events ever). Kept in the codebase in case that changes.
  federalRegisterConnector,
  unPressConnector,
  iaeaConnector,
  euCommissionConnector,
  defenseReleasesConnector,
  ukDefenceConnector,
  dojPressConnector,
  tradePolicyConnector,
  ofacSanctionsConnector,
  sanctionsNewsConnector,
  centralBanksConnector,
  ecbStatisticsConnector,
  usEconomicReleasesConnector,
  eiaEnergyConnector,
  marketRegulatorsConnector,
  secConnector,
  secInsiderBuysConnector,
  sec13dConnector,
  secEnforcementConnector,
  nasdaqHaltsConnector,
  treasuryAuctionsConnector,
  fdicFailuresConnector,
  demoConnector,
] as unknown as DataSourceConnector<unknown>[];

export function getConnector(id: string): DataSourceConnector<unknown> | undefined {
  return CONNECTORS.find((c) => c.id === id);
}
