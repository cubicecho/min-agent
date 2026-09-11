import type { McpPrompt } from "../shared/types.ts";
import { client, promptServers } from "./mcp.ts";

/**
 * MCP prompts, as things a person picks rather than things the model calls.
 *
 * A prompt is a server's own phrasing of a job it is good at — "review this diff", "explain this
 * query plan" — parameterised and written by whoever wrote the server. min-agent indexed
 * `tools/list` and nothing else, so a server could ship a dozen of them and none of it reached
 * the app.
 *
 * They go to the composer and not to the model, which is the opposite of what `mcp-resources.ts`
 * does with resources, and for a reason that is in the protocol rather than in taste: the spec
 * calls prompts user-controlled — they exist to be surfaced as slash commands, menu items, the
 * things a person chooses. A model that can invoke them itself is a model choosing its own
 * instructions, and a listing in the system prompt would spend the window on templates most turns
 * never use. Expanding into the draft costs nothing until someone opens the picker, and leaves
 * the expansion editable before it is sent — which matters, because a template is a starting
 * point and the argument the user typed is rarely the whole of what they meant.
 */

/** The prompts every connected prompt-serving server offers, in configuration order. */
export async function list(): Promise<McpPrompt[]> {
  const servers = promptServers();
  if (servers.length === 0) return [];

  const listings = await Promise.all(
    servers.map(async ({ id, label }) => {
      try {
        const { prompts } = await (await client(id)).listPrompts();
        return prompts.map((prompt) => ({
          server: id,
          serverLabel: label,
          name: prompt.name,
          title: prompt.title,
          description: prompt.description,
          arguments: (prompt.arguments ?? []).map((argument) => ({
            name: argument.name,
            description: argument.description,
            required: argument.required ?? false,
          })),
        }));
      } catch {
        // A server that cannot list its prompts is a server with none, as far as a picker is
        // concerned. The MCP tab is where a broken connection is diagnosed, and it already says
        // so; failing the whole query here would empty the picker of the servers that answered.
        return [];
      }
    }),
  );
  return listings.flat();
}

/**
 * One prompt expanded, flattened to the single string a composer draft is.
 *
 * `prompts/get` answers with *messages* — a list, each with a role — and the composer sends one
 * user message. The common case is a template that returns exactly one, and that one arrives
 * verbatim. Where a server returns several the roles are labelled and the text joined, which is
 * lossy: an `assistant` turn in a prompt is a worked example the server wanted in the history,
 * and as a line inside a user message it is a quotation of one. Labelling it at least leaves the
 * model able to read it as one, where dropping the roles would not. Worth revisiting if a server
 * that leans on multi-message prompts turns up; the fix is a session that can be seeded with
 * messages, which min-agent does not have.
 */
export async function get(
  server: string,
  name: string,
  args: Record<string, string>,
): Promise<string> {
  if (!promptServers().some((offered) => offered.id === server)) {
    throw new Error(`${server} is not a connected MCP server that offers prompts`);
  }

  const { messages } = await (await client(server)).getPrompt({ name, arguments: args });
  if (messages.length === 1) return messageText(messages[0].content).trim();
  return messages
    .map((message) => `${message.role}: ${messageText(message.content).trim()}`)
    .join("\n\n")
    .trim();
}

/**
 * One message's content as text, with what has none named rather than dropped.
 *
 * A prompt message carries the same content blocks a tool result does, minus the list: an image
 * a server pasted in, a file it embedded. The placeholder is what the pool's `resultText` settled
 * on — a person reading the draft can see that something was there and that it did not survive
 * the trip through a text box, rather than finding a gap.
 */
function messageText(content: {
  type?: string;
  text?: string;
  uri?: string;
  resource?: { text?: string; uri?: string };
}): string {
  if (typeof content.text === "string") return content.text;
  if (typeof content.resource?.text === "string") return content.resource.text;
  const uri = content.resource?.uri ?? content.uri;
  return uri
    ? `[${content.type ?? "unknown"} content at ${uri}]`
    : `[${content.type ?? "unknown"} content]`;
}
