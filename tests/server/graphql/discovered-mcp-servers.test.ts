import type { ServerWatchHandlers } from "@cubicecho/mcp-discovery/mdns";
import { graphql } from "graphql";
import { createSettings } from "../../../server/config.ts";
import { createDiscovery } from "../../../server/discovery.ts";
import { createSchema } from "../../../server/graphql/schema.ts";
import { createMcp } from "../../../server/mcp.ts";
import { createStore } from "../../../server/store.ts";
import { DiscoveredMcpServersDocument } from "../../../shared/gql/graphql.ts";
import { closeTestDb, createTestDb } from "../db.ts";
import { lanServer } from "../lan-server.ts";

/** `discoveredMcpServers` lists what discovery found, through the document the app sends. */
const db = await createTestDb();
const settings = createSettings(db);

const query = (schema: ReturnType<typeof createSchema>) =>
  graphql({ schema, source: DiscoveredMcpServersDocument.toString() });

describe("discoveredMcpServers", () => {
  afterAll(() => closeTestDb(db));

  it("answers with each server found on the network", async () => {
    let handlers: ServerWatchHandlers | undefined;
    const discovery = createDiscovery({
      enabled: true,
      configured: () => [],
      watch: async (given) => {
        handlers = given;
        return { stop: async () => undefined };
      },
      log: () => undefined,
    });
    await discovery.start();
    handlers?.onUp(lanServer({ name: "io.example/weather" }, "http://10.0.0.5/mcp", ["X-Api-Key"]));
    const schema = createSchema({
      db,
      mcp: createMcp(),
      store: createStore(db),
      settings,
      discovery,
    });

    expect(await query(schema)).toEqual({
      data: {
        discoveredMcpServers: [
          {
            key: "MCP Skills on nas/io.example/weather",
            name: "io.example/weather",
            title: null,
            description: "Something useful.",
            host: "MCP Skills on nas",
            url: "http://10.0.0.5/mcp",
            requiredHeaders: ["X-Api-Key"],
          },
        ],
      },
    });
  });

  it("is empty on a schema built without discovery", async () => {
    const schema = createSchema({ db, mcp: createMcp(), store: createStore(db), settings });

    expect(await query(schema)).toEqual({ data: { discoveredMcpServers: [] } });
  });
});
