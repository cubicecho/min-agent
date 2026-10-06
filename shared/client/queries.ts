import { FRESHNESS_DEFAULTS } from "../defaults.ts";
import { MS_PER_MINUTE } from "../units.ts";
/**
 * How long the connection settings and the model list stay fresh.
 *
 * The `models` query is not a local read: it asks the configured provider to list its models, so
 * every mount of a chat pane and every trip through the Config view was another round trip out
 * to the API. Neither of these changes on its own — saving config invalidates both by hand — so
 * the only cost of holding them is a stale list for someone editing the settings row underneath
 * the running server, which a reload settles.
 */
export const SETTINGS_STALE_TIME = FRESHNESS_DEFAULTS.settingsStaleMinutes * MS_PER_MINUTE;
