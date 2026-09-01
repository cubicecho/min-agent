import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { ROOT } from "../server/paths.ts";

const run = promisify(execFile);

/**
 * Keeps `schema.graphql` and `shared/gql/graphql.ts` current.
 *
 * Both files are committed but neither is written by hand, which is a standing invitation to
 * edit a table and ship a front end typed against the table before it. Rather than have CI
 * catch that after the fact, generation is part of running the thing: `npm run dev` watches,
 * and `npm run build` regenerates before it typechecks.
 *
 * This used to be a Vite plugin, back when there was a Vite app to hang it off. It is a plain
 * script now — the front end is Expo, and Metro has no reason to know about the server's
 * GraphQL schema.
 *
 * It shells out to `npm run codegen` rather than calling the codegen API in process because
 * printing the schema means importing the server, and the server is TypeScript with `.ts`
 * import specifiers, which `tsx` runs correctly and this process is not set up to. The mtime
 * check is what keeps that subprocess off the common path where nothing has changed, which is
 * nearly every build.
 */
const INPUTS = [
  { dir: "server", ext: ".ts" },
  { dir: "shared/graphql", ext: ".graphql" },
];
const INPUT_FILES = ["codegen.ts", "scripts/print-schema.ts"];
const OUTPUTS = ["schema.graphql", "shared/gql/graphql.ts"];

function walk(dir: string, ext: string): string[] {
  const entries = fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : [];
  return entries.flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full, ext);
    return entry.name.endsWith(ext) ? [full] : [];
  });
}

const inputPaths = () => [
  ...INPUT_FILES.map((file) => path.join(ROOT, file)),
  ...INPUTS.flatMap(({ dir, ext }) => walk(path.join(ROOT, dir), ext)),
];

const mtime = (file: string) => (fs.existsSync(file) ? fs.statSync(file).mtimeMs : NaN);

/** Whether anything the generated files are built from has been touched since they were. */
function stale() {
  const outputs = OUTPUTS.map((file) => mtime(path.join(ROOT, file)));
  if (outputs.some(Number.isNaN)) return true;
  const newestInput = Math.max(...inputPaths().map(mtime));
  return newestInput > Math.min(...outputs);
}

let running: Promise<void> | null = null;

async function generate(reason: string) {
  if (running) return running;
  running = (async () => {
    const started = Date.now();
    try {
      await run("npm", ["run", "codegen"], { cwd: ROOT });
      // codegen leaves a file it did not change alone, so on the common run — where the schema
      // moved but the generated types did not — the output keeps an mtime older than its input
      // and would look stale forever. Stamping them records what actually happened: these
      // outputs are current as of now.
      const now = new Date();
      for (const file of OUTPUTS) fs.utimesSync(path.join(ROOT, file), now, now);
      console.log(`[codegen] ${reason} — regenerated in ${Date.now() - started}ms`);
    } catch (error) {
      // A schema that cannot be printed is a broken server, which the dev server is about to
      // report anyway. Exiting here would just bury it under a second error.
      console.error(`[codegen] failed: ${(error as Error).message}`);
      if (!watching) process.exitCode = 1;
    } finally {
      running = null;
    }
  })();
  return running;
}

const watching = process.argv.includes("--watch");

if (stale()) await generate("schema changed");
else if (!watching) console.log("[codegen] up to date");

if (watching) {
  // Editors write a file several times to save it once, so a burst of events is one rebuild.
  let queued: NodeJS.Timeout | null = null;
  const touched = (file: string) => {
    if (OUTPUTS.some((output) => file.endsWith(output))) return;
    if (queued) clearTimeout(queued);
    queued = setTimeout(() => void generate(path.relative(ROOT, file)), 50);
  };

  for (const { dir, ext } of INPUTS) {
    const full = path.join(ROOT, dir);
    if (!fs.existsSync(full)) continue;
    fs.watch(full, { recursive: true }, (_event, name) => {
      if (name?.endsWith(ext)) touched(path.join(full, name));
    });
  }
  for (const file of INPUT_FILES) {
    const full = path.join(ROOT, file);
    if (fs.existsSync(full)) fs.watch(full, () => touched(full));
  }
  console.log("[codegen] watching server/ and shared/graphql/");
}
