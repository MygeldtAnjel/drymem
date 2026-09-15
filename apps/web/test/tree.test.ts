/**
 * Opening the tree at a named decision.
 *
 * "21 more in the decision tree →" is a promise that the tree will show you the
 * thing it named. That only holds if every area above it is open, which is what
 * this walks.
 */

import { describe, expect, it } from "vitest";

import { pathTo } from "../src/tree";
import type { TreeArea } from "../src/api";

const decision = (id: string) => ({
  id,
  title: id,
  type: "decision",
  author: "a@b.test",
  author_name: "",
  created_at: null,
  gist: "",
  paths: [],
  superseded_by: null,
});

const area = (id: string, decisions: string[], children: TreeArea[] = []): TreeArea => ({
  id,
  label: id,
  total: decisions.length,
  decisions: decisions.map(decision),
  children,
});

const root = area("", [], [
  area("apps", [], [area("apps/web", ["w1", "w2"]), area("apps/api", ["a1"])]),
  area("packages", ["p1"]),
]);

describe("pathTo", () => {
  it("names every area from the root down to the one holding it", () => {
    // Without the ancestors the decision is three collapsed ranks down and the
    // link has taken the reader nowhere.
    expect(pathTo(root, "w2")).toEqual(["", "apps", "apps/web"]);
  });

  it("finds one that hangs off the root's own child", () => {
    expect(pathTo(root, "p1")).toEqual(["", "packages"]);
  });

  it("is null for a decision that is not in this tree", () => {
    // A kind filter can hide it. Null means "open normally" rather than
    // clearing the reader's filter behind their back.
    expect(pathTo(root, "nope")).toBeNull();
  });

  it("stops at the first area holding it rather than walking the whole tree", () => {
    const shallow = area("", ["here"], [area("deeper", ["here"])]);
    expect(pathTo(shallow, "here")).toEqual([""]);
  });
});
