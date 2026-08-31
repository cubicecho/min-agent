import { asc, eq } from "drizzle-orm";
import {
  type LlmConfig,
  llmConfigSchema,
  type McpServerConfig,
  mcpServerSchema,
} from "../shared/types.ts";
import { db } from "./db/client.ts";
import { mcpServers, settings } from "./db/schema.ts";

/** The singleton settings row. There is exactly one, created by `ensureSchema`. */
const DEFAULT_ID = "default";

/**
 * The settings, kept in memory.
 *
 * They are read on nearly every line of a turn — the model, the system prompt, the token
 * ceiling, four task models — and a turn is not a place to be awaiting the database for a row
 * that changes when someone clicks Save. So the row is loaded once at boot and again after any
 * write, and `loadLlmConfig()` stays the synchronous call it always was. Every write goes
 * through GraphQL, which refreshes this on the way out (`onWrite` in `graphql/schema.ts`), so
 * a second process editing the row is the only way to make this stale — and there isn't one.
 */
let cached: LlmConfig = llmConfigSchema.parse({});

export async function refreshLlmConfig(): Promise<LlmConfig> {
  const [row] = await db.select().from(settings).where(eq(settings.id, DEFAULT_ID)).limit(1);
  cached = llmConfigSchema.parse(row ?? {});
  return cached;
}

export const loadLlmConfig = (): LlmConfig => cached;

/** The key from the settings row, else the environment. */
export const resolveApiKey = (config = cached) => config.apiKey || process.env.OPENAI_API_KEY || "";

export async function loadMcpServers(): Promise<McpServerConfig[]> {
  const rows = await db.select().from(mcpServers).orderBy(asc(mcpServers.position));
  return rows.map((row) => mcpServerSchema.parse(row));
}

/**
 * Replaces the whole set in one transaction.
 *
 * The MCP tab edits a list and saves it, and a row's id is the tool namespace the user chose —
 * so a rename is a delete and an insert, not an update. Diffing that against the table row by
 * row would be more machinery than deleting and rewriting nine rows is worth.
 */
export async function saveMcpServers(list: McpServerConfig[]): Promise<McpServerConfig[]> {
  const parsed = list.map((server) => mcpServerSchema.parse(server));
  if (new Set(parsed.map((server) => server.id)).size !== parsed.length) {
    throw new Error("duplicate server id");
  }

  await db.transaction(async (tx) => {
    await tx.delete(mcpServers);
    if (parsed.length) {
      await tx
        .insert(mcpServers)
        .values(parsed.map((server, position) => ({ ...server, position })));
    }
  });
  return parsed;
}
