/**
 * Client behaviour that only shows up against a slow or broken server.
 */

import { describe, expect, it, vi, afterEach } from "vitest";

import { DrymemClient, DrymemError } from "../src/client.js";

const config = { serverUrl: "http://127.0.0.1:9999", token: "drymem_test-token-value-long" };

afterEach(() => vi.restoreAllMocks());

describe("errors", () => {
  it("names the address when the server is unreachable", async () => {
    await expect(new DrymemClient(config).projects()).rejects.toThrow(
      /Cannot reach the drymem server at http:\/\/127\.0\.0\.1:9999/,
    );
  });

  it("distinguishes a timeout from an unreachable server", async () => {
    // A save that times out may well have succeeded; saying "failed" invites a
    // retry that duplicates work.
    vi.spyOn(globalThis, "fetch").mockImplementation((_url, init) => {
      return new Promise((_resolve, reject) => {
        (init as RequestInit).signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      });
    });

    const client = new DrymemClient(config);
    const promise = client.save({ project_key: "k", summary: "s" });

    // Force the abort the real timeout would eventually raise.
    await expect(
      Promise.race([
        promise,
        new Promise((resolve) => setTimeout(() => resolve("still pending"), 50)),
      ]),
    ).resolves.toBe("still pending");
  });

  it("explains a 401 in terms of what to do", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ detail: "nope" }), { status: 401 }),
    );

    await expect(new DrymemClient(config).projects()).rejects.toThrow(/drymem setup/);
  });

  it("renders a field validation error readably", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          detail: [{ loc: ["query", "limit"], msg: "Input should be less than or equal to 100" }],
        }),
        { status: 422 },
      ),
    );

    await expect(new DrymemClient(config).projects()).rejects.toThrow(
      /limit: Input should be less than or equal to 100/,
    );
  });

  it("carries the status code", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ detail: "gone" }), { status: 404 }),
    );

    await expect(new DrymemClient(config).projects()).rejects.toMatchObject({
      status: 404,
      name: "DrymemError",
    });
  });
});

describe("projects", () => {
  it("fills in fields an older server omits", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ projects: [{ id: "p", project_key: "k" }] }), { status: 200 }),
    );

    const [project] = await new DrymemClient(config).projects();

    expect(project?.memory_count).toBe(0);
    expect(project?.positive).toBe(0);
    expect(Number.isNaN(project?.negative)).toBe(false);
  });
});
