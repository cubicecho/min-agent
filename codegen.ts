import type { CodegenConfig } from "@graphql-codegen/cli";

/**
 * `schema.graphql` is written by `npm run schema`, which builds the runtime schema from the
 * Drizzle tables and prints it — so codegen always reads the same schema the server serves.
 * `npm run codegen` runs both in order.
 *
 * `documentMode: "string"` is the one setting worth explaining: it emits each document as a
 * query string rather than a parsed AST, so neither front end has to bundle `graphql` just to
 * print one back out again. That matters for the Expo app, whose metro config pins
 * `nodeModulesPaths` to `mobile/node_modules` and so cannot see the root install.
 */
const scalars = { DateTime: "string", JSON: "unknown" };

const config: CodegenConfig = {
  schema: "./schema.graphql",
  documents: "./shared/graphql/**/*.graphql",
  ignoreNoDocuments: true,
  generates: {
    "./shared/gql/graphql.ts": {
      plugins: ["typescript", "typescript-operations", "typed-document-node"],
      config: { scalars, useTypeImports: true, skipTypename: true, documentMode: "string" },
    },
  },
};

export default config;
