import { beforeEach, describe, expect, it, vi } from "vitest";

const resourceServers = vi.fn<() => { id: string; label: string }[]>();
const client = vi.fn<(id: string) => Promise<unknown>>();

vi.mock("../server/mcp.ts", () => ({ resourceServers: () => resourceServers(), client }));

const { list, read } = await import("../server/mcp-resources.ts");

/**
 * `list_resources` and `read_resource`, the two tools MCP resources reach the model through.
 *
 * Both talk to servers that may be several, slow, or broken independently of each other, and the
 * behaviour worth pinning is what happens when they are: one server failing must not withhold the
 * others, and a uri must be readable whether or not it came from a listing — a `resource_link` in
 * a tool result never was in one.
 *
 * Uris are distinct per test on purpose. The uri→server map is process-lifetime by design, so
 * reusing one across tests would let an earlier test's cache decide a later test's first request.
 */
const serving = (...ids: string[]) =>
  resourceServers.mockReturnValue(ids.map((id) => ({ id, label: id })));

const server = (handlers: {
  resources?: { uri: string; name?: string; mimeType?: string }[];
  read?: (uri: string) => { contents: { uri?: string; text?: string; mimeType?: string }[] };
}) => ({
  listResources: async () => {
    if (!handlers.resources) throw new Error("no resources here");
    return { resources: handlers.resources };
  },
  readResource: async ({ uri }: { uri: string }) => {
    if (!handlers.read) throw new Error(`${uri} is not here`);
    return handlers.read(uri);
  },
});

beforeEach(() => {
  resourceServers.mockReset();
  client.mockReset();
});

describe("list", () => {
  it("says so plainly when nothing connected offers resources", async () => {
    serving();
    expect(await list()).toBe("No connected MCP server offers resources.");
  });

  it("lists every server, and reports the one that failed instead of throwing", async () => {
    serving("docs", "broken");
    client.mockImplementation(async (id) =>
      id === "docs"
        ? server({ resources: [{ uri: "doc://a", name: "A", mimeType: "text/plain" }] })
        : server({}),
    );

    const listing = await list();
    // The server that could answer still answers: one server unable to list is not a reason to
    // withhold the others, and a model told which one broke can work with the rest.
    expect(listing).toContain("doc://a — A, text/plain");
    expect(listing).toContain("broken: could not be listed");
  });

  it("names a server that has no resources rather than dropping it", async () => {
    serving("empty");
    client.mockResolvedValue(server({ resources: [] }));
    expect(await list()).toBe("empty: no resources.");
  });
});

describe("read", () => {
  it("reads a uri it has never listed, by asking the servers in turn", async () => {
    // The `resource_link` case: the model lifted this uri out of a tool result, so no listing
    // ever told anyone which server holds it.
    serving("wrong", "right");
    client.mockImplementation(async (id) =>
      id === "right"
        ? server({ read: () => ({ contents: [{ uri: "link://1", text: "the contents" }] }) })
        : server({}),
    );
    expect(await read("link://1")).toBe("the contents");
  });

  it("goes straight to the server that answered last time, not through the list again", async () => {
    // The owner is second, so a cache hit is distinguishable from the order servers are tried in:
    // without one, "first" is always asked first and always fails.
    serving("first", "owner");
    const held = server({ read: () => ({ contents: [{ uri: "own://1", text: "mine" }] }) });
    client.mockImplementation(async (id) => (id === "owner" ? held : server({})));

    expect(await read("own://1")).toBe("mine");
    expect(client).toHaveBeenCalledTimes(2);

    client.mockClear();
    expect(await read("own://1")).toBe("mine");
    expect(client).toHaveBeenCalledTimes(1);
    expect(client).toHaveBeenCalledWith("owner");
  });

  it("names content it cannot turn into text rather than dropping it", async () => {
    serving("images");
    client.mockResolvedValue(
      server({
        read: () => ({ contents: [{ uri: "img://1", mimeType: "image/png" }] }),
      }),
    );
    expect(await read("img://1")).toBe("[image/png content at img://1]");
  });

  it("throws naming the uri when no server can read it", async () => {
    serving("a", "b");
    client.mockResolvedValue(server({}));
    await expect(read("gone://1")).rejects.toThrow(/no connected MCP server could read gone:\/\/1/);
  });

  it("refuses before dialling anything when no server offers resources", async () => {
    serving();
    await expect(read("doc://x")).rejects.toThrow(/No connected MCP server offers resources/);
    expect(client).not.toHaveBeenCalled();
  });
});
