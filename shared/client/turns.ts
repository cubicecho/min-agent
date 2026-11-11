import type { StreamEvent, TurnStats } from "../types.ts";
import { applyEvent, type LivePart } from "./live.ts";

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
  const listeners = new Set<() => void>();
  let scheduled = false;

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
      for (const event of events) {
        parts = applyEvent(parts, event);
        if (event.type === "stats") {
          stats = event.stats;
        }
        if (event.type === "error") {
          failure = event.message;
        }
      }
      turns.set(id, { ...turn, parts, stats, failure });
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
      const failure = turns.get(id)?.failure ?? null;
      write(id, failure ? { ...IDLE_TURN, failure } : null);
    },
  };
}

export type TurnStore = ReturnType<typeof createTurnStore>;
