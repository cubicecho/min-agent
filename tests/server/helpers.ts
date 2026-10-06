import { refreshLlmConfig } from "../../server/config.ts";

/**
 * Puts a row in the settings cache without a database behind it.
 *
 * The one place a stand-in is named as the database: the cache reads through a single chain of
 * drizzle's builder, and a whole client cannot be built here.
 * @param row What the settings table would have held.
 * @returns The settings as loaded.
 */
export const storedSettings = (row: Record<string, unknown>) =>
  refreshLlmConfig({
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [row] }) }) }),
  } as unknown as Parameters<typeof refreshLlmConfig>[0]);
