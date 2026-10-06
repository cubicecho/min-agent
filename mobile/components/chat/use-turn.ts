import { messageText, turnStart } from "@shared/client/transcript.ts";
import { useLiveParts } from "@shared/client/use-live-parts.ts";
import { messageOf } from "@shared/errors.ts";
import type { TurnStats } from "@shared/types.ts";
import { skipToken, useQuery, useQueryClient } from "@tanstack/react-query";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, streamTurn } from "@/lib/client.ts";
import { invalidateSession, queryKeys } from "@/lib/queries.ts";
import type { Speaker } from "@/lib/voice.ts";

/** What a chat pane hands the turn it runs. */
export interface TurnOptions {
  /** The chat the route names. None on the empty pane, which starts its own. */
  sessionId?: string;
  /** The model to run on where neither the reader nor the session has picked one. */
  defaultModel: string;
  /** Whether a finished answer reads itself aloud. */
  speakReplies: boolean;
  draft: string;
  setDraft: (text: string) => void;
  speech: Pick<Speaker, "speak" | "stop">;
  /** A turn has gone out. */
  onStart: () => void;
  /** The route moved to another chat, and whatever the pane holds for this one is stale. */
  onLeave: () => void;
  /** A settled turn's answer is being read aloud, as the stored message at this index. */
  onRead: (index: number) => void;
}

/**
 * One chat's turn: sending it, showing it while it streams, settling it into the stored
 * transcript, and the two ways of taking a stored turn back.
 */
