import { asc, eq } from "drizzle-orm";
import {
  type EmbedConfig,
  embedSchema,
  type LlmConfig,
  llmConfigSchema,
  type McpServerConfig,
  mcpServerSchema,
} from "../shared/types.ts";
import { db } from "./db/client.ts";
import { embeds, mcpServers, settings } from "./db/schema.ts";

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

/** The same schema with every field optional: the shape of a patch rather than a whole row. */
const llmConfigPatchSchema = llmConfigSchema.partial();

/** `path: message`, for an error a person reads in a toast. */
const reasons = (issues: { path: PropertyKey[]; message: string }[]) =>
  issues.map((issue) => `${issue.path.join(".") || "settings"}: ${issue.message}`).join("; ");

/**
 * Checks a settings patch before it reaches the table. Throwing rolls the mutation back.
 *
 * The settings mutation is generated from the Drizzle schema, so its input type is the column
 * types and nothing else — `maxTokens: Int`, any integer at all. Every bound that makes a
 * value usable lives in `llmConfigSchema`, which was only ever consulted on the way *out*. So
 * a number the schema rejects could be stored happily and then refuse to load, and because
 * `refreshLlmConfig` runs before the server listens, the next restart died on boot and took
 * with it the only screen that could have corrected the number.
 */
export function assertLlmConfigPatch(patch: unknown): void {
  const result = llmConfigPatchSchema.safeParse(patch ?? {});
  if (!result.success) throw new Error(reasons(result.error.issues));
}

/**
 * Parses the stored row, dropping any field the schema will not accept back to its default.
 *
 * `assertLlmConfigPatch` should keep an unreadable value from being stored at all now, but a
 * row written by an older build, edited by hand, or left behind by a bound that has since
 * been tightened is still a row this has to be able to read. Losing one field to its default
 * and saying so is recoverable; refusing to boot is not.
 */
export function coerceLlmConfig(row: unknown): LlmConfig {
  const candidate: Record<string, unknown> = { ...(row as Record<string, unknown> | null) };

  // Each pass drops the fields zod named and tries again. There are finitely many, and a pass
  // that names none of them returns, so this terminates.
  for (;;) {
    const result = llmConfigSchema.safeParse(candidate);
    if (result.success) return result.data;

    const issues = result.error.issues;
    const dropped = [
      ...new Set(
        issues
          .map((issue) => issue.path[0])
          .filter((key): key is string => typeof key === "string" && key in candidate),
      ),
    ];

    if (!dropped.length) {
      console.warn(`settings: stored row is unreadable (${reasons(issues)}); using defaults`);
      return llmConfigSchema.parse({});
    }

    console.warn(`settings: ignoring stored ${dropped.join(", ")} (${reasons(issues)})`);
    for (const key of dropped) delete candidate[key];
  }
}

export async function refreshLlmConfig(): Promise<LlmConfig> {
  const [row] = await db.select().from(settings).where(eq(settings.id, DEFAULT_ID)).limit(1);
  cached = coerceLlmConfig(row ?? {});
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

export async function loadEmbeds(): Promise<EmbedConfig[]> {
  const rows = await db.select().from(embeds).orderBy(asc(embeds.position));
  return rows.map((row) => embedSchema.parse(row));
}

/**
 * Replaces the whole set, the same way `saveMcpServers` does and for the same reason: an
 * embed's id is the route its view lives at, so renaming one is a different destination
 * rather than an edited row, and the screen edits the list as a list.
 */
export async function saveEmbeds(list: EmbedConfig[]): Promise<EmbedConfig[]> {
  const parsed: EmbedConfig[] = [];
  for (const embed of list) {
    // `reasons` rather than letting the ZodError out: this one is read by whoever typed the
    // row, in the note under the Save button, and a raw issue array is not a sentence. The
    // row is named because the screen saves the whole list at once and the message has to
    // say which of them the complaint is about.
    const result = embedSchema.safeParse(embed);
    if (!result.success) throw new Error(`${embed.id || "app"} — ${reasons(result.error.issues)}`);
    parsed.push(result.data);
  }
  if (new Set(parsed.map((embed) => embed.id)).size !== parsed.length) {
    throw new Error("duplicate embed id");
  }

  await db.transaction(async (tx) => {
    await tx.delete(embeds);
    if (parsed.length) {
      await tx.insert(embeds).values(parsed.map((embed, position) => ({ ...embed, position })));
    }
  });
  return parsed;
}
