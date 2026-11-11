import { randomUUID } from "node:crypto";
import type { ElicitRequestParams, ElicitResult } from "@cubicecho/agent-mcp-pool";
import { ELICITATION_DEFAULTS } from "../shared/defaults.ts";
import {
  contentError,
  type Elicitation,
  type ElicitationAction,
  type ElicitationContent,
} from "../shared/elicitation.ts";
import type { StreamEvent } from "../shared/types.ts";
import { UserError } from "./errors.ts";

/**
 * The questions MCP servers are waiting on a person to answer, by the id the chat was sent.
 *
 * A question is asked on a turn's stream and answered through a mutation, so the two ends meet
 * here: `ask` puts the question on the stream and waits, and `answer` is what the mutation
 * calls. The turn is the conversation's own, so a question goes to the chat whose turn made the
 * call — the pool attributes it to the call, and the call to the turn that is waiting on it.
 */

/** Who is asking, and on behalf of which call. */
export interface Asking {
  /** The chat whose turn made the call, which is the only one that may answer. */
  sessionId: string;
  /** The call's id, for the chat to put the question under its card. */
  toolUseId: string;
  serverId: string;
  /** The name the server is shown under. */
  server: string;
}

/** An answer as the mutation hands it in. */
export interface Answer {
  action: ElicitationAction;
  content?: ElicitationContent | null;
}

interface Waiting {
  sessionId: string;
  schema: unknown;
  settle: (result: ElicitResult) => void;
}

const CANCEL: ElicitResult = { action: "cancel" };

/**
 * Builds the registry one process asks its questions through.
 *
 * @param waitMs - How long a person has to answer before the question is put away as `cancel`.
 *   A turn that nobody is looking at would otherwise hold its call open for good.
 */
export function createElicitations({ waitMs = ELICITATION_DEFAULTS.answerWaitMs } = {}) {
  const waiting = new Map<string, Waiting>();

  /**
   * Puts a question in front of the chat and waits for the person.
   *
   * Settles exactly once: the person's answer, or `cancel` when `signal` aborts — the call that
   * asked has ended, the server has given up, or the turn was stopped — or when the wait runs
   * out. However it settles, the chat is told the question is gone, so a form whose call has
   * already finished does not sit there asking.
   *
   * @param asking - Who is asking, for which call.
   * @param params - The request as the server sent it.
   * @param signal - The pool's, which aborts when nothing is waiting on the answer any more.
   * @param emit - The turn's stream.
   * @returns What to answer the server.
   */
  function ask(
    asking: Asking,
    params: ElicitRequestParams,
    signal: AbortSignal,
    emit: (event: StreamEvent) => void,
  ): Promise<ElicitResult> {
    // Only form mode is declared, so a well-behaved server never sends a link; one that does is
    // asking for something this chat cannot show.
    if (params.mode === "url" || signal.aborted) {
      return Promise.resolve(params.mode === "url" ? { action: "decline" } : CANCEL);
    }
    const elicitation: Elicitation = {
      id: randomUUID(),
      toolUseId: asking.toolUseId,
      serverId: asking.serverId,
      server: asking.server,
      message: params.message,
      schema: params.requestedSchema,
    };
    const { id } = elicitation;

    return new Promise<ElicitResult>((resolve) => {
      const timer = setTimeout(() => settle(CANCEL), waitMs);
      const onAbort = () => settle(CANCEL);
      function settle(result: ElicitResult) {
        if (!waiting.delete(id)) {
          return;
        }
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
        emit({ type: "elicitation_end", id, action: result.action });
        resolve(result);
      }
      waiting.set(id, { sessionId: asking.sessionId, schema: params.requestedSchema, settle });
      signal.addEventListener("abort", onAbort, { once: true });
      emit({ type: "elicitation", elicitation });
    });
  }

  /**
   * Answers a question the chat was asked.
   *
   * @param sessionId - The chat answering. A question is only that chat's to answer.
   * @param id - The question's id, from its `elicitation` event.
   * @param answer - What the person said.
   * @returns Whether the question was still waiting. `false` for one already answered or put
   *   away, which is not an error: the call may have finished while the person was typing.
   * @throws When an `accept` carries content the question did not ask for.
   */
  function answer(sessionId: string, id: string, { action, content }: Answer): boolean {
    const question = waiting.get(id);
    if (!question || question.sessionId !== sessionId) {
      return false;
    }
    if (action !== "accept") {
      question.settle({ action });
      return true;
    }
    const answered = content ?? {};
    const error = contentError(question.schema, answered);
    if (error) {
      throw new UserError(error);
    }
    question.settle({ action, content: answered });
    return true;
  }

  return {
    ask,
    answer,
    /** How many questions are waiting, for a test to see one land. */
    waiting: () => waiting.size,
  };
}

export type Elicitations = ReturnType<typeof createElicitations>;
