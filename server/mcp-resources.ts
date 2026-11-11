import type { ResourceText, ServerResources, ToolDefinition } from "@cubicecho/agent-mcp-pool";
import { messageOf } from "../shared/errors.ts";

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

/**
 * The part of the app's MCP servers that resources are read from. `Mcp` is one.
 *
 * The listing and the read are the pool's, which reads every page of both `resources/list` and
 * `resources/templates/list`. min-agent called `listResources()` once and so showed a model only
 * the first page of a server that paginates — with nothing in the answer to say there was more.
 */
export interface ResourceSource {
  /** The connected servers that offer resources, in configuration order. */
  resourceServers(): { id: string; label: string }[];
  resources(): Promise<ServerResources[]>;
  readResource(serverId: string, uri: string): Promise<ResourceText>;
  /** The name a server is shown under. */
  labelOf(id: string): string;
}

/** Shallow freezing these would leave `.function.description` — the part worth editing. */
function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const held of Object.values(value)) {
      deepFreeze(held);
    }
  }
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
        "uris you can then read with `read_resource`, and the uri templates they answer, whose " +
        "`{variables}` you fill in to make a uri. Takes no arguments and lists every server. " +
        "Call it when you need context a tool does not return; do not call it twice in a turn, " +
        "and do not mention this mechanism in your answer.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: READ_RESOURCE,
      description:
        "Read one MCP resource by uri and get its contents. The uri comes from " +
        "`list_resources` — as listed, or a template with its variables filled in — or from a " +
        "`[resource_link ...]` in a tool result, which does not need listing first.",
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
const line = (uri: string, ...about: (string | undefined)[]) => {
  const named = about.filter(Boolean).join(", ");
  return `  ${uri}${named ? ` — ${named}` : ""}`;
};

/**
 * Every resource-serving server's listing, as text for a tool result: its resources, then its
 * templates, each list to its last page.
 *
 * A server that fails is reported rather than thrown for: one server being unable to list is not
 * a reason to withhold the four that could, and a model told "this server errored" can work with
 * the rest instead of concluding it has no resources at all.
 *
 * @param mcp - The servers to ask.
 * @returns The listing, or why there is none.
 */
export async function list(mcp: ResourceSource): Promise<string> {
  const listings = await mcp.resources();
  if (listings.length === 0) {
    return "No connected MCP server offers resources.";
  }

  return listings
    .map(({ serverId, resources, templates, error }) => {
      const label = mcp.labelOf(serverId);
      if (error) {
        return `${label}: could not be listed — ${error}`;
      }
      for (const resource of resources) {
        owners.set(resource.uri, serverId);
      }
      const lines = [
        ...resources.map((resource) => line(resource.uri, resource.name, resource.mimeType)),
        ...templates.map((template) =>
          line(template.uriTemplate, "template", template.name, template.mimeType),
        ),
      ];
      return lines.length > 0 ? `${label}:\n${lines.join("\n")}` : `${label}: no resources.`;
    })
    .join("\n\n");
}

/**
 * Reads one resource, from whichever server holds it.
 *
 * The remembered owner is tried first and the rest only if that fails or there was none, so the
 * common path is one request and the uncommon one is bounded by the number of resource-serving
 * servers. Trying them all is what makes a uri lifted out of a `resource_link`, or filled in from
 * a template, readable without a listing having named it.
 *
 * @param mcp - The servers to ask.
 * @param uri - The resource's uri, as the model was given it.
 * @returns The resource's text.
 */
export async function read(mcp: ResourceSource, uri: string): Promise<string> {
  const servers = mcp.resourceServers();
  if (servers.length === 0) {
    throw new Error("No connected MCP server offers resources.");
  }

  const owner = owners.get(uri);
  const order = owner
    ? [owner, ...servers.map((s) => s.id).filter((id) => id !== owner)]
    : servers.map((s) => s.id);

  let last: unknown;
  for (const id of order) {
    try {
      const { text } = await mcp.readResource(id, uri);
      owners.set(uri, id);
      return text || "(the resource is empty)";
    } catch (error) {
      last = error;
    }
  }
  throw new Error(`no connected MCP server could read ${uri}: ${messageOf(last)}`);
}
