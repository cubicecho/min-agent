import type { ServerPrompts } from "@cubicecho/agent-mcp-pool";
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
 *
 * The protocol is the pool's: listing every page, asking only servers that declared `prompts`,
 * expanding and flattening. task-server had the same copy of it, and the two had begun to differ.
 * What is left here is min-agent's shape for a picker.
 */

/** The part of the app's MCP servers that prompts are read from. `Mcp` is one. */
export interface PromptSource {
  prompts(): Promise<ServerPrompts[]>;
  expandPrompt(serverId: string, name: string, args: Record<string, string>): Promise<string>;
  complete(
    serverId: string,
    prompt: string,
    argument: { name: string; value: string },
    context: Record<string, string>,
  ): Promise<string[]>;
  /** The name a server is shown under. */
  labelOf(id: string): string;
}

/**
 * The prompts every connected prompt-serving server offers, in configuration order.
 *
 * A server that could not list its prompts is a server with none, as far as a picker is
 * concerned. The MCP tab is where a broken connection is diagnosed, and it already says so;
 * failing the whole query here would empty the picker of the servers that answered.
 *
 * @param mcp - The servers to ask.
 * @returns Every prompt, each with the server it came from.
 */
export async function list(mcp: PromptSource): Promise<McpPrompt[]> {
  const listings = await mcp.prompts();
  return listings.flatMap(({ serverId, prompts }) => {
    const serverLabel = mcp.labelOf(serverId);
    return prompts.map((prompt) => ({
      server: serverId,
      serverLabel,
      name: prompt.name,
      title: prompt.title,
      description: prompt.description,
      arguments: (prompt.arguments ?? []).map((argument) => ({
        name: argument.name,
        description: argument.description,
        required: argument.required ?? false,
      })),
    }));
  });
}

/**
 * One prompt expanded, flattened to the single string a composer draft is.
 *
 * `prompts/get` answers with *messages* and the composer sends one user message. The pool's
 * `promptText` returns a lone message verbatim and labels the roles where there are several,
 * which is lossy: an `assistant` turn in a prompt is a worked example the server wanted in the
 * history, and as a line inside a user message it is a quotation of one. Worth revisiting if a
 * server that leans on multi-message prompts turns up; the fix is a session that can be seeded
 * with messages, which min-agent does not have.
 *
 * @param mcp - The servers to ask.
 * @param server - The id of the server that offers the prompt.
 * @param name - The prompt's name.
 * @param args - The prompt's arguments, as typed.
 * @returns The expansion, as one string.
 */
export const get = (
  mcp: PromptSource,
  server: string,
  name: string,
  args: Record<string, string>,
): Promise<string> => mcp.expandPrompt(server, name, args);

/**
 * What the server suggests for one of a prompt's arguments, given what is in it now and the
 * arguments already filled in — which a server may narrow by, a repository's branches once its
 * owner is known.
 *
 * A failure is no suggestions rather than an error. The picker asks as the person pauses typing,
 * and a refusal there has nowhere useful to go: the field still takes whatever is typed, and the
 * expansion is where a bad argument is said.
 *
 * @param mcp - The servers to ask.
 * @param server - The id of the server that offers the prompt.
 * @param name - The prompt's name.
 * @param argument - The argument being filled in, and its text so far.
 * @param args - The other arguments, as typed.
 * @returns The suggestions, in the server's order.
 */
export async function complete(
  mcp: PromptSource,
  server: string,
  name: string,
  argument: { name: string; value: string },
  args: Record<string, string>,
): Promise<string[]> {
  // Only the others: the argument being completed is `argument.value`, and a context that also
  // carried it would hand the server the same text twice under two meanings.
  const context = Object.fromEntries(
    Object.entries(args).filter(([key, value]) => key !== argument.name && value !== ""),
  );
  try {
    return await mcp.complete(server, name, argument, context);
  } catch {
    return [];
  }
}
