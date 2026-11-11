import type { StreamEvent, TurnStats } from "../types.ts";
import { applyEvent, type LivePart, waitingQuestions } from "./live.ts";

/** One chat's turn, as the pane showing that chat draws it. */
export interface TurnState {
  /** The prompt of the turn in flight. Null once it has settled. */
  prompt: string | null;
  /** How long the stored transcript was when the turn was sent. */
  asked: number;
  startedAt: number;
  /** The in-flight answer, in arrival order. */
  parts: LivePart[];
  /** The server's count for this turn, which lands just before `done`. */
  stats: TurnStats | null;
  /** Why the last turn failed. Outlives the turn, until the next one is sent. */
  failure: string | null;
  /** Stops the turn in flight. */
  controller: AbortController | null;
}

export const IDLE_TURN: TurnState = Object.freeze({
  prompt: null,
  asked: 0,
  startedAt: 0,
  parts: [],
  stats: null,
  failure: null,
  controller: null,
});

/**
 * What a chat is doing, as its row in the list says it: nothing, answering, or stopped on a
 * question that only the person can answer — the one state where the turn will not move on
 * until somebody goes back to it.
 */
export type TurnActivity = "idle" | "running" | "waiting";

export function turnActivity(turn: TurnState): TurnActivity {
  if (turn.prompt === null) {
    return "idle";
  }
  return waitingQuestions(turn.parts).length ? "waiting" : "running";
}

/** How something typed while a chat's turn runs is to go. */
export const Delivery = {
  /** Into the running turn, which takes it once the calls in flight have answered. */
  Steer: "steer",
  /** As a turn of its own, once the running one has finished. */
  Queue: "queue",
} as const;
export type Delivery = (typeof Delivery)[keyof typeof Delivery];

/** Something typed while a chat's turn ran, not in the transcript yet. */
export interface Unsent {
  /** The client's own id for it, which the `steer` event names when the turn takes it. */
  id: string;
  text: string;
  delivery: Delivery;
}

const NOTHING_UNSENT: readonly Unsent[] = Object.freeze([]);

/** Runs `flush` once, later. The next animation frame by default; a test hands in its own. */
type Schedule = (flush: () => void) => void;

const nextFrame: Schedule = (flush) => {
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(flush);
  } else {
    setTimeout(flush, 16);
  }
};

/**
 * Every chat's turn, kept outside any one pane.
 *
 * A turn outlives the pane that sent it. On a wide window the pane stays mounted and swaps
 * the chat it shows; on a narrow one the chat screen is dropped when the reader goes back to
 * the list. Either way the stream runs on, so what it has said so far is kept here, under the
 * chat it belongs to. Coming back to a chat that is still answering finds it answering, with
 * the stop button, the meter and everything already said, instead of a pane that looks idle.
 *
 * A fast model sends token deltas far quicker than a screen can show them, so events are
 * queued and folded in together once a frame: a burst of thirty deltas is one render.
 */
