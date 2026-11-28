import {
  freeId,
  fromDiscovered,
  fromHeaderDrafts,
  toHeaderDrafts,
} from "../../../shared/client/mcp-draft.ts";
import { type DiscoveredMcpServer, mcpServerSchema } from "../../../shared/types.ts";

const found: DiscoveredMcpServer = {
  key: "MCP Skills on nas/io.github.cubicecho.mcp-skills.nas/skills",
  name: "io.github.cubicecho.mcp-skills.nas/skills",
  title: "Skills",
  description: "Something useful.",
  host: "MCP Skills on nas",
  url: "http://192.168.1.20:3000/mcp",
  requiredHeaders: ["Authorization"],
};

const blank = mcpServerSchema.parse({ id: "server-1", command: "npx" });

describe("header drafts", () => {
  it("round-trips names with dots and other path characters exactly", () => {
    const headers = { "X-Api.Key": "k", "x[0]": "v", Authorization: "" };

    expect(toHeaderDrafts(headers)).toEqual([
      { name: "X-Api.Key", value: "k" },
      { name: "x[0]", value: "v" },
      { name: "Authorization", value: "" },
    ]);
    expect(fromHeaderDrafts(toHeaderDrafts(headers))).toEqual(headers);
  });
});

describe("fromDiscovered", () => {
  it("fills in an http row with a box for each required header, left empty", () => {
    expect(fromDiscovered(found, blank, [])).toMatchObject({
      id: "skills",
      label: "Skills",
      transport: "http",
      url: "http://192.168.1.20:3000/mcp",
      headers: { Authorization: "" },
    });
  });

  it("picks an id no row uses yet", () => {
    const taken = [mcpServerSchema.parse({ id: "skills", command: "npx" })];

    expect(freeId(found.name, taken)).toBe("skills-2");
    expect(freeId("io.example/...", [])).toBe("server");
  });
});
