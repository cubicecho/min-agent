import type { Endpoint } from "@cubicecho/agent-core";
import { asc, eq } from "drizzle-orm";
import {
  type EmbedConfig,
  embedSchema,
  type LlmConfig,
  llmConfigSchema,
  type McpServerConfig,
  mcpServerSchema,
} from "../shared/types.ts";
import { type Db, db } from "./db/client.ts";
import { embeds, mcpServers, settings } from "./db/schema.ts";
import { UserError } from "./errors.ts";

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
 *
 * The refresh happens inside the writing transaction, which is the only place it can see the
 * write (see `refreshLlmConfig`). A transaction that then rolled back would leave this holding
 * a value that never landed — narrow enough to accept, and the alternative was a cache that
 * was wrong after *every* save rather than after a rolled-back one.
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
  if (!result.success) throw new UserError(reasons(result.error.issues));
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

/**
 * Enough of a Drizzle executor to read one row: `db` itself, or a transaction opened over it.
 */
type Reader = Pick<Db, "select">;

/**
 * Re-reads the row into `cached`.
 *
 * `reader` is not decoration. The generated settings mutation runs inside a transaction — one
 * the `onWrite` hook itself causes to exist — and a hook that read through the module-level
 * `db` took a *different* connection out of the pool, one that cannot see an uncommitted write.
 * So it faithfully re-read the row as it was before the save, and the cache ran exactly one
 * write behind: a turn after changing the reasoning effort used the previous effort, and the
 * new one only arrived when some later, unrelated save refreshed it. Reading through the
 * mutation's own executor is what makes the write visible.
 */
export async function refreshLlmConfig(reader: Reader = db): Promise<LlmConfig> {
  const [row] = await reader.select().from(settings).where(eq(settings.id, DEFAULT_ID)).limit(1);
  cached = coerceLlmConfig(row ?? {});
  return cached;
}

export const loadLlmConfig = (): LlmConfig => cached;

/** The key from the settings row, else the environment. */
export const resolveApiKey = (config = cached) => config.apiKey || process.env.OPENAI_API_KEY || "";

/**
 * The settings, as `@cubicecho/agent-core` wants an endpoint.
 *
 * The package asks each function for the narrowest thing it reads rather than for a whole
 * config, which is what lets min-agent's settings satisfy it without growing fields it has no
 * screen for. The key is resolved here because the stored row may not hold it — a blank one
 * falls back to `$OPENAI_API_KEY` — and the timeout is zero because min-agent has never had
 * one: a local model can take a minute over a long answer, and a turn is already cancellable
 * from the client.
 */
export const endpoint = (config = cached): Endpoint => ({
  baseUrl: config.baseUrl,
  apiKey: resolveApiKey(config),
  requestTimeoutSeconds: 0,
});

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
    throw new UserError("duplicate server id");
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
    if (!result.success)
      throw new UserError(`${embed.id || "app"} — ${reasons(result.error.issues)}`);
    parsed.push(result.data);
  }
  if (new Set(parsed.map((embed) => embed.id)).size !== parsed.length) {
    throw new UserError("duplicate embed id");
  }

  await db.transaction(async (tx) => {
    await tx.delete(embeds);
    if (parsed.length) {
      await tx.insert(embeds).values(parsed.map((embed, position) => ({ ...embed, position })));
    }
  });
  return parsed;
}
