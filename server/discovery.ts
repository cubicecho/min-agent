import type { LanServer, ServerWatch, ServerWatchHandlers } from "@cubicecho/mcp-discovery/mdns";
import type { DiscoveredMcpServer, McpServerConfig } from "../shared/types.ts";

/**
 * MCP servers other machines on the LAN announce, offered on the MCP tab as servers to add.
 *
 * Discovery only: min-agent has no MCP endpoint of its own, so it never advertises. What it finds
 * is a suggestion and nothing more. mDNS and Server Cards are unauthenticated — anything on the
 * network can announce any name — so a found server is never connected to on its own. Adding one
 * opens the ordinary new-server dialog filled in from its card, and the person still saves it and
 * types the secrets its headers need.
 */

/** What discovery needs from the process. */
export interface DiscoveryDeps {
  /** Whether to watch at all; `MCP_DISCOVERY` in `paths.ts`. */
  enabled: boolean;
  /** The configured servers, read on every `list` so a saved one drops out of the suggestions. */
  configured: () => McpServerConfig[];
  /** Starts the network watch: `watchServers` from `@cubicecho/mcp-discovery/mdns`, a fake in tests. */
  watch: (handlers: ServerWatchHandlers) => Promise<Pick<ServerWatch, "stop">>;
  /** Writes a line to the log. */
  log: (message: string) => void;
}

/** The servers found on the network, as the MCP tab is offered them. */
export interface Discovery {
  /** Starts watching, when enabled. A watch that cannot start is logged, never thrown. */
  start: () => Promise<void>;
  /** Every found server not configured yet, by title. */
  list: () => DiscoveredMcpServer[];
  /** Stops watching; called on shutdown. */
  stop: () => Promise<void>;
}

/**
 * The same endpoint however it was written, so a server added by hand matches the one found.
 *
 * @param url - A URL.
 * @returns Its origin and path without a trailing slash, or the text as given when it does not parse.
 */
function sameUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}`;
  } catch {
    return url.trim();
  }
}

/**
 * A found server as the API describes it, or nothing when its card offers no URL min-agent can dial.
 *
 * @param server - A server the watch reported.
 * @returns The suggestion, or null for a card with only SSE or templated remotes.
 */
function suggestion(server: LanServer): DiscoveredMcpServer | null {
  const { card, connection } = server;
  if (connection === null) {
    return null;
  }
  return {
    key: server.key,
    name: card.name,
    title: card.title ?? null,
    description: card.description,
    host: server.host.name,
    url: connection.url,
    requiredHeaders: connection.requiredHeaders,
  };
}

/**
 * Builds discovery over a network watch. Nothing is watched until `start`.
 *
 * @param deps - Whether to watch, the configured servers, the watch itself and the log.
 * @returns The discovery.
 */
export function createDiscovery(deps: DiscoveryDeps): Discovery {
  const found = new Map<string, DiscoveredMcpServer>();
  let watch: Pick<ServerWatch, "stop"> | null = null;

  const handlers: ServerWatchHandlers = {
    onUp: (server) => {
      const offered = suggestion(server);
      if (offered === null) {
        found.delete(server.key);
        return;
      }
      found.set(server.key, offered);
    },
    onDown: (server) => {
      found.delete(server.key);
    },
    onError: (error) => deps.log(`[discovery] ${error.message}`),
  };

  return {
    start: async () => {
      if (deps.enabled === false || watch !== null) {
        return;
      }
      try {
        watch = await deps.watch(handlers);
        deps.log("[discovery] watching the local network for MCP servers");
      } catch (error) {
        deps.log(`[discovery] could not watch the local network: ${String(error)}`);
      }
    },
    list: () => {
      const configured = new Set(
        deps
          .configured()
          .filter((server) => server.transport === "http")
          .map((server) => sameUrl(server.url)),
      );
      return [...found.values()]
        .filter((server) => configured.has(sameUrl(server.url)) === false)
        .sort((a, b) => (a.title ?? a.name).localeCompare(b.title ?? b.name));
    },
    stop: async () => {
      const stopping = watch;
      watch = null;
      found.clear();
      await stopping?.stop();
    },
  };
}
