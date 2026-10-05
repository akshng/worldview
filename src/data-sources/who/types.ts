/** WHO Disease Outbreak News (public JSON API behind who.int). */
export interface WhoDonItem {
  Id: string;
  Title: string;
  OverrideTitle?: string | null;
  UrlName: string;
  DonId: string;
  PublicationDate: string;
  LastModified: string;
  Summary?: string | null;
  Overview?: string | null;
  Assessment?: string | null;
}
export interface WhoDonResponse {
  value: WhoDonItem[];
}
