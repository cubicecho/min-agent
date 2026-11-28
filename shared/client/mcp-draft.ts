import type { DiscoveredMcpServer, McpServerConfig } from "../types.ts";

/**
 * The MCP tab's server dialog, the parts of it that are plain data: how a row's headers are held
 * while they are edited, and how a server found on the network becomes a new row.
 */

/**
 * One header as the form holds it. A list rather than the stored record, because a form field is
 * addressed by a path, and a header name such as `X-Api.Key` would be read as two segments of it.
 * In a list a header is `headers[2].value`, whatever it is called.
 */
export interface HeaderDraft {
  name: string;
  value: string;
}

/**
 * A row's headers as the form edits them, in the order they were stored.
 *
 * @param headers - The stored headers.
 * @returns One draft per header.
 */
export const toHeaderDrafts = (headers: Record<string, string>): HeaderDraft[] =>
  Object.entries(headers).map(([name, value]) => ({ name, value }));

/**
 * Back to what is stored. Names are kept exactly as they were, and an empty value is kept too: a
 * header is optional, and one left blank is the person's choice.
 *
 * @param drafts - The headers as the form holds them.
 * @returns The stored headers.
 */
export const fromHeaderDrafts = (drafts: HeaderDraft[]): Record<string, string> =>
  Object.fromEntries(drafts.map((header) => [header.name, header.value]));

/** What a server id may be, as `mcpServerSchema` checks it: up to 32, starting on a letter or digit. */
const ID_MAX_CHARS = 32;

/** Room left at the end of an id for a `-N` that makes it unique. */
const ID_SUFFIX_CHARS = 3;

/**
 * An id for a server found on the network that no row uses yet: the last part of its card's
 * name, `io.github.cubicecho.mcp-skills.nas/skills` → `skills`, then `skills-2` if that is taken.
 *
 * @param cardName - The card's name.
 * @param taken - The rows there are.
 * @returns An id `mcpServerSchema` accepts.
 */
export const freeId = (cardName: string, taken: McpServerConfig[]): string => {
  const tail = cardName.split("/").at(-1) ?? "";
  const cleaned = tail
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^[^a-zA-Z0-9]+/, "")
    .slice(0, ID_MAX_CHARS - ID_SUFFIX_CHARS);
  const base = cleaned || "server";
  let candidate = base;
  for (let n = 2; taken.some((server) => server.id === candidate); n += 1) {
    candidate = `${base}-${n}`;
  }
  return candidate;
};

/**
 * A new row filled in from a server found on the network. The headers its card requires are
 * there with no value: they are usually secrets only the person has, and the dialog offers a box
 * for each. Saving with one left blank is allowed.
 *
 * @param found - The server found.
 * @param blank - The new row the dialog would otherwise open on.
 * @param taken - The rows there are, so the id is free.
 * @returns The row to open the dialog on.
 */
export const fromDiscovered = (
  found: DiscoveredMcpServer,
  blank: McpServerConfig,
  taken: McpServerConfig[],
): McpServerConfig => ({
  ...blank,
  id: freeId(found.name, taken),
  label: found.title ?? found.name,
  transport: "http",
  command: "",
  url: found.url,
  headers: Object.fromEntries(found.requiredHeaders.map((header) => [header, ""])),
});
