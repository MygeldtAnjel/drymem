import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The marketing site, built as plain static files.
//
// Deliberately its own build rather than a route inside the console: the
// console is behind a sign-in and serves one organisation, while this is a
// public page that has to be fast, indexable and deployable to a CDN on its own
// domain. The only thing it shares with the product is the design system and
// the documents in `docs/`, both imported from source so neither can drift.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@docs": fileURLToPath(new URL("../../docs", import.meta.url)),
    },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
