import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
// Self-hosted: a UI whose product promise is "nothing leaves the network"
// cannot fetch its own typeface from a CDN, and offline it silently fell back
// to Georgia.
import "@fontsource/spectral/400.css";
import "@fontsource/spectral/600.css";
import "@fontsource/spectral/400-italic.css";

import "./theme.css";
import "./app.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
