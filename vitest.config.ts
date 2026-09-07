import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@shared": fileURLToPath(new URL("./shared", import.meta.url)),
      // One `graphql`, for a test that builds the real schema. The package ships a CommonJS
      // and an ES build, and its types are compared with `instanceof` — so a test importing
      // the ES one while `graphql-parse-resolve-info` (CommonJS only) requires the other made
      // every generated resolver throw "Cannot use GraphQLNonNull from another module or
      // realm". Node picks one build per importer at runtime; this picks one for everybody.
      graphql: fileURLToPath(new URL("./node_modules/graphql/index.js", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
