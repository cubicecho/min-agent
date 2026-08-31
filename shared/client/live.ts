import type { StreamEvent } from "../types.ts";

/** One piece of an in-flight assistant turn, in arrival order. `key` is stable for React. */
export type LivePart =
  | { kind: "reasoning" | "text"; key: string; text: string }
  | {
      kind: "tool";
      key: string;
      id: string;
      name: string;
      input: string;
      result?: string;
      isError?: boolean;
    };

/** Folds one SSE event into the in-flight parts list. */
export function applyEvent(parts: LivePart[], event: StreamEvent): LivePart[] {
  const last = parts.at(-1);

  switch (event.type) {
    case "text_delta":
    case "reasoning_delta": {
      const kind = event.type === "text_delta" ? "text" : "reasoning";
      if (last && last.kind === kind) {
        return [...parts.slice(0, -1), { kind, key: last.key, text: last.text + event.text }];
      }
      return [...parts, { kind, key: String(parts.length), text: event.text }];
    }
    case "tool_use":
      return [
        ...parts,
        {
          kind: "tool",
          key: String(parts.length),
          id: event.id,
          name: event.name,
          input: event.input,
        },
      ];
    case "tool_result":
      return parts.map((part) =>
        part.kind === "tool" && part.id === event.toolUseId
          ? { ...part, result: event.content, isError: event.isError }
          : part,
      );
    default:
      return parts;
  }
}

/** Characters generated so far this turn — a stand-in for a token count while streaming. */
export const liveCharCount = (parts: LivePart[]) =>
  parts.reduce((total, part) => (part.kind === "tool" ? total : total + part.text.length), 0);
