import type { StreamEvent, TurnStats } from "../shared/types.ts";
import { runTurn } from "./agent.ts";
import { getSession } from "./store.ts";

/**
 * One streamed event, flattened for GraphQL.
 *
 * `StreamEvent` is a discriminated union, and a union of object types would make every client
 * write eight inline fragments to read eight small events. So the fields are spread flat and
 * `type` discriminates, exactly as it does on the wire today; the client narrows it back into
 * the union it already has a reducer for.
 */
export interface TurnEvent {
  /** From 1, so a client can order and de-duplicate. */
  seq: number;
  type: StreamEvent["type"];
  text?: string;
  id?: string;
  name?: string;
  input?: string;
  toolUseId?: string;
  content?: string;
  isError?: boolean;
  title?: string;
  stats?: TurnStats;
  items?: string[];
  message?: string;
}

const flatten = (event: StreamEvent, seq: number): TurnEvent => ({ seq, ...event });

export interface TurnArgs {
  sessionId: string;
  prompt: string;
  model?: string | null;
}

/**
 * Runs a turn and yields what it says, as it says it.
 *
 * The subscription *starts* the turn rather than watching one started elsewhere. That is
 * unusual for a subscription and deliberate: it is the contract the old `POST
 * /sessions/:id/messages` had, and it is the one that cannot drop events. Split into a
 * mutation that starts the turn and a subscription that follows it, everything said between
 * the two calls would have to be buffered somewhere against a subscriber who may never arrive.
 * One stream, and the turn's first token has a reader before it exists.
 *
 * Ending the stream — the reader hitting stop, or the connection dropping — runs the `finally`
 * below, which aborts the turn. What it had already streamed is kept: `runTurn` writes the
 * partial answer before it rethrows.
 */
export async function* runTurnEvents(args: TurnArgs): AsyncGenerator<TurnEvent> {
  const session = await getSession(args.sessionId);
  if (!session) throw new Error("session not found");

  const controller = new AbortController();
  const queue: StreamEvent[] = [];
  let wake: (() => void) | null = null;
  let done = false;

  const push = (event: StreamEvent) => {
    queue.push(event);
    wake?.();
    wake = null;
  };

  const turn = runTurn({
    session,
    prompt: args.prompt,
    model: args.model ?? undefined,
    onEvent: push,
    signal: controller.signal,
  })
    .catch((error: unknown) => {
      // A turn the reader stopped is not a failure, and the reader already knows.
      if (controller.signal.aborted) return;
      push({ type: "error", message: error instanceof Error ? error.message : String(error) });
    })
    .finally(() => {
      done = true;
      wake?.();
      wake = null;
    });

  let seq = 0;
  try {
    while (true) {
      while (queue.length) yield flatten(queue.shift() as StreamEvent, ++seq);
      if (done) return;
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
    }
  } finally {
    controller.abort();
    await turn;
  }
}
