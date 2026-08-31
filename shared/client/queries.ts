/**
 * How long the connection settings and the model list stay fresh.
 *
 * `GET /api/models` is not a local read: it asks the configured provider to list its models, so
 * every mount of a chat pane and every trip through the Config view was another round trip out
 * to the API. Neither of these changes on its own — saving config invalidates both by hand — so
 * the only cost of holding them is a stale list for someone editing `llm.yaml` underneath the
 * running server, which a reload settles.
 */
export const SETTINGS_STALE_TIME = 5 * 60_000;
