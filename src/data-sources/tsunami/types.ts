/** NOAA Tsunami Warning Centers Atom feeds (NTWC Palmer AK, PTWC Honolulu). https://www.tsunami.gov/ */
export interface TsunamiRaw {
  feeds: Array<{ center: string; xml: string }>;
}