export function createTurnStore(schedule: Schedule = nextFrame) {
  const turns = new Map<string, TurnState>();
  const queued = new Map<string, StreamEvent[]>();
  // Kept apart from the turn: a queued message outlives the turn it waited on.
  const unsent = new Map<string, readonly Unsent[]>();
  const listeners = new Set<() => void>();
  let scheduled = false;
  let held = 0;

  const notify = () => {
    for (const listener of listeners) {
      listener();
    }
  };

  const write = (id: string, next: TurnState | null) => {
    if (next) {
      turns.set(id, next);
    } else {
      turns.delete(id);
    }
    notify();
  };

  /** The chat's turn, or `IDLE_TURN`. The same object until something about it changes. */
  const get = (id: string | null | undefined): TurnState =>
    (id ? turns.get(id) : undefined) ?? IDLE_TURN;

  /** What is unsent in the chat, oldest first. The same array until something about it changes. */
  const unsentIn = (id: string | null | undefined): readonly Unsent[] =>
    (id ? unsent.get(id) : undefined) ?? NOTHING_UNSENT;

  const setUnsent = (id: string, next: readonly Unsent[]) => {
    if (next.length) {
      unsent.set(id, next);
    } else {
      unsent.delete(id);
    }
  };

  const flush = () => {
    scheduled = false;
    if (!queued.size) {
      return;
    }
    for (const [id, events] of queued) {
      const turn = turns.get(id);
      if (!turn?.prompt) {
        continue;
      }
      let { parts, stats, failure } = turn;
      const landed = new Set<string>();
      for (const event of events) {
        parts = applyEvent(parts, event);
        if (event.type === "stats") {
          stats = event.stats;
        }
        if (event.type === "error") {
          failure = event.message;
        }
        if (event.type === "steer") {
          for (const landedId of event.ids) {
            landed.add(landedId);
          }
        }
      }
      turns.set(id, { ...turn, parts, stats, failure });
      if (landed.size) {
        setUnsent(
          id,
          unsentIn(id).filter((item) => landed.has(item.id) === false),
        );
      }
    }
    queued.clear();
    notify();
  };

  return {
    get,

    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    /** A turn has gone out for this chat. Whatever the last one left behind is dropped. */
    start(
      id: string,
      turn: { prompt: string; asked: number; controller: AbortController; startedAt?: number },
    ) {
      queued.delete(id);
      write(id, {
        ...IDLE_TURN,
        prompt: turn.prompt,
        asked: turn.asked,
        controller: turn.controller,
        startedAt: turn.startedAt ?? Date.now(),
      });
    },

    /** Something the turn said. Shown on the next frame. */
    push(id: string, event: StreamEvent) {
      const events = queued.get(id);
      if (events) {
        events.push(event);
      } else {
        queued.set(id, [event]);
      }
      if (!scheduled) {
        scheduled = true;
        schedule(flush);
      }
    },

    /** The turn failed in a way the stream could not say itself. */
    fail(id: string, message: string) {
      write(id, { ...get(id), failure: message });
    },

    /**
     * The turn is over and the stored transcript has it. Only a failure is kept, so the chat
     * still says why when the reader comes back to it.
     */
    end(id: string) {
      queued.delete(id);
      // The turn took what it was going to: anything it did not goes as a turn of its own.
      setUnsent(
        id,
        unsentIn(id).map((item) =>
          item.delivery === Delivery.Steer ? { ...item, delivery: Delivery.Queue } : item,
        ),
      );
      const failure = turns.get(id)?.failure ?? null;
      write(id, failure ? { ...IDLE_TURN, failure } : null);
    },

    unsent: unsentIn,

    /**
     * Holds something typed while the chat's turn runs, to go as `delivery` says.
     *
     * @param id - The chat it was typed in.
     * @param text - What was typed.
     * @param delivery - Into the running turn, or as the next one.
     * @returns Its id, which `steerTurn` is handed and its `steer` event names.
     */
    hold(id: string, text: string, delivery: Delivery): string {
      held += 1;
      const item: Unsent = { id: `unsent-${held}`, text, delivery };
      setUnsent(id, [...unsentIn(id), item]);
      notify();
      return item.id;
    },

    /**
     * Sends a held message as the next turn instead: the running one could not take it.
     *
     * @param id - The chat it is waiting in.
     * @param itemId - Its id, as `hold` gave it.
     */
    queue(id: string, itemId: string) {
      const isHeld = unsentIn(id).some((item) => item.id === itemId);
      if (isHeld === false) {
        return;
      }
      setUnsent(
        id,
        unsentIn(id).map((item) =>
          item.id === itemId ? { ...item, delivery: Delivery.Queue } : item,
        ),
      );
      notify();
    },

    /**
     * Lets go of held messages: sent, pulled back into the box, or thrown away.
     *
     * @param id - The chat they are waiting in.
     * @param itemIds - Their ids, as `hold` gave them.
     */
    release(id: string, itemIds: readonly string[]) {
      const isAnyHeld = unsentIn(id).some((item) => itemIds.includes(item.id));
      if (isAnyHeld === false) {
        return;
      }
      setUnsent(
        id,
        unsentIn(id).filter((item) => itemIds.includes(item.id) === false),
      );
      notify();
    },
  };
}

export type TurnStore = ReturnType<typeof createTurnStore>;
