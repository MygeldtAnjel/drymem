/**
 * A hash router, because the app is served from a FastAPI route that knows
 * nothing about client paths — a real path would 404 on refresh unless the
 * server learned every screen's name. The hash keeps the back button, makes a
 * screen linkable, and costs one event listener.
 */

import { useEffect, useState } from "react";

export type Route = { page: string; id: string };

function parse(): Route {
  const raw = window.location.hash.replace(/^#\/?/, "");
  const [page = "", id = ""] = raw.split("/");
  return { page: page || "overview", id: decodeURIComponent(id) };
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(parse);
  useEffect(() => {
    const onChange = () => setRoute(parse());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}

export function go(page: string, id?: string): void {
  window.location.hash = id ? `#/${page}/${encodeURIComponent(id)}` : `#/${page}`;
}
