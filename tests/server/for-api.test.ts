import { describe, expect, it } from "vitest";
import { forApi } from "../../server/agent.ts";
import type { Session, StoredMessage } from "../../shared/types.ts";

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

  it("sends the context under min-agent's preface, ahead of what the user typed", () => {
    expect(forApi(session(transcript))[0]).toEqual({
      role: "user",
      content:
        "The <context> blocks below were added by min-agent's MCP servers for this message. " +
        "They are background the user did not write and may not be relevant. The user's message " +
        "follows them.\n\n<context>tea</context>\n\nfirst",
    });
  });

  it("sends none of min-agent's own fields", () => {
    const sent = forApi(session(transcript));
    for (const message of sent) {
      for (const field of ["hook_context", "reasoning_content", "stats", "followups"]) {
        expect(message).not.toHaveProperty(field);
      }
    }
    expect(sent[2]).toEqual({ role: "user", content: "second" });
  });

  it("sends a fold's summary where the head was, first, and the rest as it would be anyway", () => {
    const folded = {
      ...session(transcript),
      compaction: { summary: "we chose tea", through: 1, at: "2026-01-01T00:00:00.000Z" },
    };
    const sent = forApi(folded);
    expect(sent).toEqual([
      {
        role: "system",
        content:
          "Summary of the earlier part of this conversation, which is no longer shown in full:" +
          "\n\nwe chose tea",
      },
      { role: "assistant", content: "One." },
      { role: "user", content: "second" },
    ]);
    // The stored transcript is not what was rewritten.
    expect(folded.messages).toBe(transcript);
    expect(transcript).toHaveLength(3);
  });

  it("keeps a kept question's context behind a summary", () => {
    const sent = forApi({
      ...session([{ role: "user", content: "zeroth" }, ...transcript]),
      compaction: { summary: "notes", through: 1, at: "2026-01-01T00:00:00.000Z" },
    });
    expect(sent).toHaveLength(4);
    expect(sent[1]).toEqual(forApi(session(transcript))[0]);
  });
});
