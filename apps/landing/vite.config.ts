import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The marketing site, built as plain static files.
//
// Deliberately its own build rather than a route inside the console: the
// console is behind a sign-in and serves one organisation, while this is a
// public page that has to be fast, indexable and deployable to a CDN on its own
// domain. Its documentation lives in `content/` and is written for the people
// who use drymem; the repository's `docs/` is an engineering record and is a
// different document for a different reader.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@content": fileURLToPath(new URL("./content", import.meta.url)),
    },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
