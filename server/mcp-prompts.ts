import { resultText } from "@cubicecho/agent-mcp-pool";
import type { McpPrompt } from "../shared/types.ts";

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

/** One prompt as a server lists it: the fields of `prompts/list` the picker reads. */
interface ListedPrompt {
  name: string;
  title?: string | undefined;
  description?: string | undefined;
  arguments?:
    | { name: string; description?: string | undefined; required?: boolean | undefined }[]
    | undefined;
}

/** The two calls of an MCP client this module makes. The SDK's `Client` is one. */
interface PromptClient {
  listPrompts(): Promise<{ prompts: ListedPrompt[] }>;
  getPrompt(request: {
    name: string;
    arguments: Record<string, string>;
  }): Promise<{ messages: { role: string; content: unknown }[] }>;
}

/** The part of the app's MCP servers that prompts are read from. `Mcp` is one. */
export interface PromptSource {
  /** The connected servers that offer prompts, in configuration order. */
  promptServers(): { id: string; label: string }[];
  /** One server's connected client. */
  client(id: string): Promise<PromptClient>;
}

/**
 * The prompts every connected prompt-serving server offers, in configuration order.
 *
 * @param mcp - The servers to ask.
 * @returns Every prompt, each with the server it came from.
 */
export async function list(mcp: PromptSource): Promise<McpPrompt[]> {
  const servers = mcp.promptServers();
  if (servers.length === 0) {
    return [];
  }

  const listings = await Promise.all(
    servers.map(async ({ id, label }) => {
      try {
        const { prompts } = await (await mcp.client(id)).listPrompts();
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
 *
 * @param mcp - The servers to ask.
 * @param server - The id of the server that offers the prompt.
 * @param name - The prompt's name.
 * @param args - The prompt's arguments, as typed.
 * @returns The expansion, as one string.
 */
export async function get(
  mcp: PromptSource,
  server: string,
  name: string,
  args: Record<string, string>,
): Promise<string> {
  const isUnknownServer = mcp.promptServers().some((offered) => offered.id === server) === false;
  if (isUnknownServer) {
    throw new Error(`${server} is not a connected MCP server that offers prompts`);
  }

  const { messages } = await (await mcp.client(server)).getPrompt({ name, arguments: args });
  if (messages.length === 1) {
    return messageText(messages[0].content);
  }
  return messages
    .map((message) => `${message.role}: ${messageText(message.content)}`)
    .join("\n\n")
    .trim();
}

/**
 * One message's content as text, with what has none named rather than dropped.
 *
 * A prompt message carries the same content blocks a tool result does, minus the list: an image
 * a server pasted in, a file it embedded. So it is flattened by the pool's own `resultText` as a
 * one-block result — a person reading the draft sees the same placeholder a model reads in a tool
 * result, and a `resource_link` keeps the uri and name that make it worth following.
 */
const messageText = (content: unknown) => resultText({ content: [content] });
