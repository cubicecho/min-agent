import type { ToolDefinition } from "@cubicecho/agent-mcp-pool";
import { client, resourceServers } from "./mcp.ts";

/**
 * MCP resources, as two tools the model can reach for.
 *
 * A server's resources are the context it holds rather than the actions it takes — a file, a
 * table's schema, a page of docs — and min-agent asked for none of it until now: `server/mcp.ts`
 * indexes `tools/list` and stopped there.
 *
 * They arrive as tools rather than as a listing in the system prompt, which is where the tool
 * catalogue goes. The two look alike and are not: a tool catalogue is bounded by what the operator
 * configured, and a resource list is bounded by whatever the server happens to hold — a filesystem
 * server pointed at a repository answers `resources/list` with the repository. Putting that in
 * front of every request would spend the window on a listing most turns never look at, and
 * capping it would leave the model reading a truncated index with no way to ask for the rest.
 * As tools it costs two schemas when a resource-serving server is connected and nothing at all
 * otherwise, and the model pays for the listing on the turns it actually wants one.
 */

/** Shallow freezing these would leave `.function.description` — the part worth editing. */
function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") for (const held of Object.values(value)) deepFreeze(held);
  return Object.freeze(value);
}

export const LIST_RESOURCES = "list_resources";
export const READ_RESOURCE = "read_resource";

/**
 * Frozen and shared, for the same reason as agent-core's `LOAD_TOOLS_DEFINITION`: the agent loop
 * asks for these on every iteration, and one mutable export reached by every consumer means a
 * caller that edits a description in place has edited it everywhere.
 */
export const RESOURCE_TOOLS: ToolDefinition[] = deepFreeze([
  {
    type: "function",
    function: {
      name: LIST_RESOURCES,
      description:
        "List the resources the connected MCP servers hold — files, schemas, documents — as " +
        "uris you can then read with `read_resource`. Takes no arguments and lists every " +
        "server. Call it when you need context a tool does not return; do not call it twice in " +
        "a turn, and do not mention this mechanism in your answer.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: READ_RESOURCE,
      description:
        "Read one MCP resource by uri and get its contents. The uri comes from " +
        "`list_resources`, or from a `[resource_link ...]` in a tool result — either is a uri " +
        "you can read directly, and a link in a result does not need listing first.",
      parameters: {
        type: "object",
        properties: {
          uri: { type: "string", description: "The resource's uri, exactly as it was given." },
        },
        required: ["uri"],
        additionalProperties: false,
      },
    },
  },
]);

/**
 * Which server answered for a uri, learned from the last listing.
 *
 * A read has to be addressed to one server, and a uri does not say which — `file:///README.md`
 * is a plausible answer from two of them. This is the fast path and not the only one: a uri the
 * model got from a `resource_link` in a tool result was never in a listing, and `read` falls back
 * to asking the servers in turn rather than refusing a uri the model was handed.
 *
 * Process-lifetime and never invalidated on purpose. A stale entry costs one failed read on a
 * server that no longer holds the uri, and the fallback below then finds the one that does;
 * clearing it on reconnect would buy nothing that the fallback does not already cover.
 */
const owners = new Map<string, string>();

/** One resource as a line under its server, in the shape `catalogList` uses for tools. */
const line = (resource: { uri: string; name?: string; mimeType?: string }) => {
  const named = [resource.name, resource.mimeType].filter(Boolean).join(", ");
  return `  ${resource.uri}${named ? ` — ${named}` : ""}`;
};

/**
 * Every resource-serving server's listing, as text for a tool result.
 *
 * Servers are asked in parallel and a server that fails is reported rather than thrown for: one
 * server being unable to list is not a reason to withhold the four that could, and a model told
 * "this server errored" can work with the rest instead of concluding it has no resources at all.
 */
export async function list(): Promise<string> {
  const servers = resourceServers();
  if (servers.length === 0) return "No connected MCP server offers resources.";

  const listings = await Promise.all(
    servers.map(async ({ id, label }) => {
      try {
        const { resources } = await (await client(id)).listResources();
        for (const resource of resources) owners.set(resource.uri, id);
        return resources.length > 0
          ? `${label}:\n${resources.map(line).join("\n")}`
          : `${label}: no resources.`;
      } catch (error) {
        return `${label}: could not be listed — ${error instanceof Error ? error.message : String(error)}`;
      }
    }),
  );
  return listings.join("\n\n");
}

/** The text of one `resources/read`, with what has none named rather than dropped. */
const contentsText = (contents: { uri?: string; text?: string; mimeType?: string }[]) =>
  contents
    .map((part) =>
      typeof part.text === "string"
        ? part.text
        : `[${part.mimeType ?? "binary"} content at ${part.uri ?? "unknown uri"}]`,
    )
    .join("\n")
    .trim();

/**
 * Reads one resource, from whichever server holds it.
 *
 * The remembered owner is tried first and the rest only if that fails or there was none, so the
 * common path is one request and the uncommon one is bounded by the number of resource-serving
 * servers. Trying them all is what makes a uri lifted out of a `resource_link` readable without
 * a listing first — which, since the pool started surfacing those links in tool results, is how
 * a model most often comes by a uri at all.
 */
export async function read(uri: string): Promise<string> {
  const servers = resourceServers();
  if (servers.length === 0) throw new Error("No connected MCP server offers resources.");

  const owner = owners.get(uri);
  const order = owner
    ? [owner, ...servers.map((s) => s.id).filter((id) => id !== owner)]
    : servers.map((s) => s.id);

  let last: unknown;
  for (const id of order) {
    try {
      const { contents } = await (await client(id)).readResource({ uri });
      owners.set(uri, id);
      const text = contentsText(contents);
      return text || "(the resource is empty)";
    } catch (error) {
      last = error;
    }
  }
  throw new Error(
    `no connected MCP server could read ${uri}: ${last instanceof Error ? last.message : String(last)}`,
  );
}
