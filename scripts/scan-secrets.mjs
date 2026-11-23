import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
const files = execFileSync("git", ["ls-files", "-z"])
  .toString()
  .split("\0")
  .filter(Boolean);
const patterns = [
  /(?:sk|ghp|gho|github_pat)[-_][A-Za-z0-9_\-]{16,}/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /(?:api[_-]?key|secret|password|access[_-]?token)\s*["']?\s*[:=]\s*["'][^"'\n\s]{8,}["']/i,
  /(?:xsec_token|access_token|refresh_token)=[A-Za-z0-9%_\-]{12,}/,
  /\/Users\/[^/\s]+\//,
];
const forbidden =
  /(^|\/)(?:\.env(?:\..*)?|settings\.json|node_modules|\.data|cookies?\.json|credentials[^/]*)(\/|$)/i;
const findings = [];
for (const file of files) {
  if (file !== ".env.example" && forbidden.test(file))
    findings.push(file + " (excluded file type)");
  const text = readFileSync(file, "utf8");
  for (const pattern of patterns)
    if (pattern.test(text))
      findings.push(file + " (sensitive content pattern)");
  for (const [name, value] of Object.entries(process.env)) {
    if (
      /key|token|secret|password/i.test(name) &&
      value.length >= 12 &&
      text.includes(value)
    )
      findings.push(file + " (environment credential match)");
  }
}
if (findings.length) {
  console.error([...new Set(findings)].join("\n"));
  process.exitCode = 1;
} else
  console.log(
    `Scanned ${files.length} tracked files; no sensitive patterns or supplied environment credentials detected.`,
  );