export function useTurn({
  sessionId,
  defaultModel,
  speakReplies,
  draft,
  setDraft,
  speech,
  onStart,
  onLeave,
  onRead,
}: TurnOptions) {
  const router = useRouter();
  const queryClient = useQueryClient();

  // A chat started from the empty pane has an id before it has a route: the turn is
  // already streaming into this component, and navigating mid-stream would unmount it and
  // drop the output on the floor. The address bar catches up when the turn ends.
  const [created, setCreated] = useState<string | null>(null);
  const activeId = sessionId ?? created;

  const session = useQuery({
    queryKey: queryKeys.session(activeId),
    queryFn: activeId ? () => api.session(activeId) : skipToken,
  });

  const [model, setModel] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const { parts: live, push: pushLive, reset: resetLive } = useLiveParts();
  const [turnStats, setTurnStats] = useState<TurnStats | null>(null);
  const [startedAt, setStartedAt] = useState(0);
  const [failure, setFailure] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  /**
   * Which chat is on screen, readable from a stream's callbacks — they outlive the render
   * that started them, and a turn must only paint the conversation it belongs to.
   */
  const showing = useRef(activeId);
  showing.current = activeId;
  /**
   * How long the stored transcript was when this turn was sent. The server writes the question
   * down before it asks the model anything, so a transcript that has grown past this already
   * has it — and the optimistic copy below would be the same question twice, one above the
   * other, for as long as settling takes.
   */
  const asked = useRef(0);

  const activeModel = model || session.data?.model || defaultModel;
  const stored = session.data?.messages ?? [];
  /** The question in flight, for as long as the stored transcript is still without it. */
  const question = pending && stored.length <= asked.current ? pending : null;

  /**
   * Everything in this pane belongs to one conversation, and the pane outlives them: the
   * router keeps `/chat/[id]` mounted and swaps its parameter, so without this the last
   * chat's turn — its live parts, its unsent question, its stats, its half-typed reply —
   * would still be on screen under the next one. A turn already streaming is left alone to
   * finish into the session that asked for it; `send` below drops what arrives for a chat
   * that is no longer the one being looked at.
   *
   * The route rather than `activeId` is the trigger, because the empty pane holds its own
   * new chat before the address bar knows about it, and that is not a switch.
   */
  const route = useRef(sessionId);
  // biome-ignore lint/correctness/useExhaustiveDependencies: changing chat is the trigger.
  useEffect(() => {
    if (route.current === sessionId) {
      return;
    }
    route.current = sessionId;
    setCreated(null);
    setPending(null);
    setDraft("");
    setModel("");
    setTurnStats(null);
    setStartedAt(0);
    setFailure(null);
    onLeave();
    resetLive();
    speech.stop();
  }, [sessionId]);

  /**
   * The empty pane keeps the chat it started until the reader leaves it — the turn is
   * streaming into this component, and the route only catches up when it ends. Leaving is
   * what makes it somebody else's: coming back here is asking for an empty pane, not for
   * the conversation that was started from it last time.
   */
  useFocusEffect(
    useCallback(() => () => setCreated((held) => (sessionId ? held : null)), [sessionId]),
  );

  /**
   * Puts the window back on the stored session and drops the optimistic bubbles — the refetch
   * first, or the turn blinks out of the window for a frame while the stored session is on its
   * way back.
   *
   * This runs on `done` rather than on the end of the stream: a turn that writes follow-up
   * chips holds its stream open for the second they take, and the composer has no business
   * waiting on that. Whichever arrives first settles the turn; `finish` makes the other a
   * no-op, and a turn whose chat has since been left off screen only refreshes what it wrote.
   */
  async function settle(id: string, read = false) {
    await invalidateSession(queryClient, id);
    // Tidying up after a turn the reader has already walked away from would take the
    // composer and the transcript of whatever they walked to with it.
    if (showing.current !== id) {
      return;
    }
    setPending(null);
    resetLive();
    setTurnStats(null);
    // A reply that read itself aloud is still the one being read, and the button on it is
    // the only way to stop it. Claimed here rather than at `done` because the index is the
    // one in the stored transcript, which is what the refetch above has just settled — a
    // turn with tool calls in it has more messages than the answer alone.
    if (read) {
      const messages =
        queryClient.getQueryData<{ messages: { role: string }[] }>(queryKeys.session(id))
          ?.messages ?? [];
      const last = messages.findLastIndex((message) => message.role === "assistant");
      if (last !== -1) {
        onRead(last);
      }
    }
  }

  async function send(text?: string) {
    const prompt = (text ?? draft).trim();
    if (!prompt || pending) {
      return;
    }

    let id = activeId;
    if (!id) {
      const fresh = await api.createSession();
      id = fresh.id;
      setCreated(id);
      await queryClient.invalidateQueries({ queryKey: queryKeys.sessions });
    }
    // Narrowed once, for the callbacks below: `id` is a `let` and they outlive this line.
    const turnId = id;
    // A chat started from the empty pane is adopted here rather than a render later: the
    // first tokens can land before `created` has been through React, and they belong on
    // screen, not to the chat this pane was showing a moment ago.
    showing.current = turnId;

    // Read out of the cache rather than off `session.data`: retrying reads the transcript back
    // shorter first, and this render may not have caught up with that yet.
    asked.current =
      queryClient.getQueryData<{ messages: unknown[] }>(queryKeys.session(turnId))?.messages
        .length ?? 0;

    // A chip sends its own text; anything half-typed in the box is left alone.
    if (!text) {
      setDraft("");
    }
    setPending(prompt);
    speech.stop();
    resetLive();
    setTurnStats(null);
    setFailure(null);
    setStartedAt(Date.now());
    onStart();
    /**
     * The answer as it arrives, kept only so that it can be read aloud when it is finished.
     * Speaking the deltas as they land would stutter, and speaking the stored transcript
     * instead would read the whole conversation back every turn.
     */
    let answer = "";
    // Both ends of the stream settle it and either may be first; per turn, so a turn left
    // running in another chat cannot settle this one on its behalf.
    let settled = false;
    // Whether this turn's answer started reading itself, so settling can hand the message it
    // is reading to the button that has to stop it.
    let read = false;
    const finish = async () => {
      if (settled) {
        return;
      }
      settled = true;
      await settle(turnId, read);
    };
    // Held rather than read back off the ref: sending in another chat replaces what `abort`
    // points at, and this turn still has to know whether it was this one that was stopped.
    const controller = new AbortController();
    abort.current = controller;

    try {
      await streamTurn({
        sessionId: turnId,
        prompt,
        model: activeModel,
        signal: controller.signal,
        onEvent: (event) => {
          // Chips are written to the session after the answer; read them back from there
          // rather than growing a second path for the same data. This one holds whether or
          // not the chat is still on screen: it is the stored transcript being refreshed.
          if (event.type === "followups") {
            void queryClient.invalidateQueries({ queryKey: queryKeys.session(turnId) });
          }
          // The same goes for a hook that reports after the answer, once the turn has settled
          // and there is no live tail left to put it on: the stored turn has it.
          if (event.type === "hook" && settled) {
            void queryClient.invalidateQueries({ queryKey: queryKeys.session(turnId) });
            return;
          }
          if (event.type === "done") {
            if (speakReplies && showing.current === turnId) {
              read = speech.speak(answer);
            }
            void finish();
          }
          if (event.type === "text_delta") {
            answer += event.text;
          }
          // The rest is this turn showing itself, and it only has somewhere to show while
          // the chat it belongs to is the one being looked at. Switch away and the turn
          // runs on into its own session; the transcript has it when you come back.
          if (showing.current !== turnId) {
            return;
          }
          pushLive(event);
          if (event.type === "stats") {
            setTurnStats(event.stats);
          }
          if (event.type === "error") {
            setFailure(event.message);
          }
        },
      });
    } catch (error) {
      const isStillShown = controller.signal.aborted === false && showing.current === turnId;
      if (isStillShown) {
        setFailure(messageOf(error));
      }
    } finally {
      if (abort.current === controller) {
        abort.current = null;
      }
      await finish();
      // The address bar catches up once the stream is really over, not on `done`: moving the
      // route mid-stream would remount this pane and drop what is still arriving on it.
      if (!sessionId) {
        router.replace(`/chat/${turnId}`);
      }
    }
  }

  /**
   * Forgets the transcript from `index` on, and reads back what is left.
   *
   * Both of the things below are this move plus one more: what makes retrying and editing
   * different is only what happens after the cut.
   */
  async function rewind(index: number) {
    if (!activeId) {
      return;
    }
    await api.truncateSession(activeId, index);
    await invalidateSession(queryClient, activeId);
  }

  /**
   * Answers again. The cut goes back to the question, not to the reply: a turn is the
   * question plus everything the model did about it, and the server re-sends the prompt
   * itself, so leaving the old copy in place would ask it twice.
   */
  async function retry(index: number) {
    const messages = session.data?.messages ?? [];
    const start = turnStart(messages, index);
    if (start < 0 || pending) {
      return;
    }
    const prompt = messageText(messages[start]);
    await rewind(start);
    await send(prompt);
  }

  /** Puts a question back in the composer, with everything it led to forgotten. */
  async function edit(index: number) {
    const messages = session.data?.messages ?? [];
    const message = messages[index];
    if (!message || pending) {
      return;
    }
    await rewind(index);
    setDraft(messageText(message));
  }

  return {
    activeId,
    session,
    activeModel,
    setModel,
    /** The prompt of the turn in flight. */
    pending,
    question,
    live,
    turnStats,
    startedAt,
    failure,
    send,
    stop: () => abort.current?.abort(),
    retry,
    edit,
  };
}
