import { describe, expect, it } from "vitest";
import { parseForm4, summarizeInsiders } from "@/lib/finance/insiders";
import { applyInsiders, evaluate, metrics } from "@/lib/finance/setups";

const xml = (owner: string, code: string, shares: number, price: number, officer = "") => `<ownershipDocument>
<reportingOwner><reportingOwnerId><rptOwnerName>${owner}</rptOwnerName></reportingOwnerId>
<reportingOwnerRelationship>${officer ? `<isOfficer>1</isOfficer><officerTitle>${officer}</officerTitle>` : "<isDirector>1</isDirector>"}</reportingOwnerRelationship></reportingOwner>
<nonDerivativeTable><nonDerivativeTransaction><transactionDate><value>2026-10-01</value></transactionDate>
<transactionCoding><transactionCode>${code}</transactionCode></transactionCoding>
<transactionAmounts><transactionShares><value>${shares}</value></transactionShares><transactionPricePerShare><value>${price}</value></transactionPricePerShare></transactionAmounts></nonDerivativeTransaction>
<nonDerivativeTransaction><transactionDate><value>2026-10-01</value></transactionDate><transactionCoding><transactionCode>A</transactionCode></transactionCoding>
<transactionAmounts><transactionShares><value>500</value></transactionShares></transactionAmounts></nonDerivativeTransaction></nonDerivativeTable></ownershipDocument>`;

describe("insider trades (Form 4)", () => {
  it("keeps open-market buys and sells, drops grants", () => {
    const t = parseForm4(xml("DOE JANE", "P", 1000, 50, "CEO"), "2026-10-02", "https://x");
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ owner: "DOE JANE", role: "CEO", code: "P", value: 50_000 });
    expect(parseForm4(xml("ROE R", "S", 10, 5), "2026-10-02", "https://x")[0].role).toBe("Director");
  });
  it("flags cluster buying and lifts a setup's score", () => {
    const trades = [...parseForm4(xml("A", "P", 2000, 50), "2026-10-02", "u"), ...parseForm4(xml("B", "P", 1000, 50), "2026-10-02", "u")];
    const s = summarizeInsiders("XYZ", "1", trades, 90, Date.parse("2026-10-20"));
    expect(s).toMatchObject({ buyers: 2, buyValue: 150_000, clusterBuy: true });
    const ramp = (n: number, a: number, b: number) => Array.from({ length: n }, (_, i) => a + ((b - a) * i) / (n - 1));
    const setup = evaluate("XYZ", "Xyz", metrics([...ramp(220, 50, 120), ...ramp(15, 119, 102)])!)!;
    const lifted = applyInsiders(setup, { buyers: 2, buyValue: 150_000, sellers: 0, sellValue: 0 });
    expect(lifted.score).toBeCloseTo(setup.score + 1.5);
    expect(lifted.signals.at(-1)).toMatch(/2 insiders bought \$150K/);
  });
});
