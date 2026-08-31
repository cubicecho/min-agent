/**
 * Runs an Expo script with the agent's address handed down to it.
 *
 * The app cannot always work the address out for itself. `expo start --web` serves it from
 * Metro, on Metro's port, so an origin-relative `/api` call reaches Metro rather than the
 * agent; on Android and in the desktop build there is no origin to inherit at all. Expo
 * inlines any `EXPO_PUBLIC_*` variable at bundle time, so the address is baked in here,
 * derived from the same `.env` the server reads — `PORT` is set in one place and both ends
 * follow it. An address already in the environment wins, and so does one saved under
 * Settings on the device.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { displayHost, PORT, ROOT } from "../server/paths.ts";

const [script, ...rest] = process.argv.slice(2);
if (!script) throw new Error("usage: expo.ts <mobile package script> [args…]");

const agentUrl = process.env.EXPO_PUBLIC_AGENT_URL || `http://${displayHost()}:${PORT}`;
process.env.EXPO_PUBLIC_AGENT_URL = agentUrl;

// Metro caches the transform that does the inlining, and the cache key does not include
// the value — so a changed address is quietly ignored in favour of the one already
// compiled in, which is the exact bug this is meant to prevent. Remembering the last
// value costs one file and clears the cache only when it has actually moved.
const stamp = path.join(ROOT, "mobile", ".expo", "agent-url");
const remembered = fs.existsSync(stamp) ? fs.readFileSync(stamp, "utf8").trim() : "";
const moved = remembered !== agentUrl;
if (moved) {
  fs.mkdirSync(path.dirname(stamp), { recursive: true });
  fs.writeFileSync(stamp, agentUrl);
  console.log(`[min-agent] api at ${agentUrl} — clearing the Metro cache to bake it in`);
}

const args = ["--prefix", "mobile", "run", script];
if (moved || rest.length > 0) args.push("--", ...(moved ? ["--clear"] : []), ...rest);

spawn("npm", args, { stdio: "inherit", env: process.env }).on("exit", (code) =>
  process.exit(code ?? 0),
);
