/**
 * Jobs that are not the main chat turn and do not need the main chat model. Each is small,
 * frequent, and latency-sensitive, which is exactly what a cheap model is good at.
 *
 * This is its own module rather than part of `types.ts` because both Config screens render it
 * and nothing else there. `types.ts` is zod, and importing one constant out of it puts the
 * whole validator into a bundle that has no validating to do.
 */
export const MODEL_TASKS = [
  {
    key: "compaction",
    label: "Context compaction",
    empty: "off — long sessions eventually overflow",
    hint: "Summarises the oldest messages once a session fills 75% of the context window, so it can keep going.",
  },
  {
    key: "toolSelect",
    label: "Tool preselection",
    empty: "off — the model loads its own tools",
    hint: "Guesses which tools a request needs before the turn starts, so the chat model usually skips the load step. Only used with on-demand tool discovery.",
  },
  {
    key: "followups",
    label: "Follow-up suggestions",
    empty: "off — no suggestions",
    hint: "Proposes a few next questions under each reply in a chat, as chips you can click to send.",
  },
  {
    key: "title",
    label: "Session title",
    empty: "off — use the first message",
    hint: "Names a new chat once, from its opening message. Left off, the first line is truncated instead.",
  },
] as const;

export type ModelTask = (typeof MODEL_TASKS)[number]["key"];
