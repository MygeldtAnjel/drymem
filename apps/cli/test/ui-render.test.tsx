/**
 * What the screens actually put on the terminal.
 *
 * Ink renders to a string, so this asserts on the real frame rather than on
 * props — the difference between "the state is right" and "the user can see it".
 */

import { render } from "ink-testing-library";
import React from "react";
import { describe, expect, it, vi } from "vitest";

import type { EpisodeOut, Fact, ProjectOut } from "../src/client.js";
import { App, type AppProps } from "../src/ui/app.js";
import { firstLine, ratio, when } from "../src/ui/format.js";

const project: ProjectOut = {
  id: "p1",
  project_key: "github.com/acme/payments",
  display_name: null,
  memory_count: 3,
  positive: 9,
  negative: 1,
};

const episode: EpisodeOut = {
  uuid: "u1",
  name: "payments/provider",
  content: "## Switched to Adyen\nThe clock skew allowance was negative.",
  created_at: "2026-09-11T10:00:00Z",
  author: "miguel@ciudadela.eu",
  scope: "private",
};

const superseded: Fact = {
  name: "USES",
  fact: "payments uses Stripe",
  created_at: "2026-09-11T10:00:00Z",
  superseded: true,
};

type FakeClient = AppProps["client"] & {
  projects: ReturnType<typeof vi.fn>;
  context: ReturnType<typeof vi.fn>;
  search: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  rate: ReturnType<typeof vi.fn>;
};

function fakeClient(overrides: Partial<Record<string, unknown>> = {}): FakeClient {
  return {
    projects: vi.fn().mockResolvedValue([project]),
    context: vi.fn().mockResolvedValue([episode]),
    search: vi.fn().mockResolvedValue([superseded]),
    delete: vi.fn().mockResolvedValue(true),
    rate: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as FakeClient;
}

/** Let Ink flush the effects that fetch and re-render. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 40));

async function mount(client = fakeClient()) {
  const app = render(<App client={client} projectKey="github.com/acme/payments" />);
  await settle();
  return app;
}

describe("dashboard", () => {
  it("shows the counts, the project and the useful ratio", async () => {
    const { lastFrame } = await mount();
    const frame = lastFrame() ?? "";

    expect(frame).toContain("3");
    expect(frame).toContain("memories");
    expect(frame).toContain("github.com/acme/payments");
    expect(frame).toContain("90% useful");
  });

  it("lists the actions with a cursor on the first", async () => {
    const frame = (await mount()).lastFrame() ?? "";

    expect(frame).toContain("Recent memories");
    expect(frame).toContain("Search memories");
    expect(frame).toContain("▸ Recent memories");
  });

  it("shows the keys available", async () => {
    expect((await mount()).lastFrame()).toContain("q quit");
  });

  it("says so when the server cannot be reached", async () => {
    const client = fakeClient({
      projects: vi.fn().mockRejectedValue(new Error("Cannot reach the drymem server at http://x")),
    });
    const frame = (await mount(client)).lastFrame() ?? "";

    expect(frame).toContain("Cannot reach the drymem server");
  });
});

describe("recent", () => {
  it("shows each memory with its author and date", async () => {
    const { stdin, lastFrame } = await mount();
    stdin.write("r");
    await settle();
    const frame = lastFrame() ?? "";

    expect(frame).toContain("payments/provider");
    expect(frame).toContain("miguel@ciudadela.eu");
    expect(frame).toContain("2026-09-11 10:00");
    expect(frame).toContain("Switched to Adyen");
  });

  it("explains an empty list rather than showing nothing", async () => {
    const client = fakeClient({ context: vi.fn().mockResolvedValue([]) });
    const { stdin, lastFrame } = await mount(client);
    stdin.write("r");
    await settle();

    expect(lastFrame()).toContain("No memories yet");
  });
});

describe("search", () => {
  it("prompts, then shows results and marks superseded facts", async () => {
    const { stdin, lastFrame } = await mount();

    stdin.write("s");
    await settle();
    expect(lastFrame()).toContain("Search memories");

    stdin.write("payments");
    await settle();
    expect(lastFrame()).toContain("payments");

    stdin.write("\r");
    await settle();
    const frame = lastFrame() ?? "";

    expect(frame).toContain("payments uses Stripe");
    expect(frame).toContain("[superseded]");
  });
});

describe("detail", () => {
  it("shows the whole memory with its metadata", async () => {
    const { stdin, lastFrame } = await mount();
    stdin.write("r");
    await settle();
    stdin.write("\r");
    await settle();
    const frame = lastFrame() ?? "";

    expect(frame).toContain("payments/provider");
    expect(frame).toContain("miguel@ciudadela.eu");
    expect(frame).toContain("private");
    expect(frame).toContain("clock skew allowance was negative");
  });

  it("sends a rating and shows it", async () => {
    const client = fakeClient();
    const { stdin, lastFrame } = await mount(client);
    stdin.write("r");
    await settle();
    stdin.write("\r");
    await settle();
    stdin.write("+");
    await settle();

    expect(client.rate).toHaveBeenCalledWith("u1", 1, "");
    expect(lastFrame()).toContain("Rated useful");
  });
});

describe("delete", () => {
  it("asks before deleting and cancels cleanly", async () => {
    const client = fakeClient();
    const { stdin, lastFrame } = await mount(client);
    stdin.write("r");
    await settle();
    stdin.write("\r");
    await settle();
    stdin.write("d");
    await settle();

    expect(lastFrame()).toContain("This cannot be undone");

    stdin.write("n");
    await settle();
    expect(client.delete).not.toHaveBeenCalled();
  });

  it("deletes on y and drops the row", async () => {
    const client = fakeClient();
    const { stdin, lastFrame } = await mount(client);
    stdin.write("r");
    await settle();
    stdin.write("\r");
    await settle();
    stdin.write("d");
    await settle();
    stdin.write("y");
    await settle();

    expect(client.delete).toHaveBeenCalledWith("u1");
    expect(lastFrame()).toContain("No memories yet");
  });
});

describe("formatting", () => {
  it("trims a timestamp to minutes", () => {
    expect(when("2026-09-11T10:00:00Z")).toBe("2026-09-11 10:00");
    expect(when(null)).toBe("?");
  });

  it("takes the first real line, past the heading markup", () => {
    expect(firstLine("## Heading\nthe body")).toBe("Heading");
    expect(firstLine("\n\n  spaced  ")).toBe("spaced");
    expect(firstLine("")).toBe("(empty)");
  });

  it("truncates a long line with an ellipsis", () => {
    expect(firstLine("x".repeat(200), 20)).toHaveLength(20);
  });

  it("says so when nothing has been rated", () => {
    expect(ratio(0, 0)).toBe("no ratings yet");
    expect(ratio(9, 1)).toBe("90% useful (10 rated)");
  });
});

describe("version skew", () => {
  it("an older server that omits rating counts must not render NaN", async () => {
    // The running container was one build behind when this was first seen live.
    const older = fakeClient({
      projects: vi
        .fn()
        .mockResolvedValue([{ id: "p1", project_key: "acme/x", display_name: null, memory_count: 3 }]),
    });
    const frame = (await mount(older)).lastFrame() ?? "";

    expect(frame).not.toContain("NaN");
    expect(frame).toContain("no ratings yet");
  });
});
