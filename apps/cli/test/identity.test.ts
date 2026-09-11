/**
 * Identity parity with the Python server.
 *
 * Both implementations read `packages/api-types/fixtures/remotes.json`. If one
 * side changes behaviour the other's suite goes red, which is the only thing
 * standing between us and a team silently split across two project keys.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import fixtures from "../../../packages/api-types/fixtures/remotes.json";
import {
  groupIdFor,
  groupIdPrivate,
  groupIdTeam,
  normalizeRemote,
  resolveAuthor,
  resolveProjectKey,
  resolveSshHost,
  sanitizeGroupId,
} from "../src/identity.js";

function initRepo(path: string, remote?: string): string {
  execFileSync("mkdir", ["-p", path]);
  execFileSync("git", ["init", "-q"], { cwd: path });
  if (remote) execFileSync("git", ["remote", "add", "origin", remote], { cwd: path });
  return path;
}

describe("normalizeRemote — shared fixture", () => {
  for (const { url, key } of fixtures.canonical) {
    it(`${JSON.stringify(url)} -> ${key}`, () => {
      expect(normalizeRemote(url)).toBe(key);
    });
  }

  for (const url of fixtures.rejected) {
    it(`rejects ${JSON.stringify(url)}`, () => {
      expect(normalizeRemote(url)).toBeNull();
    });
  }
});

describe("sanitizeGroupId — shared fixture", () => {
  for (const { key, groupId } of fixtures.groupIds) {
    it(`${key} -> ${groupId}`, () => {
      expect(sanitizeGroupId(key)).toBe(groupId);
    });
  }

  it("is idempotent", () => {
    const once = sanitizeGroupId("github.com/acme/drymem");
    expect(sanitizeGroupId(once)).toBe(once);
  });

  it("caps long keys but keeps them distinct", () => {
    const a = sanitizeGroupId("github.com/acme/" + "a".repeat(90));
    const b = sanitizeGroupId("github.com/acme/" + "a".repeat(91));

    expect(a.length).toBeLessThanOrEqual(60);
    expect(b.length).toBeLessThanOrEqual(60);
    expect(a).not.toBe(b);
  });
});

describe("ssh aliases", () => {
  it("leaves a host with no config entry alone", () => {
    expect(resolveSshHost("totally-made-up-host-xyz")).toBe("totally-made-up-host-xyz");
  });

  it("never consults ssh config for an https remote", () => {
    // github-personal is an alias on this machine; over https it must stay literal.
    expect(normalizeRemote("https://github-personal/acme/drymem")).toBe(
      "github-personal/acme/drymem",
    );
  });
});

describe("resolveProjectKey", () => {
  it("gives two clones at different paths the same key", () => {
    const root = mkdtempSync(join(tmpdir(), "drymem-"));
    const miguel = initRepo(join(root, "home/miguel/drymem"), "git@github.com:acme/drymem.git");
    const jose = initRepo(join(root, "Users/jose/work/drymem"), "https://github.com/acme/drymem.git");

    expect(resolveProjectKey(miguel)).toBe("github.com/acme/drymem");
    expect(resolveProjectKey(jose)).toBe(resolveProjectKey(miguel));
    expect(groupIdFor(jose)).toBe(groupIdFor(miguel));
  });

  it("falls back to a stable local key with no remote", () => {
    const repo = initRepo(join(mkdtempSync(join(tmpdir(), "drymem-")), "solo"));
    const key = resolveProjectKey(repo);

    expect(key).toMatch(/^local\/solo-[0-9a-f]{8}$/);
    expect(resolveProjectKey(repo)).toBe(key);
  });

  it("keeps same-named projects in different places apart", () => {
    const root = mkdtempSync(join(tmpdir(), "drymem-"));
    const a = initRepo(join(root, "one/api"));
    const b = initRepo(join(root, "two/api"));

    expect(resolveProjectKey(a)).not.toBe(resolveProjectKey(b));
  });

  it("resolves a subdirectory to its repo", () => {
    const repo = initRepo(join(mkdtempSync(join(tmpdir(), "drymem-")), "repo"));
    const nested = join(repo, "apps/server");
    execFileSync("mkdir", ["-p", nested]);

    expect(resolveProjectKey(nested)).toBe(resolveProjectKey(repo));
  });
});

describe("resolveAuthor", () => {
  it("prefers the git identity", () => {
    const repo = initRepo(join(mkdtempSync(join(tmpdir(), "drymem-")), "authored"));
    execFileSync("git", ["config", "user.email", "miguel@ciudadela.eu"], { cwd: repo });

    expect(resolveAuthor(repo)).toBe("miguel@ciudadela.eu");
  });

  it("falls back to user@host when git has no identity", () => {
    const plain = mkdtempSync(join(tmpdir(), "drymem-"));
    expect(resolveAuthor(plain)).toMatch(/^.+@.+$/);
  });
});

describe("scoped groups — shared fixture", () => {
  for (const { key, userId, team, private: priv } of fixtures.scopes) {
    it(`${key} -> ${team} / ${priv}`, () => {
      expect(groupIdTeam(key)).toBe(team);
      expect(groupIdPrivate(key, userId)).toBe(priv);
    });
  }

  it("team and private never collide", () => {
    const key = "github.com/acme/payments";
    expect(groupIdTeam(key)).not.toBe(groupIdPrivate(key, "aaaaaaaa-1111"));
  });

  it("two users get different groups", () => {
    expect(groupIdPrivate("k", "aaaaaaaa-1111")).not.toBe(groupIdPrivate("k", "bbbbbbbb-2222"));
  });
});
