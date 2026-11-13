/**
 * Fails if the repository contains personal information.
 *
 *   node .github/scripts/check-personal-info.mjs
 *
 * 1. Tracked files: any email address except GitHub noreply addresses, other noreply mailboxes
 *    and reserved example domains (example.com/.org/.net, *.example, *.test, *.invalid, *.localhost).
 * 2. Git history: commits by the owner's handle (OWNER_HANDLE, default "akshng") must use a GitHub
 *    noreply email. Other contributors' identities are their own business.
 * 3. Optional deny list: names, emails or words that must never appear in tracked files, commit
 *    identities or commit messages, read from the PERSONAL_INFO_DENYLIST environment variable (comma or newline
 *    separated, case-insensitive). Keep the list itself out of git — in CI it comes from a
 *    repository secret of the same name. Bundled third-party datasets (public/geo/) are only
 *    checked for emails, since they contain real place and plant names.
 *
 * The script prints file:line and a masked match, never the denied words themselves.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,24}\b/g;
/** Things that look like emails but are file names (`icon@2x.png`) or code. */
const FILE_TLDS = new Set(["png", "jpg", "jpeg", "gif", "svg", "webp", "avif", "ico", "js", "mjs", "cjs", "ts", "tsx", "jsx", "css", "json", "map", "md", "html", "wasm", "ttf", "woff", "woff2"]);
const EXAMPLE_DOMAINS = new Set(["example.com", "example.org", "example.net"]);
const RESERVED_TLDS = [".example", ".test", ".invalid", ".localhost"];
const NOREPLY_LOCALS = new Set(["noreply", "no-reply", "donotreply", "do-not-reply"]);
const MAX_BYTES = 5 * 1024 * 1024;
/** Third-party datasets (place and plant names) are only checked for emails, not deny-list words. */
const DENY_SKIP_PREFIXES = ["public/geo/"];

export function isAllowedEmail(email) {
  const at = email.lastIndexOf("@");
  const local = email.slice(0, at).toLowerCase();
  const domain = email.slice(at + 1).toLowerCase();
  const tld = domain.slice(domain.lastIndexOf(".") + 1);
  if (FILE_TLDS.has(tld)) return true;
  if (domain === "users.noreply.github.com" || domain.endsWith(".noreply.github.com")) return true;
  if (NOREPLY_LOCALS.has(local)) return true;
  if (EXAMPLE_DOMAINS.has(domain) || [...EXAMPLE_DOMAINS].some((d) => domain.endsWith(`.${d}`))) return true;
  if (RESERVED_TLDS.some((t) => domain.endsWith(t))) return true;
  if (local === "git" && (domain === "github.com" || domain === "gitlab.com")) return true; // SSH remotes
  return false;
}

/** The owner's commits must use a GitHub noreply address. */
export function isAllowedCommitEmail(email) {
  const e = email.toLowerCase();
  return e.endsWith("@users.noreply.github.com") || e === "noreply@github.com";
}

export function findEmails(text) {
  return [...text.matchAll(EMAIL)].map((m) => m[0]).filter((e) => !isAllowedEmail(e));
}

export function parseDenylist(raw) {
  return String(raw ?? "")
    .split(/[,\n]/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length >= 3);
}

/** Show enough to find the match without printing it. */
export function mask(s) {
  return s.length <= 2 ? "**" : `${s[0]}${"*".repeat(Math.min(s.length - 2, 12))}${s.at(-1)}`;
}

/** Problems in one file's text: [{ line, kind, masked }] */
export function scanText(text, deny = []) {
  const out = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    for (const e of findEmails(line)) out.push({ line: i + 1, kind: "email address", masked: mask(e) });
    const lower = line.toLowerCase();
    for (const d of deny) if (lower.includes(d)) out.push({ line: i + 1, kind: "denied word", masked: mask(d) });
  });
  return out;
}

const git = (args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });

function main() {
  const deny = parseDenylist(process.env.PERSONAL_INFO_DENYLIST);
  const owner = process.env.OWNER_HANDLE || "akshng";
  const problems = [];
  const files = git(["ls-files", "-z"]).split("\0").filter(Boolean);
  for (const f of files) {
    let buf;
    try {
      if (statSync(f).size > MAX_BYTES) continue;
      buf = readFileSync(f);
    } catch {
      continue; // deleted in the working tree
    }
    if (buf.subarray(0, 8000).includes(0)) continue; // binary
    const fileDeny = DENY_SKIP_PREFIXES.some((p) => f.startsWith(p)) ? [] : deny;
    for (const p of scanText(buf.toString("utf8"), fileDeny)) problems.push(`${f}:${p.line}: ${p.kind} ${p.masked}`);
    if (deny.some((d) => f.toLowerCase().includes(d))) problems.push(`${f}: denied word in file path`);
  }

  // History: a shallow clone only checks what it has (CI fetches the full history).
  const log = git(["log", "--all", "--format=%H%x1f%an%x1f%ae%x1f%cn%x1f%ce%x1f%B%x1e"]);
  for (const rec of log.split("\x1e")) {
    const [sha, an, ae, cn, ce, body = ""] = rec.replace(/^\s+/, "").split("\x1f");
    if (!sha) continue;
    const short = sha.slice(0, 10);
    for (const [who, name, email] of [["author", an, ae], ["committer", cn, ce]]) {
      if (name === owner && !isAllowedCommitEmail(email)) problems.push(`commit ${short}: ${who} ${owner} uses ${mask(email)}, not a GitHub noreply address`);
    }
    const meta = `${an}\n${ae}\n${cn}\n${ce}\n${body}`.toLowerCase();
    for (const d of deny) if (meta.includes(d)) problems.push(`commit ${short}: denied word ${mask(d)} in author, committer or message`);
  }

  if (problems.length) {
    console.error(`Personal information check failed (${problems.length}):`);
    for (const p of problems) console.error(`  ${p}`);
    console.error("\nUse the GitHub noreply address and the handle only; see CONTRIBUTING.md (Privacy).");
    process.exit(1);
  }
  console.log(`Personal information check passed: ${files.length} files${deny.length ? `, ${deny.length} denied words` : ""}, owner's commit identities OK.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
