import type { Elicitation, ElicitationAction } from "../elicitation.ts";
import type { HookNote, StreamEvent } from "../types.ts";

/** One piece of an in-flight assistant turn, in arrival order. `key` is stable for React. */
export type LivePart =
  | { kind: "reasoning" | "text"; key: string; text: string }
  | { kind: "hook"; key: string; hook: HookNote }
  | {
      kind: "question";
      key: string;
      elicitation: Elicitation;
      /** How it ended; absent while the server is still waiting on the person. */
      answer?: ElicitationAction;
    }
  | {
      kind: "tool";
      key: string;
      id: string;
      name: string;
      input: string;
      result?: string;
      isError?: boolean;
      /** What the call's server logged while it ran, in arrival order. */
      logs?: ServerLog[];
    };

/** One message a tool's server logged during a call, as its card shows it. */
export interface ServerLog {
  level: string;
  text: string;
}

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
    case "server_log":
      return parts.map((part) =>
        part.kind === "tool" && part.id === event.toolUseId
          ? { ...part, logs: [...(part.logs ?? []), { level: event.level, text: event.text }] }
          : part,
      );
    case "hook":
      return [...parts, { kind: "hook", key: String(parts.length), hook: event.hook }];
    case "elicitation":
      return [
        ...parts,
        { kind: "question", key: String(parts.length), elicitation: event.elicitation },
      ];
    case "elicitation_end":
      return parts.map((part) =>
        part.kind === "question" && part.elicitation.id === event.id
          ? { ...part, answer: event.action }
          : part,
      );
    default:
      return parts;
  }
}

/** Characters generated so far this turn — a stand-in for a token count while streaming. */
export const liveCharCount = (parts: LivePart[]) =>
  parts.reduce(
    (total, part) =>
      part.kind === "text" || part.kind === "reasoning" ? total + part.text.length : total,
    0,
  );

/** The questions in a live turn that a server is still waiting on the person to answer. */
export const waitingQuestions = (parts: LivePart[]) =>
  parts.flatMap((part) =>
    part.kind === "question" && part.answer === undefined ? [part.elicitation] : [],
  );
