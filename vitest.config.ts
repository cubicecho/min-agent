import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@shared": fileURLToPath(new URL("./shared", import.meta.url)),
      /**
       * The same single `graphql` the server runs on.
       *
       * graphql 16 ships a CommonJS `index.js` and an ES `index.mjs` and declares no `exports`
       * map, so who gets which is decided by the two fields it does declare: Node reads `main`
       * and gives every importer the CommonJS build, while a bundler reads `module` and
       * prefers the ES one. Vitest is the bundler in that sentence — but
       * `graphql-parse-resolve-info`, which every generated resolver calls, is CommonJS and
       * `require`s the other build regardless.
       *
       * Two copies of a library that compares its types with `instanceof` is two sets of
       * types that do not recognise each other, and the schema fails to build at all:
       * "Cannot use GraphQLNonNull from another module or realm". Aliasing to `index.js`
       * points the tests at the build Node would have chosen, so the suite exercises the
       * server's own resolution rather than a second one that only exists under vitest.
       * `tests/server/graphql/schema.test.ts` fails if this comes apart again.
       */
      graphql: fileURLToPath(new URL("./node_modules/graphql/index.js", import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Diffs the tables once per run, so no test file has to load drizzle-kit.
    globalSetup: ["./tests/global-setup.ts"],
    // A test that reaches the module-level `db` without a throwaway one behind it fails
    // loudly instead of writing to the developer's Postgres.
    env: { DATABASE_URL: "" },
    // Threads share one process, where a fork per file each loads its own copy of everything.
    pool: "threads",
  },
});
