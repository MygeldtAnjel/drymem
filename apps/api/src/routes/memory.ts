/**
 * Everything that needs a model, forwarded to the Python engine.
 *
 * The engine holds the graph, the extractor and the scrubber; it has no idea
 * who anybody is. This app resolves the caller and passes a signed, 90-second
 * assertion of who they are in `X-Drymem-Principal`. The engine verifies that
 * and trusts nothing else, which is why it can safely listen on a port with no
 * authentication of its own — it is never reachable from outside.
 *
 * The paths are unchanged from when Python served them directly, so the web
 * app, the CLI and the MCP proxy did not have to learn anything new.
 */

import { Router, type Request, type Response } from "express";

import { env } from "../env.js";
import { AppError } from "../lib/errors.js";
import { signPrincipal } from "../lib/principal.js";
import { principalOf, requireUser } from "../middleware/auth.js";

export const memoryRouter = Router();

/**
 * Extraction on a local 35B model takes one to two minutes for a long memory.
 * Node's default fetch gives up far sooner and reports a network failure for a
 * request the engine went on to complete — which is how an import once came
 * back "skipped" for memories that were in fact saved.
 */
const READ_MS = 30_000;
const WRITE_MS = 15 * 60_000;

async function forward(req: Request, res: Response): Promise<void> {
  const principal = principalOf(req);
  const target = new URL(req.originalUrl, env.MEMORY_URL);
  const write = req.method !== "GET" && req.method !== "HEAD";

  let upstream: globalThis.Response;
  try {
    upstream = await fetch(target, {
      method: req.method,
      headers: {
        "Content-Type": "application/json",
        "X-Drymem-Principal": await signPrincipal(principal),
      },
      body: write && req.body !== undefined ? JSON.stringify(req.body) : undefined,
      signal: AbortSignal.timeout(write ? WRITE_MS : READ_MS),
    });
  } catch (error) {
    // The engine being down is an outage, not a bad request. Say which.
    throw new AppError(
      502,
      `The memory engine is not responding (${error instanceof Error ? error.message : String(error)}).`,
    );
  }

  const text = await upstream.text();
  res.status(upstream.status);
  res.type(upstream.headers.get("content-type") ?? "application/json");
  res.send(text);
}

memoryRouter.use(requireUser);
memoryRouter.all(/.*/, forward);

/** Health is public and unauthenticated: it reveals nothing and pages nobody. */
export const healthRouter = Router();
healthRouter.get("/healthz", async (_req, res) => {
  let engine: unknown = { status: "unreachable" };
  try {
    const upstream = await fetch(new URL("/healthz", env.MEMORY_URL), {
      signal: AbortSignal.timeout(5_000),
    });
    engine = await upstream.json();
  } catch {
    /* reported as unreachable, below */
  }
  const ok =
    typeof engine === "object" && engine !== null && (engine as { status?: string }).status === "ok";
  res.json({ status: ok ? "ok" : "degraded", api: true, ...(engine as object) });
});
