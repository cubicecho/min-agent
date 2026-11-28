import type { LanServer, ServerWatchHandlers } from "@cubicecho/mcp-discovery/mdns";
import { createDiscovery } from "../../server/discovery.ts";
import { envFlag } from "../../server/paths.ts";
import { type McpServerConfig, mcpServerSchema } from "../../shared/types.ts";
import { lanServer } from "./lan-server.ts";

/** Discovery over a fake network, with the configured servers under the test's control. */
function setup(enabled = true) {
  const state = { configured: [] as McpServerConfig[] };
  let handlers: ServerWatchHandlers | undefined;
  const stop = vi.fn(async () => undefined);
  const watch = vi.fn(async (given: ServerWatchHandlers) => {
    handlers = given;
    return { stop };
  });
  const log = vi.fn();
  const discovery = createDiscovery({ enabled, configured: () => state.configured, watch, log });
  const announce = (server: LanServer) => handlers?.onUp(server);
  const leave = (server: LanServer) => handlers?.onDown?.(server);
  return { discovery, state, watch, stop, log, announce, leave };
}

const skills = lanServer(
  { name: "io.github.cubicecho.mcp-skills.nas/skills", title: "Skills" },
  "http://192.168.1.20:3000/mcp",
  ["Authorization"],
);

describe("createDiscovery", () => {
  it("offers a found server with its endpoint and the headers left to fill in", async () => {
    const { discovery, announce } = setup();
    await discovery.start();
    announce(skills);

    expect(discovery.list()).toEqual([
      {
        key: "MCP Skills on nas/io.github.cubicecho.mcp-skills.nas/skills",
        name: "io.github.cubicecho.mcp-skills.nas/skills",
        title: "Skills",
        description: "Something useful.",
        host: "MCP Skills on nas",
        url: "http://192.168.1.20:3000/mcp",
        requiredHeaders: ["Authorization"],
      },
    ]);
  });

  it("hides a server whose URL a configured row already points at, however it is written", async () => {
    const { discovery, state, announce } = setup();
    await discovery.start();
    announce(skills);
    state.configured = [
      mcpServerSchema.parse({
        id: "mine",
        transport: "http",
        url: "http://192.168.1.20:3000/mcp/",
      }),
    ];

    expect(discovery.list()).toEqual([]);
  });

  it("leaves out a card with no URL it can dial, and drops a server that leaves", async () => {
    const { discovery, announce, leave } = setup();
    await discovery.start();
    announce(lanServer({ name: "io.example/sse-only" }, null));
    announce(skills);
    leave(skills);

    expect(discovery.list()).toEqual([]);
  });

  it("never watches when switched off", async () => {
    const { discovery, watch } = setup(false);
    await discovery.start();

    expect(watch).not.toHaveBeenCalled();
    expect(discovery.list()).toEqual([]);
  });

  it("logs a watch that cannot start instead of throwing", async () => {
    const log = vi.fn();
    const discovery = createDiscovery({
      enabled: true,
      configured: () => [],
      watch: async () => {
        throw new Error("bonjour-service is not installed");
      },
      log,
    });

    await expect(discovery.start()).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("could not watch the local network"));
  });

  it("stops the watch on stop, and forgets what it found", async () => {
    const { discovery, stop, announce } = setup();
    await discovery.start();
    announce(skills);
    await discovery.stop();

    expect(stop).toHaveBeenCalledTimes(1);
    expect(discovery.list()).toEqual([]);
  });
});

describe("envFlag", () => {
  it("reads on and off words in any case, and falls back on anything else", () => {
    expect(envFlag("FALSE", true)).toBe(false);
    expect(envFlag("off", true)).toBe(false);
    expect(envFlag("1", false)).toBe(true);
    expect(envFlag(undefined, true)).toBe(true);
    expect(envFlag("maybe", false)).toBe(false);
  });
});
