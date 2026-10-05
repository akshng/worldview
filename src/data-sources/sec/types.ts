/** SEC EDGAR "latest filings" Atom feed + company submissions JSON. https://www.sec.gov/edgar */
export interface SecFilingEntry {
  form: string;
  company: string;
  cik: string;
  url: string;
  accession: string;
  filedAt: string;
  items: string[]; // e.g. ["2.02", "9.01"]
}

export interface SecCompany {
  cik: string;
  name: string;
  tickers: string[];
  exchanges: string[];
  sicDescription: string | null;
  city: string | null;
  stateOrCountry: string | null;
  countryDescription: string | null;
}

export interface SecRaw {
  entries: SecFilingEntry[];
  companies: Record<string, SecCompany>;
}
