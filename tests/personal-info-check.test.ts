import { describe, expect, it } from "vitest";
import { findEmails, isAllowedCommitEmail, isAllowedEmail, mask, parseDenylist, scanText } from "../.github/scripts/check-personal-info.mjs";

// Real-looking addresses are assembled at runtime so this file passes the check itself.
const at = (local: string, domain: string) => `${local}${"@"}${domain}`;

describe("personal-info check", () => {
  it("allows noreply, example and reserved domains", () => {
    for (const ok of [
      "69411132+akshng@users.noreply.github.com",
      "noreply@anthropic.com",
      "you@example.com",
      "a.b@mail.example.org",
      "x@host.test",
      "git@github.com",
      "logo@2x.png",
    ])
      expect(isAllowedEmail(ok)).toBe(true);
  });

  it("flags real-looking addresses", () => {
    const a = at("jane.doe", "gmail.com");
    const b = at("team", "company.io");
    expect(findEmails(`contact: ${a}, ${b}`)).toEqual([a, b]);
    expect(findEmails('UA "WorldView (you@example.com)" react@19.2.8 @types/node')).toEqual([]);
  });

  it("only accepts GitHub noreply commit identities", () => {
    expect(isAllowedCommitEmail("69411132+akshng@users.noreply.github.com")).toBe(true);
    expect(isAllowedCommitEmail("49699333+dependabot[bot]@users.noreply.github.com")).toBe(true);
    expect(isAllowedCommitEmail("noreply@github.com")).toBe(true);
    expect(isAllowedCommitEmail(at("someone", "gmail.com"))).toBe(false);
  });

  it("checks deny-list words case-insensitively and masks output", () => {
    const deny = parseDenylist("Alice Placeholder, ab,\nbob");
    expect(deny).toEqual(["alice placeholder", "bob"]);
    const found = scanText(`ok\nBy ALICE PLACEHOLDER\n${at("me", "corp.com")}`, deny);
    expect(found).toEqual([
      { line: 2, kind: "denied word", masked: "a************r" },
      { line: 3, kind: "email address", masked: "m*********m" },
    ]);
    expect(mask("bob")).toBe("b*b");
  });
});
