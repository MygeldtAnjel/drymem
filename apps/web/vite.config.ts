import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  // Built into the server package so FastAPI serves it from one origin —
  // no CORS, no second deploy, and it works on-prem.
  build: { outDir: "../server/drymem_server/web", emptyOutDir: true },
  server: { proxy: { "/v1": "http://127.0.0.1:8080", "/healthz": "http://127.0.0.1:8080" } },
});
