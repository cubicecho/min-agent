import type { Mcp } from "../../server/mcp.ts";
import { complete, get, list } from "../../server/mcp-prompts.ts";
import { connectFixtures } from "./mcp-fixture.ts";

/**
 * The prompts a server offers, as the composer's picker reads them, through the real pool and
 * in-process servers that page their listings.
 *
 * Unlike resources these never reach the model on their own — a person picks one — so what is
 * worth pinning is a picker's needs: every page of a listing, a listing that survives one broken
 * server, an expansion that arrives as the single string a draft is, and suggestions that never
 * fail the field they are for.
 */

let mcp: Mcp | undefined;

afterEach(async () => {
  await mcp?.shutdown();
  mcp = undefined;
});

describe("list", () => {
  it("is empty when no connected server offers prompts", async () => {
    mcp = await connectFixtures("tools");
    expect(await list(mcp)).toEqual([]);
  });

  it("reads a server's prompts to the last page, not only the first", async () => {
    mcp = await connectFixtures("docs");
    expect((await list(mcp)).map((prompt) => prompt.name)).toEqual([
      "one",
      "two",
      "three",
      "four",
      "five",
    ]);
  });

  it("carries the server and its label on every row, and defaults `required` to false", async () => {
    mcp = await connectFixtures("docs");
    const [first, second] = await list(mcp);
    expect(first).toMatchObject({
      server: "docs",
      serverLabel: "docs server",
      title: "Prompt one",
    });
    expect(first.arguments).toEqual([{ name: "topic", description: undefined, required: true }]);
    expect(second.arguments).toEqual([{ name: "topic", description: undefined, required: false }]);
  });

  it("keeps the servers that answered when one cannot be listed", async () => {
    mcp = await connectFixtures("broken", "docs");
    // A picker has nowhere to show an error and no way to act on one; the MCP tab is where a
    // broken connection is diagnosed. Failing here would empty the list of the server that works.
    const servers = new Set((await list(mcp)).map((prompt) => prompt.server));
    expect([...servers]).toEqual(["docs"]);
  });
});

describe("get", () => {
  it("passes the arguments through and returns a lone message verbatim", async () => {
    mcp = await connectFixtures("docs");
    expect(await get(mcp, "docs", "one", { topic: "mcp" })).toBe("one about mcp");
  });

  it("refuses a server that offers no prompts", async () => {
    mcp = await connectFixtures("tools");
    await expect(get(mcp, "tools", "one", {})).rejects.toThrow();
  });
});

describe("complete", () => {
  it("suggests what the server does for the text typed so far", async () => {
    mcp = await connectFixtures("docs");
    expect(await complete(mcp, "docs", "one", { name: "topic", value: "m" }, {})).toEqual([
      "mcp",
      "models",
      "memory",
    ]);
  });

  it("sends the other arguments as context, and not the one being completed", async () => {
    mcp = await connectFixtures("docs");
    const suggested = await complete(
      mcp,
      "docs",
      "one",
      { name: "topic", value: "m" },
      { topic: "stale text", only: "memory" },
    );
    expect(suggested).toEqual(["memory"]);
  });

  it("is no suggestions rather than an error from a server that cannot complete", async () => {
    mcp = await connectFixtures("tools", "broken");
    expect(await complete(mcp, "tools", "one", { name: "topic", value: "" }, {})).toEqual([]);
    expect(await complete(mcp, "broken", "one", { name: "topic", value: "" }, {})).toEqual([]);
    expect(await complete(mcp, "nowhere", "one", { name: "topic", value: "" }, {})).toEqual([]);
  });
});
