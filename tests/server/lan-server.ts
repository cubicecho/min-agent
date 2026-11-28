import { createServerCard, type ServerCard } from "@cubicecho/mcp-discovery";
import { type LanServer, toMcpHost } from "@cubicecho/mcp-discovery/mdns";

/** A server another host announces, as `watchServers` reports it. */
export function lanServer(
  card: Partial<ServerCard> & { name: string },
  url: string | null,
  requiredHeaders: string[] = [],
): LanServer {
  const full = createServerCard({
    version: "1.0.0",
    description: "Something useful.",
    remotes: url ? [{ type: "streamable-http", url }] : [],
    ...card,
  });
  const host = toMcpHost({
    name: "MCP Skills on nas",
    host: "nas.local",
    port: 3000,
    addresses: ["192.168.1.20"],
    txt: {},
  });
  return {
    key: `${host.name}/${full.name}`,
    host,
    card: full,
    cardUrl: null,
    connection: url ? { url, requiredHeaders } : null,
  };
}
