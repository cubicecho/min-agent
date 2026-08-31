import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export const ROOT = path.resolve(here, "..");
export const CONFIG_DIR = process.env.MIN_AGENT_CONFIG_DIR ?? path.join(ROOT, "config");
export const DATA_DIR = process.env.MIN_AGENT_DATA_DIR ?? path.join(ROOT, "data");
export const SESSIONS_DIR = path.join(DATA_DIR, "sessions");
export const PORT = Number(process.env.PORT ?? 8787);
