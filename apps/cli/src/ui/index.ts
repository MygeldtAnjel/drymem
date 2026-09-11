/** Entry point for `drymem ui`. */

import { render } from "ink";
import React from "react";

import { DrymemClient } from "../client.js";
import { requireConfig } from "../config.js";
import { resolveProjectKey } from "../identity.js";
import { App } from "./app.js";

export async function runUi(cwd: string = process.cwd()): Promise<void> {
  const client = new DrymemClient(requireConfig());
  const instance = render(
    React.createElement(App, { client, projectKey: resolveProjectKey(cwd) }),
  );
  await instance.waitUntilExit();
}
