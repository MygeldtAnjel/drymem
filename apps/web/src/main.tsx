import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

// Before the router: it reads a one-shot message out of the hash, and the
// router normalises the hash away on its first parse.
import "./flash";
import { App } from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
