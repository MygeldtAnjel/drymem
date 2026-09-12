/**
 * What a skill has to survive before it reaches anyone's laptop.
 *
 * A skill is instructions an agent follows with the developer's own
 * credentials, on every machine on the project. Accepting one because it
 * arrived from a URL somebody trusted is how a team ends up running `curl | sh`
 * inside its coding agent.
 *
 * Two severities, and the difference matters:
 *
 * * **reject** — a credential. Nothing to discuss; the publish fails and the
 *   author is told to rotate it, exactly as the memory scrubber does.
 * * **review** — everything else. The version is stored as `pending` and an
 *   admin reads the finding. Blocking outright on a heuristic would make the
 *   product unusable; accepting silently would make it dangerous.
 *
 * The structure rules are a linter, not security: a skill without frontmatter
 * is one no agent will load, and finding that out on publish beats finding it
 * out when nothing happens.
 */

import type { Finding } from "../db/schema.js";

interface Rule {
  name: string;
  severity: Finding["severity"];
  pattern: RegExp;
  detail: string;
}

/**
 * Credentials. Deliberately the same shapes the memory scrubber knows, because
 * the two are guarding the same thing from different directions.
 */
const SECRETS: Rule[] = [
  {
    name: "aws-key",
    severity: "reject",
    pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/,
    detail: "An AWS access key id. Rotate it.",
  },
  {
    name: "aws-secret",
    severity: "reject",
    pattern: /\baws_secret_access_key\s*[=:]\s*["']?[A-Za-z0-9/+=]{40}/i,
    detail: "An AWS secret access key. Rotate it.",
  },
  {
    name: "private-key",
    severity: "reject",
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/,
    detail: "A private key block. Rotate it.",
  },
  {
    name: "bearer-token",
    severity: "reject",
    pattern: /\b(?:sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{36}|xox[baprs]-[A-Za-z0-9-]{10,})/,
    detail: "An API token. Rotate it.",
  },
  {
    name: "assigned-secret",
    severity: "reject",
    pattern:
      /\b[A-Z0-9_]*(?:SECRET|PASSWORD|TOKEN|API_KEY|APIKEY)[A-Z0-9_]*\s*[=:]\s*["']?[^\s"'<>{}]{12,}/,
    detail: "Something that looks like a credential assigned to a variable.",
  },
];

/**
 * Exfiltration and injection.
 *
 * All `review`, never `reject`: every one of these has a legitimate use in a
 * skill about deployment or about shell scripting, and a security check that
 * blocks honest work gets turned off.
 */
const BEHAVIOUR: Rule[] = [
  {
    name: "pipe-to-shell",
    severity: "review",
    pattern: /\b(?:curl|wget)\b[^\n|]*\|\s*(?:sudo\s+)?(?:ba)?sh\b/,
    detail: "Downloads and executes a script in one step.",
  },
  {
    name: "posts-elsewhere",
    severity: "review",
    pattern: /\b(?:curl|wget|fetch)\b[^\n]*-(?:d|-data|-data-raw)\b[^\n]*https?:\/\//,
    detail: "Sends data to a URL. Check what, and where to.",
  },
  {
    name: "reads-credentials",
    severity: "review",
    pattern: /(?:~\/\.(?:aws|ssh|config\/gcloud|npmrc|netrc)|\.env\b|id_rsa)\b/,
    detail: "Reaches for credential files on the developer's machine.",
  },
  {
    name: "ignore-instructions",
    severity: "review",
    pattern: /\bignore (?:all |any )?(?:previous|prior|above|earlier) instructions?\b/i,
    detail: "Tries to override the instructions the agent already had.",
  },
  {
    name: "hidden-text",
    severity: "review",
    // Zero-width and directional marks: text a reviewer cannot see and a model
    // reads perfectly well.
    pattern: /[​-‏‪-‮⁠-⁤]/,
    detail: "Contains invisible characters a reviewer cannot see.",
  },
  {
    name: "base64-blob",
    severity: "review",
    pattern: /\b[A-Za-z0-9+/]{220,}={0,2}\b/,
    detail: "A long encoded blob. Nothing in a skill should need one.",
  },
];

/** Structure. A skill that does not look like one will never be loaded. */
function lint(content: string): Finding[] {
  const findings: Finding[] = [];
  const lines = content.split("\n");

  if (lines[0]?.trim() !== "---") {
    findings.push({
      rule: "no-frontmatter",
      severity: "review",
      detail: "A SKILL.md starts with a `---` frontmatter block; agents skip one without it.",
      line: 1,
    });
  } else {
    const close = lines.findIndex((line, i) => i > 0 && line.trim() === "---");
    const head = close > 0 ? lines.slice(1, close).join("\n") : "";
    if (!/^name\s*:/m.test(head)) {
      findings.push({
        rule: "no-name",
        severity: "review",
        detail: "The frontmatter has no `name:`.",
        line: 2,
      });
    }
    if (!/^description\s*:/m.test(head)) {
      findings.push({
        rule: "no-description",
        severity: "review",
        detail: "The frontmatter has no `description:` — that is what decides when it loads.",
        line: 2,
      });
    }
  }

  if (content.length > 40_000) {
    findings.push({
      rule: "too-long",
      severity: "review",
      detail: "Over 40,000 characters. A skill people actually read is a fraction of that.",
    });
  }
  return findings;
}

export function scan(content: string, files: Record<string, string> = {}): Finding[] {
  const findings: Finding[] = [...lint(content)];
  const everything = [["SKILL.md", content], ...Object.entries(files)] as [string, string][];

  for (const [path, body] of everything) {
    const lines = body.split("\n");
    for (const rule of [...SECRETS, ...BEHAVIOUR]) {
      // `findIndex` over lines rather than a match on the whole body: the line
      // number is what makes a finding actionable for the person reviewing it.
      const at = lines.findIndex((line) => rule.pattern.test(line));
      if (at === -1) continue;
      findings.push({
        rule: rule.name,
        severity: rule.severity,
        // The finding names the rule and the place, never the value it matched.
        // A scan report that quotes the secret is a second copy of the secret.
        detail: path === "SKILL.md" ? rule.detail : `${rule.detail} (in ${path})`,
        line: at + 1,
      });
    }
  }
  return findings;
}

export const rejects = (findings: Finding[]): boolean =>
  findings.some((f) => f.severity === "reject");
