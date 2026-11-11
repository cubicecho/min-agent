import type { Mcp } from "../../server/mcp.ts";
import { list, type ResourceSource, read } from "../../server/mcp-resources.ts";
import { connectFixtures } from "./mcp-fixture.ts";

/**
 * `list_resources` and `read_resource`, the two tools MCP resources reach the model through,
 * against the real pool and in-process servers that page their listings.
 *
 * Both talk to servers that may be several, slow, or broken independently of each other, and the
 * behaviour worth pinning is what happens when they are: a listing must be whole however many
 * pages it took, one server failing must not withhold the others, and a uri must be readable
 * whether or not it came from a listing — a `resource_link` in a tool result never was in one.
 *
 * Uris are distinct per test on purpose. The uri→server map is process-lifetime by design, so
 * reusing one across tests would let an earlier test's cache decide a later test's first request.
 */

let mcp: Mcp | undefined;

afterEach(async () => {
  await mcp?.shutdown();
  mcp = undefined;
});

describe("list", () => {
  it("says so plainly when nothing connected offers resources", async () => {
    mcp = await connectFixtures("tools");
    expect(await list(mcp)).toBe("No connected MCP server offers resources.");
  });

  it("lists every page of resources, then every page of templates", async () => {
    mcp = await connectFixtures("docs");
    expect(await list(mcp)).toBe(
      [
        "docs server:",
        "  doc://1 — Doc 1, text/plain",
        "  doc://2 — Doc 2, text/plain",
        "  doc://3 — Doc 3, text/plain",
        "  doc://4 — Doc 4, text/plain",
        "  doc://5 — Doc 5, text/plain",
        "  doc://a/{path} — template, Under a",
        "  doc://b/{path} — template, Under b",
        "  doc://c/{path} — template, Under c",
      ].join("\n"),
    );
  });

  it("lists every server, and reports the one that failed instead of throwing", async () => {
    mcp = await connectFixtures("docs", "broken");
    const listing = await list(mcp);
    // The server that could answer still answers: one server unable to list is not a reason to
    // withhold the others, and a model told which one broke can work with the rest.
    expect(listing).toContain("doc://5 — Doc 5, text/plain");
    expect(listing).toContain("broken server: could not be listed — ");
    expect(listing).toContain("resources are down");
  });

  it("names a server that has no resources rather than dropping it", async () => {
    mcp = await connectFixtures("links");
    expect(await list(mcp)).toBe("links server: no resources.");
  });
});

describe("read", () => {
  it("reads a uri it has never listed, by asking the servers in turn", async () => {
    // The `resource_link` case: the model lifted this uri out of a tool result, so no listing
    // ever told anyone which server holds it.
    mcp = await connectFixtures("broken", "links");
    expect(await read(mcp, "link://1")).toBe("the linked contents");
  });

  it("reads a uri filled in from a template", async () => {
    mcp = await connectFixtures("docs");
    expect(await read(mcp, "doc://a/readme")).toBe("text of doc://a/readme");
  });

  it("names content it cannot turn into text rather than dropping it", async () => {
    mcp = await connectFixtures("docs");
    expect(await read(mcp, "doc://image")).toMatch(/^\[resource doc:\/\/image image\/png/);
  });

  it("throws naming the uri when no server can read it", async () => {
    mcp = await connectFixtures("docs", "broken");
    await expect(read(mcp, "doc://gone")).rejects.toThrow(
      /no connected MCP server could read doc:\/\/gone/,
    );
  });

  it("refuses when no server offers resources", async () => {
    mcp = await connectFixtures("tools");
    await expect(read(mcp, "doc://x")).rejects.toThrow(/No connected MCP server offers resources/);
  });

  it("goes straight to the server that answered last time, not through the list again", async () => {
    // A stand-in rather than the fixtures, because what is pinned is which server is asked, and
    // the pool does not say. The owner is second, so a cache hit is distinguishable from the
    // order servers are tried in: without one, "first" is always asked first and always fails.
    const readResource = vi.fn<ResourceSource["readResource"]>(async (id, uri) => {
      if (id !== "owner") {
        throw new Error(`${uri} is not here`);
      }
      return { uri, text: "mine", truncated: false };
    });
    const source: ResourceSource = {
      resourceServers: () => [
        { id: "first", label: "first" },
        { id: "owner", label: "owner" },
      ],
      resources: async () => [],
      readResource,
      labelOf: (id) => id,
    };

    expect(await read(source, "own://1")).toBe("mine");
    expect(readResource).toHaveBeenCalledTimes(2);

    readResource.mockClear();
    expect(await read(source, "own://1")).toBe("mine");
    expect(readResource.mock.calls).toEqual([["owner", "own://1"]]);
  });
});
