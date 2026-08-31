import { defineConfig } from "drizzle-kit";
import { DATABASE_URL } from "./server/paths.ts";

export default defineConfig({
  dialect: "postgresql",
  schema: "./server/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: DATABASE_URL },
});
