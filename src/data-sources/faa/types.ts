/** FAA NAS Status airport delay programs (XML). https://nasstatus.faa.gov/ */
export interface FaaRaw {
  xml: string;
}
export interface FaaDelay {
  airport: string;
  kind: "ground-delay" | "ground-stop" | "closure" | "arrival-departure-delay";
  reason: string;
  detail: string;
}
