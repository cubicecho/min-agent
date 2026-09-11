import { beforeEach, describe, expect, it, vi } from "vitest";

const promptServers = vi.fn<() => { id: string; label: string }[]>();
const client = vi.fn<(id: string) => Promise<unknown>>();

vi.mock("../server/mcp.ts", () => ({ promptServers: () => promptServers(), client }));

const { list, get } = await import("../server/mcp-prompts.ts");

/**
 * The prompts a server offers, as the composer's picker reads them.
 *
 * Unlike resources these never reach the model on their own — a person picks one — so what is
 * worth pinning is a picker's needs: a listing that survives one broken server, and an expansion
 * that arrives as the single string a draft is, whatever shape the server answered in.
 */
const serving = (...ids: string[]) =>
  promptServers.mockReturnValue(ids.map((id) => ({ id, label: `${id} server` })));

type Prompt = {
  name: string;
  title?: string;
  description?: string;
  arguments?: { name: string; description?: string; required?: boolean }[];
};
type Message = { role: string; content: Record<string, unknown> };

const server = (handlers: {
  prompts?: Prompt[];
  get?: (name: string, args: Record<string, string>) => { messages: Message[] };
}) => ({
  listPrompts: async () => {
    if (!handlers.prompts) throw new Error("no prompts here");
    return { prompts: handlers.prompts };
  },
  getPrompt: async ({
    name,
    arguments: args,
  }: {
    name: string;
    arguments: Record<string, string>;
  }) => {
    if (!handlers.get) throw new Error(`${name} is not here`);
    return handlers.get(name, args);
  },
});

const text = (body: string) => ({ type: "text", text: body });

beforeEach(() => {
  promptServers.mockReset();
  client.mockReset();
});

describe("list", () => {
  it("is empty, and dials nothing, when no connected server offers prompts", async () => {
    serving();
    expect(await list()).toEqual([]);
    expect(client).not.toHaveBeenCalled();
  });

  it("carries the server on every row, since two servers may name a prompt the same", async () => {
    serving("docs", "code");
    client.mockImplementation(async (id) =>
      server({ prompts: [{ name: "summarize", title: `${id} summary` }] }),
    );

    const prompts = await list();
    expect(prompts.map((prompt) => [prompt.server, prompt.name])).toEqual([
      ["docs", "summarize"],
      ["code", "summarize"],
    ]);
    expect(prompts[0].serverLabel).toBe("docs server");
  });

  it("defaults `required` to false, which is what the protocol means by omitting it", async () => {
    serving("docs");
    client.mockResolvedValue(
      server({
        prompts: [
          { name: "review", arguments: [{ name: "diff", required: true }, { name: "style" }] },
        ],
      }),
    );

    expect((await list())[0].arguments).toEqual([
      { name: "diff", description: undefined, required: true },
      { name: "style", description: undefined, required: false },
    ]);
  });

  it("keeps the servers that answered when one cannot be listed", async () => {
    serving("docs", "broken");
    client.mockImplementation(async (id) =>
      id === "docs" ? server({ prompts: [{ name: "summarize" }] }) : server({}),
    );

    // A picker has nowhere to show an error and no way to act on one; the MCP tab is where a
    // broken connection is diagnosed. Failing here would empty the list of the server that works.
    expect((await list()).map((prompt) => prompt.server)).toEqual(["docs"]);
  });
});

describe("get", () => {
  it("refuses a server that offers no prompts before dialling it", async () => {
    serving("docs");
    await expect(get("other", "summarize", {})).rejects.toThrow(/not a connected MCP server/);
    expect(client).not.toHaveBeenCalled();
  });

  it("passes the arguments through and returns a lone message verbatim", async () => {
    serving("docs");
    const got = vi.fn((_name: string, args: Record<string, string>) => ({
      messages: [{ role: "user", content: text(`review ${args.diff}`) }],
    }));
    client.mockResolvedValue(server({ get: got }));

    expect(await get("docs", "review", { diff: "abc" })).toBe("review abc");
    expect(got).toHaveBeenCalledWith("review", { diff: "abc" });
  });

  it("labels the roles when a prompt is more than one message", async () => {
    serving("docs");
    client.mockResolvedValue(
      server({
        get: () => ({
          messages: [
            { role: "assistant", content: text("Here is how I would answer.") },
            { role: "user", content: text("Now do it for mine.") },
          ],
        }),
      }),
    );

    // Lossy and deliberately so: the composer sends one user message, and a worked example
    // quoted inside it is still readable as one where a dropped role would not be.
    expect(await get("docs", "review", {})).toBe(
      "assistant: Here is how I would answer.\n\nuser: Now do it for mine.",
    );
  });

  it("unwraps an embedded resource and names what has no text at all", async () => {
    serving("docs");
    client.mockResolvedValue(
      server({
        get: () => ({
          messages: [
            {
              role: "user",
              content: { type: "resource", resource: { uri: "doc://a", text: "A" } },
            },
            { role: "user", content: { type: "image", mimeType: "image/png", data: "..." } },
          ],
        }),
      }),
    );

    const expansion = await get("docs", "look", {});
    expect(expansion).toContain("user: A");
    expect(expansion).toContain("[image content]");
  });
});
