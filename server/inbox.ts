/**
 * What a person typed into a chat while its turn was running, waiting for that turn to take it.
 *
 * A message is posted through `steerTurn` and taken by the running loop at its next boundary —
 * once the calls in flight have answered, before the next request — so the two ends meet here, as
 * a tool's question and its answer meet in `elicitations.ts`. A chat whose turn can no longer take
 * input has no inbox, and a post to it is refused: the client sends it as a turn of its own.
 */

/** What several messages taken at one boundary are joined by: some templates refuse two user turns in a row. */
const JOINED_BY = "\n\n";

/** One message posted to a running turn, under the id the client gave it. */
export interface Steer {
  id: string;
  text: string;
}

/** What a turn takes at one boundary: everything posted since the last, as one message. */
export interface Taken {
  /** The ids of the messages taken, in the order they were posted. */
  ids: string[];
  text: string;
}

/** One running turn's end of the inbox. */
export interface TurnInbox {
  /** Everything posted since the last take, or `undefined` when nothing was. */
  take: () => Taken | undefined;
  /** Refuses every later post. What was never taken stays the client's to send. */
  close: () => void;
}

/**
 * Builds the inbox one process steers its turns through, by chat.
 *
 * @returns `open`, which a turn calls once its loop can take input, and `post`, which the
 * mutation calls.
 */
export function createInbox() {
  const waiting = new Map<string, Steer[]>();

  /**
   * Opens a chat's inbox for the turn about to run in it.
   *
   * @param sessionId - The chat the turn is running in.
   * @returns The turn's end: what it takes from, and how it closes.
   */
  function open(sessionId: string): TurnInbox {
    const held: Steer[] = [];
    waiting.set(sessionId, held);
    return {
      take: () => {
        if (held.length === 0) {
          return undefined;
        }
        const taken = held.splice(0);
        return {
          ids: taken.map(({ id }) => id),
          text: taken.map(({ text }) => text).join(JOINED_BY),
        };
      },
      close: () => {
        // A later turn in the same chat may have opened its own already.
        if (waiting.get(sessionId) === held) {
          waiting.delete(sessionId);
        }
      },
    };
  }

  /**
   * Hands a message to the turn running in a chat.
   *
   * @param sessionId - The chat it was typed in.
   * @param steer - The message, under the client's id for it.
   * @returns `false` when no turn there can take it any more.
   */
  function post(sessionId: string, steer: Steer): boolean {
    const held = waiting.get(sessionId);
    if (!held) {
      return false;
    }
    held.push(steer);
    return true;
  }

  return { open, post };
}

/** The process's inbox, as `createInbox` builds it. */
export type Inbox = ReturnType<typeof createInbox>;
