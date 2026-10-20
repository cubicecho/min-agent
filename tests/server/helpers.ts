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
