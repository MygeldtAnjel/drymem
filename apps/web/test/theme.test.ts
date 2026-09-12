/**
 * Light, dark, or the machine's choice.
 *
 * The branch worth pinning down is the failing one: `localStorage` throws in a
 * private window and in a browser with site data blocked, and a theme picker
 * that takes the page down with it is worse than no theme picker.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { applyTheme, readTheme, resolve, saveTheme, watchSystem } from "../src/theme";

function fakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: () => null,
    length: 0,
  } as unknown as Storage;
}

function prefersDark(dark: boolean) {
  const listeners: (() => void)[] = [];
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: dark && query.includes("dark"),
    addEventListener: (_: string, fn: () => void) => listeners.push(fn),
    removeEventListener: () => listeners.pop(),
  }));
  return listeners;
}

/** jsdom is not loaded here; this is the bit of `classList` the code uses. */
function stubRoot() {
  const classes = new Set<string>();
  vi.stubGlobal("document", {
    documentElement: {
      classList: {
        toggle: (name: string, on: boolean) => (on ? classes.add(name) : classes.delete(name)),
        contains: (name: string) => classes.has(name),
      },
    },
  });
  return classes;
}

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.stubGlobal("localStorage", fakeStorage());
  stubRoot();
  prefersDark(false);
});

describe("what the stored choice means", () => {
  it("defaults to following the machine", () => {
    expect(readTheme()).toBe("system");
  });

  it("remembers an explicit choice", () => {
    saveTheme("dark");
    expect(readTheme()).toBe("dark");
  });

  it("ignores a value it does not recognise", () => {
    localStorage.setItem("drymem.theme", "chartreuse");
    expect(readTheme()).toBe("system");
  });

  it("survives storage that throws", () => {
    // A private window, or site data blocked. Both throw on read and write.
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    } as unknown as Storage);
    stubRoot();

    expect(readTheme()).toBe("system");
    expect(() => saveTheme("dark")).not.toThrow();
  });
});

describe("what it resolves to", () => {
  it("takes an explicit choice at its word", () => {
    prefersDark(true);
    expect(resolve("light")).toBe("light");
    prefersDark(false);
    expect(resolve("dark")).toBe("dark");
  });

  it("asks the machine only for system", () => {
    prefersDark(true);
    expect(resolve("system")).toBe("dark");
    prefersDark(false);
    expect(resolve("system")).toBe("light");
  });
});

describe("the class on the root", () => {
  it("goes on for dark and comes off for light", () => {
    const classes = stubRoot();
    applyTheme("dark");
    expect(classes.has("dark")).toBe(true);
    applyTheme("light");
    expect(classes.has("dark")).toBe(false);
  });

  it("follows the machine under system", () => {
    const classes = stubRoot();
    prefersDark(true);
    applyTheme("system");
    expect(classes.has("dark")).toBe(true);
  });

  it("is still written when storage refuses to remember it", () => {
    const classes = stubRoot();
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {
        throw new Error("denied");
      },
    } as unknown as Storage);

    saveTheme("dark");
    expect(classes.has("dark")).toBe(true);
  });
});

describe("following the machine", () => {
  it("listens only while the choice is system", () => {
    // Someone who picked light does not want their laptop overriding them.
    const listeners = prefersDark(false);
    watchSystem("light", () => {});
    expect(listeners.length).toBe(0);

    watchSystem("system", () => {});
    expect(listeners.length).toBe(1);
  });

  it("stops listening when told to", () => {
    const listeners = prefersDark(false);
    const stop = watchSystem("system", () => {});
    expect(listeners.length).toBe(1);
    stop();
    expect(listeners.length).toBe(0);
  });

  it("does not throw where matchMedia is missing", () => {
    vi.stubGlobal("matchMedia", undefined);
    expect(() => watchSystem("system", () => {})).not.toThrow();
    expect(resolve("system")).toBe("light");
  });
});
