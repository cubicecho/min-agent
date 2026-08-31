import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { Plugin } from "vite";

const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * What the generated files are built from, and what they are.
 *
 * The schema is assembled from the Drizzle tables at runtime, so anything under `server/` can
 * change it — the whole directory is the input rather than the two files that obviously are.
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
  ...INPUT_FILES.map((file) => path.join(root, file)),
  ...INPUTS.flatMap(({ dir, ext }) => walk(path.join(root, dir), ext)),
];

const mtime = (file: string) => (fs.existsSync(file) ? fs.statSync(file).mtimeMs : NaN);

/** Whether anything the generated files are built from has been touched since they were. */
function stale() {
  const outputs = OUTPUTS.map((file) => mtime(path.join(root, file)));
  if (outputs.some(Number.isNaN)) return true;
  const newestInput = Math.max(...inputPaths().map(mtime));
  return newestInput > Math.min(...outputs);
}

/**
 * Regenerates `schema.graphql` and `shared/gql/graphql.ts` whenever the schema they describe
 * has moved.
 *
 * Both files are committed but neither is written by hand, which is a standing invitation to
 * edit a table and ship front ends typed against the table before it. Rather than have CI
 * catch that after the fact, the generation is simply part of running the thing: `npm run dev`
 * regenerates on start and again on every change to `server/` or `shared/graphql/`, and
 * `npm run build` regenerates before it typechecks.
 *
 * It shells out to `npm run codegen` rather than calling the codegen API in process because
 * printing the schema means importing the server, and the server is TypeScript with `.ts`
 * import specifiers — `tsx` runs that correctly and Vite's own loader is not in a position to.
 * The mtime check above is what keeps that subprocess off the common path where nothing has
 * changed, which is nearly every build.
 */
export function graphqlCodegen(): Plugin {
  let running: Promise<void> | null = null;

  const generate = async (reason: string) => {
    if (running) return running;
    running = (async () => {
      const started = Date.now();
      try {
        await run("npm", ["run", "codegen"], { cwd: root });
        // codegen leaves a file it did not change alone, so on the common run — where the
        // schema moved but the generated types did not — the output keeps an mtime older
        // than its input and would look stale forever. Stamping them records what actually
        // happened: these outputs are current as of now.
        const now = new Date();
        for (const file of OUTPUTS) fs.utimesSync(path.join(root, file), now, now);
        console.log(`[codegen] ${reason} — regenerated in ${Date.now() - started}ms`);
      } catch (error) {
        // A schema that cannot be printed is a broken server, which the dev server is about
        // to report anyway. Failing the build here would just bury it under a second error.
        console.error(`[codegen] failed: ${(error as Error).message}`);
      } finally {
        running = null;
      }
    })();
    return running;
  };

  return {
    name: "min-agent:graphql-codegen",
    async buildStart() {
      if (stale()) await generate("schema changed");
    },
    configureServer(server) {
      for (const { dir } of INPUTS) server.watcher.add(path.join(root, dir));
      server.watcher.on("change", (file) => {
        if (OUTPUTS.some((output) => file.endsWith(output))) return;
        if (inputPaths().includes(file)) void generate(path.relative(root, file));
      });
    },
  };
}
