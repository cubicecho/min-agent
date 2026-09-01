import type { EmbedConfig } from "@shared/types.ts";

/**
 * How long the embed list stays fresh.
 *
 * The sidebar reads it on every render of every screen, and it only changes when someone
 * saves the Apps screen — which invalidates the query by hand. Long, for the same reason the
 * settings are: this is a list of rows a person typed, not something that moves on its own.
 */
export const EMBEDS_STALE_TIME = 5 * 60_000;

/** The embeds that get a sidebar row. A disabled one is kept, but not shown. */
export const visibleEmbeds = (embeds: EmbedConfig[] | undefined) =>
  (embeds ?? []).filter((embed) => embed.enabled && embed.url);
