import { SUMMARY_ACK, SUMMARY_LEAD } from "@cubicecho/agent-core";
import { forApi } from "../../server/agent.ts";
import type { StoredMessage } from "../../shared/types.ts";
import { sessionOf, textOf, turnStats } from "../helpers.ts";

const session = (messages: StoredMessage[]) => sessionOf({ messages });

describe("forApi", () => {
  const transcript: StoredMessage[] = [
    { role: "user", content: "first", hook_context: "<context>tea</context>" },
    {
      role: "assistant",
      content: "One.",
      reasoning_content: "thinking",
      stats: turnStats(),
      followups: ["Why?"],
    },
    { role: "user", content: "second" },
  ];

  it("sends a past question with its context, the same as on its own turn", () => {
    const onItsTurn = forApi(session(transcript.slice(0, 1)))[0];
    const later = forApi(session(transcript))[0];
    expect(later).toEqual(onItsTurn);
    expect(later.content).toContain("<context>tea</context>");
    expect(textOf(later).endsWith("first")).toBe(true);
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
      for (const field of ["hook_context", "reasoning_field", "stats", "followups"]) {
        expect(message).not.toHaveProperty(field);
      }
    }
    expect(sent[2]).toEqual({ role: "user", content: "second" });
  });

  describe("the thinking on a reply", () => {
    /** An earlier turn that called a tool, then the question being answered and its own call. */
    const working: StoredMessage[] = [
      { role: "user", content: "first" },
      {
        role: "assistant",
        content: null,
        reasoning_content: "look first",
        tool_calls: [{ id: "c1", type: "function", function: { name: "ls", arguments: "{}" } }],
      },
      { role: "tool", tool_call_id: "c1", content: "a.txt" },
      { role: "assistant", content: "One file.", reasoning_content: "that is all" },
      { role: "user", content: "second" },
      {
        role: "assistant",
        content: null,
        reasoning_content: "look again",
        reasoning_field: "reasoning",
        tool_calls: [{ id: "c2", type: "function", function: { name: "ls", arguments: "{}" } }],
      },
      { role: "tool", tool_call_id: "c2", content: "a.txt" },
    ];
    /** What each reply carried back, by its index in the request. */
    const carried = (replay?: "all" | "tool-loop" | "none") =>
      forApi(session(working), replay).flatMap((message, at) => {
        const thought = message as { reasoning_content?: string; reasoning?: string };
        return message.role === "assistant"
          ? [[at, thought.reasoning_content ?? thought.reasoning ?? null]]
          : [];
      });

    it("goes back on every reply by default, earlier turns included", () => {
      expect(carried()).toEqual([
        [1, "look first"],
        [3, "that is all"],
        [5, "look again"],
      ]);
      expect(carried("all")).toEqual(carried());
    });

    it("goes back only on the calls of the question being answered under tool-loop", () => {
      expect(carried("tool-loop")).toEqual([
        [1, null],
        [3, null],
        [5, "look again"],
      ]);
    });

    it("goes back on nothing under none", () => {
      expect(carried("none")).toEqual([
        [1, null],
        [3, null],
        [5, null],
      ]);
    });

    it("goes back under the field it arrived in", () => {
      const sent = forApi(session(working));
      expect(sent[1]).toHaveProperty("reasoning_content", "look first");
      expect(sent[5]).toHaveProperty("reasoning", "look again");
      expect(sent[5]).not.toHaveProperty("reasoning_content");
    });

    it("takes OpenRouter's reasoning blocks with it, under the same policy", () => {
      const details = [{ type: "reasoning.encrypted", data: "opaque" }];
      const chat = session([
        { role: "user", content: "q" },
        { role: "assistant", content: "a", reasoning_content: "r", reasoning_details: details },
      ]);
      expect(forApi(chat)[1]).toEqual({
        role: "assistant",
        content: "a",
        reasoning_content: "r",
        reasoning_details: details,
      });
      expect(forApi(chat, "none")[1]).toEqual({ role: "assistant", content: "a" });
    });
  });

  it("sends a reply with neither text nor calls as an empty string, which Ollama will take", () => {
    const sent = forApi(
      session([
        { role: "user", content: "q" },
        { role: "assistant", content: null, reasoning_content: "only thought" },
      ]),
      "none",
    );
    expect(sent[1]).toEqual({ role: "assistant", content: "" });
  });

  it("sends a fold's summary where the head was, first, and the rest as it would be anyway", () => {
    const folded = {
      ...session(transcript),
      compaction: { summary: "we chose tea", through: 1, at: "2026-01-01T00:00:00.000Z" },
    };
    const sent = forApi(folded, "none");
    // A user message and its acknowledgement since agent-core 4.23.1, never a second system one.
    expect(sent).toEqual([
      { role: "user", content: `${SUMMARY_LEAD}we chose tea` },
      { role: "assistant", content: SUMMARY_ACK },
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
    expect(sent).toHaveLength(5);
    expect(sent[2]).toEqual(forApi(session(transcript))[0]);
  });
});
