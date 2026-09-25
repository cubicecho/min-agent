import { describe, expect, it } from "vitest";
import { forApi } from "../server/agent.ts";
import type { Session, StoredMessage } from "../shared/types.ts";

const session = (messages: StoredMessage[]) => ({ id: "s1", messages }) as Session;

describe("forApi", () => {
  const transcript: StoredMessage[] = [
    { role: "user", content: "first", hook_context: "<context>tea</context>" },
    {
      role: "assistant",
      content: "One.",
      reasoning_content: "thinking",
      stats: { model: "m" } as never,
      followups: ["Why?"],
    },
    { role: "user", content: "second" },
  ];

  it("sends a past question with its context, the same as on its own turn", () => {
    const onItsTurn = forApi(session(transcript.slice(0, 1)))[0];
    const later = forApi(session(transcript))[0];
    expect(later).toEqual(onItsTurn);
    expect(later.content).toContain("<context>tea</context>");
    expect((later.content as string).endsWith("first")).toBe(true);
  });

  it("sends none of min-agent's own fields", () => {
    const sent = forApi(session(transcript));
    for (const message of sent) {
      for (const field of ["hook_context", "reasoning_content", "stats", "followups"])
        expect(message).not.toHaveProperty(field);
    }
    expect(sent[2]).toEqual({ role: "user", content: "second" });
  });
});
