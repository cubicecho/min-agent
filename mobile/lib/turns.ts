import {
  createTurnStore,
  type TurnActivity,
  type TurnState,
  turnActivity,
  type Unsent,
} from "@shared/client/turns.ts";
import { useSyncExternalStore } from "react";

/**
 * Every chat's turn, for the life of the app rather than of a pane: a turn left running in
 * one chat is still running, and still showing, when the reader comes back to it.
 */
export const turns = createTurnStore();

/** This chat's turn, wherever it was sent from and whether or not this pane saw it start. */
export function useChatTurn(id: string | null | undefined): TurnState {
  return useSyncExternalStore(turns.subscribe, () => turns.get(id));
}

/** What was typed in this chat while its turn ran and has not gone yet, oldest first. */
export function useUnsent(id: string | null | undefined): readonly Unsent[] {
  return useSyncExternalStore(turns.subscribe, () => turns.unsent(id));
}

/**
 * What this chat is doing right now. A word rather than the turn, so a row in the list redraws
 * when its chat starts, stops or asks something, not on every token the turn streams.
 */
export function useTurnActivity(id: string): TurnActivity {
  return useSyncExternalStore(turns.subscribe, () => turnActivity(turns.get(id)));
}
