/**
 * drymem's front door.
 *
 * Everything a browser or a CLI talks to arrives here: identity, people,
 * projects, skills, billing — and, forwarded to the Python engine behind it,
 * anything that needs the graph or a model. One origin, so there is no CORS and
 * nothing to configure.
 *
 * Route order matters at the end of this file: the SPA fallback is registered
 * last so it can never shadow an API route.
 */

import { createReadStream, existsSync } from "node:fs";
import { join, normalize, resolve } from "node:path";

import cookieParser from "cookie-parser";
import express from "express";
import { ZodError } from "zod";

import { env } from "./env.js";
import { badRequest, handleErrors } from "./lib/errors.js";
import { resolvePrincipal } from "./middleware/auth.js";
import { accessRouter } from "./routes/access.js";
import { auditRouter } from "./routes/audit.js";
import { authRouter } from "./routes/auth.js";
import { chatRouter } from "./routes/chats.js";
import { deviceRouter } from "./routes/device.js";
import { healthRouter, memoryRouter } from "./routes/memory.js";
import { inviteRouter } from "./routes/invites.js";
import { overviewRouter } from "./routes/overview.js";
import { projectRouter } from "./routes/projects.js";
import { skillRouter } from "./routes/skills.js";
import { tokenRouter } from "./routes/tokens.js";
import { usageRouter } from "./routes/usage.js";
import { meRouter, userRouter } from "./routes/users.js";

export function createApp() {
  const app = express();
  app.set("trust proxy", 1);
  app.disable("x-powered-by");
  app.use(express.json({ limit: "2mb" }));
  app.use(cookieParser());
  app.use(resolvePrincipal);

  app.use(healthRouter);
  // The one route a stranger may write to. Mounted beside `/auth` rather than
  // under `/v1`, because it belongs to nobody's session.
  app.use("/access-requests", accessRouter);
  app.use("/auth", authRouter);
  app.use("/auth/invites", inviteRouter);
  app.use("/auth/device", deviceRouter);
  app.use("/auth/tokens", tokenRouter);

  app.use("/v1/users", userRouter);
  app.use("/v1/me", meRouter);
  app.use("/v1/projects", projectRouter);
  app.use("/v1/overview", overviewRouter);
  app.use("/v1/audit", auditRouter);
  app.use("/v1/usage", usageRouter);
  app.use("/v1/chats", chatRouter);
  // Registry CRUD here; `/v1/skills/discover` and `/distill` fall through to
  // the engine, so this router must not answer them.
  app.use("/v1/skills", skillRouter);

  // Whatever is left under /v1 belongs to the engine: memories, graph, ask,
  // sessions, skills discovery and distillation.
  app.use("/v1", memoryRouter);

  serveWeb(app);

  app.use((error: unknown, req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (error instanceof ZodError) {
      const first = error.issues[0];
      const where = first?.path.join(".") ?? "request";
      handleErrors(badRequest(`${where}: ${first?.message ?? "is not valid"}`), req, res, next);
      return;
    }
    handleErrors(error, req, res, next);
  });

  return app;
}

/**
 * Serve the built web app from this same origin.
 *
 * One origin means no CORS, no second deployment and no third-party host —
 * which matters for a product whose pitch is that nothing leaves the network.
 */
function serveWeb(app: express.Express): void {
  const dir = env.WEB_DIR ?? resolve(process.cwd(), "../server/drymem_server/web");
  if (!existsSync(join(dir, "index.html"))) return;

  app.use("/assets", express.static(join(dir, "assets"), { immutable: true, maxAge: "1y" }));
  app.get("/favicon.svg", (_req, res) => {
    res.type("image/svg+xml");
    createReadStream(join(dir, "favicon.svg")).pipe(res);
  });

  // The app routes on the hash, so every path that is not an API route is the
  // same document. `normalize` keeps a crafted path from escaping the folder.
  app.get(/.*/, (req, res, next) => {
    if (req.path.startsWith("/v1") || req.path.startsWith("/auth")) return next();
    const safe = normalize(join(dir, "index.html"));
    if (!safe.startsWith(resolve(dir))) return next();
    res.type("html");
    createReadStream(safe).pipe(res);
  });
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^.*?(?=\/)/, ""));
if (isMain || process.env.DRYMEM_API_START === "1") {
  const app = createApp();
  app.listen(env.PORT, env.BIND, () => {
    console.log(`drymem-api on http://${env.BIND}:${env.PORT} → engine ${env.MEMORY_URL}`);
  });
}
