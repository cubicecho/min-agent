import { createGqlClient } from "@shared/client/gql.ts";
import { TypedDocumentString } from "@shared/gql/graphql.ts";

const PING = new TypedDocumentString<{ ok: boolean }, Record<string, never>>("query Ping { ok }");

/** A client whose server answers every request with the one body given. */
const answering = (body: string) =>
  createGqlClient({ endpoint: "/graphql", fetch: async () => new Response(body) });

/**
 * A body that parses is not yet a GraphQL response: `null` is valid JSON, and so is a list.
 * Either is the server saying nothing, and is reported the way an empty response is.
 */
describe("a body that is JSON and not a response", () => {
  it.each([
    ["null", "null"],
    ["a number", "5"],
    ["errors that are not a list", '{"errors":"nope"}'],
  ])("reports %s as no data", async (_what, body) => {
    await expect(answering(body).request(PING)).rejects.toThrow("no data");
  });

  it("reports a null event on a subscription as no data", async () => {
    const events = answering("data: null\n\n").subscribe(PING, {});

    await expect(events.next()).rejects.toThrow("no data");
  });
});
