import type {
  HookContext,
  HookEvent,
  HookOutcome,
  HookRunnerOptions,
  RunHooksOptions,
} from "@cubicecho/agent-mcp-pool";
import type { Settings } from "../../server/config.ts";

/**
 * Puts a row in the settings cache without a database behind it.
 *
 * The one place a stand-in is named as the database: the cache reads through a single chain of
 * drizzle's builder, and a whole client cannot be built here.
 * @param settings The settings whose cache the row goes into.
 * @param row What the settings table would have held.
 * @returns The settings as loaded.
 */
export const storedSettings = (settings: Pick<Settings, "refresh">, row: Record<string, unknown>) =>
  settings.refresh({
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [row] }) }) }),
  } as unknown as Parameters<Settings["refresh"]>[0]);

/** A stand-in for the pool's `runHooks`, which is what a test mocks and reads back. */
type RunHooks = (
  event: HookEvent,
  context: HookContext,
  options: RunHooksOptions,
) => Promise<HookOutcome[]>;

/**
 * The pool's `hookRunner` over a stand-in for its `runHooks`, binding what the pool binds: the
 * notice for the life of the runner, and the signal per call.
 * @param runHooks The mock each run of hooks reaches.
 * @returns What `Mcp.hookRunner` would be over it.
 */
export const hookRunnerOver =
  (runHooks: RunHooks) =>
  ({ onNotice }: HookRunnerOptions = {}) =>
  (event: HookEvent, context: HookContext, { signal }: { signal?: AbortSignal } = {}) =>
    runHooks(event, context, { signal, onNotice });
