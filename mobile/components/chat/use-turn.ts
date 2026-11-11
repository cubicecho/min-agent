import { messageText, turnStart } from "@shared/client/transcript.ts";
import { Delivery } from "@shared/client/turns.ts";
import type { ElicitationAction, ElicitationContent } from "@shared/elicitation.ts";
import { messageOf } from "@shared/errors.ts";
import { skipToken, useQuery, useQueryClient } from "@tanstack/react-query";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, streamTurn } from "@/lib/client.ts";
import { invalidateSession, queryKeys } from "@/lib/queries.ts";
import { turns, useChatTurn, useUnsent } from "@/lib/turns.ts";
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
  const turn = useChatTurn(activeId);
  const unsent = useUnsent(activeId);
  const pending = turn.prompt;
  /**
   * Which chat is on screen, readable from a stream's callbacks — they outlive the render
   * that started them, and only the chat being looked at should read itself aloud.
   */
  const showing = useRef(activeId);
  showing.current = activeId;
  /**
   * Whether this pane is still on screen at all. On a narrow window the chat screen is dropped
   * when the reader goes back to the list, and its stream runs on with `showing` still naming
   * the chat it was on.
   */
  const mounted = useRef(true);
  /** Whether the chat a stream belongs to is the one the reader is looking at. */
  const isShowing = (id: string) => mounted.current && showing.current === id;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const activeModel = model || session.data?.model || defaultModel;
  const stored = session.data?.messages ?? [];
  /**
   * The question in flight, for as long as the stored transcript is still without it. The
   * server writes the question down before it asks the model anything, so a transcript that
   * has grown past `asked` already has it — and the optimistic copy would be the same
   * question twice, one above the other, for as long as settling takes.
   */
  const question = pending && stored.length <= turn.asked ? pending : null;

  /**
   * The pane outlives the conversations it shows: the router keeps `/chat/[id]` mounted and
   * swaps its parameter, so without this the last chat's half-typed reply, model pick and
   * read-aloud would still be on screen under the next one. The turn itself is not reset:
   * it is kept per chat in `turns`, so the next chat shows its own and a turn already
   * streaming runs on into the session that asked for it, still showing when you come back.
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
    setDraft("");
    setModel("");
    onLeave();
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
   * no-op.
   */
  async function settle(id: string, read = false) {
    await invalidateSession(queryClient, id);
    turns.end(id);
    if (!isShowing(id)) {
      return;
    }
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

  /**
   * Sends what is typed, or `text`: as a turn, or into this chat's turn where one is running,
   * which takes it once the calls in flight have answered.
   *
   * @param [text] - What a chip or the microphone sends. Absent sends the box.
   */
  async function send(text?: string) {
    const prompt = (text ?? draft).trim();
    if (!prompt) {
      return;
    }
    // A chip sends its own text; anything half-typed in the box is left alone.
    const clearsBox = text === undefined;
    if (pending && activeId) {
      if (clearsBox) {
        setDraft("");
      }
      await steer(activeId, prompt);
      return;
    }

    let id = activeId;
    if (!id) {
      const fresh = await api.createSession();
      id = fresh.id;
      setCreated(id);
      await queryClient.invalidateQueries({ queryKey: queryKeys.sessions });
    }
    // A chat started from the empty pane is adopted here rather than a render later, so a
    // reply that finishes before `created` has been through React still reads itself aloud.
    showing.current = id;
    if (clearsBox) {
      setDraft("");
    }
    speech.stop();
    await run(id, prompt);
  }

  /**
   * Sends what is typed as a turn of its own once this chat's running turn has finished, or now
   * where none is running.
   */
  function queue() {
    const prompt = draft.trim();
    const isRunning = Boolean(pending && activeId);
    if (!prompt || isRunning === false || !activeId) {
      void send();
      return;
    }
    setDraft("");
    turns.hold(activeId, prompt, Delivery.Queue);
  }

  /**
   * Hands what was typed to the chat's running turn, and queues it instead where the turn can no
   * longer take it.
   *
   * @param id - The chat whose turn is running.
   * @param text - What was typed.
   */
  async function steer(id: string, text: string) {
    const itemId = turns.hold(id, text, Delivery.Steer);
    const isTaken = await api.steerTurn(id, itemId, text).catch(() => false);
    if (isTaken === false) {
      turns.queue(id, itemId);
    }
  }

  /**
   * Runs one turn in a chat, from sending it to settling it, then sends the next message queued
   * behind it. A turn that was stopped or failed leaves the queue where it is.
   *
   * @param turnId - The chat.
   * @param prompt - The question.
   */
  async function run(turnId: string, prompt: string) {
    const controller = new AbortController();
    turns.start(turnId, {
      prompt,
      // Read out of the cache rather than off `session.data`: retrying reads the transcript
      // back shorter first, and this render may not have caught up with that yet.
      asked:
        queryClient.getQueryData<{ messages: unknown[] }>(queryKeys.session(turnId))?.messages
          .length ?? 0,
      controller,
    });
    if (isShowing(turnId)) {
      onStart();
    }
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
    // Only a turn that answered sends what was queued behind it.
    let answered = false;
    const finish = async () => {
      if (settled) {
        return;
      }
      settled = true;
      await settle(turnId, read);
    };
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
            answered = true;
            if (speakReplies && isShowing(turnId)) {
              read = speech.speak(answer);
            }
            void finish();
          }
          if (event.type === "text_delta") {
            answer += event.text;
          }
          // What was typed mid-turn is answered after it: only that answer is read out.
          if (event.type === "steer") {
            answer = "";
          }
          // Kept under the chat it belongs to whether or not that chat is on screen: switch
          // away and back mid-turn, and the turn is still there, still going. That includes a
          // question a tool's server is waiting on: it stays open, and its form is there to
          // answer when the reader comes back. Nothing is left hanging for good — the server
          // puts a question away itself after `ELICITATION_DEFAULTS.answerWaitMs`, and when the
          // stream drops.
          turns.push(turnId, event);
        },
      });
    } catch (error) {
      if (controller.signal.aborted === false) {
        turns.fail(turnId, messageOf(error));
      }
    } finally {
      await finish();
      // The address bar catches up once the stream is really over, not on `done`: moving the
      // route mid-stream would remount this pane under the reader's hands. Only if the reader
      // is still on it, though — one who has walked to another chat stays there.
      if (!sessionId && isShowing(turnId)) {
        router.replace(`/chat/${turnId}`);
      }
    }
    const isClean = answered && controller.signal.aborted === false;
    const next = isClean
      ? turns.unsent(turnId).find((item) => item.delivery === Delivery.Queue)
      : undefined;
    if (next) {
      turns.release(turnId, [next.id]);
      await run(turnId, next.text);
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

  /**
   * Answers a question a tool's server asked in the live turn. `false` for one that is no longer
   * waiting; its `elicitation_end` is on the way.
   *
   * Answered as the chat on screen, because that is the only chat whose questions are drawn
   * here — and the server only takes an answer from the chat whose turn asked.
   */
  async function answerQuestion(
    id: string,
    action: ElicitationAction,
    content?: ElicitationContent,
  ) {
    if (!activeId) {
      return false;
    }
    return api.answerElicitation(activeId, id, action, content);
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

  /**
   * Puts text back in the box after what is already typed there.
   *
   * @param texts - What goes back, oldest first.
   */
  function restore(texts: readonly string[]) {
    setDraft([draft.trim(), ...texts].filter((text) => text !== "").join("\n\n"));
  }

  /** Stops this chat's turn, not whichever was sent last, and puts what waited on it back in the box. */
  function stop() {
    turn.controller?.abort();
    if (!activeId || unsent.length === 0) {
      return;
    }
    turns.release(
      activeId,
      unsent.map((item) => item.id),
    );
    restore(unsent.map((item) => item.text));
  }

  /**
   * Takes a queued message back into the box, to change or send another way.
   *
   * @param itemId - Its id in the unsent list.
   */
  function pullBack(itemId: string) {
    const item = unsent.find((each) => each.id === itemId);
    if (!activeId || !item) {
      return;
    }
    turns.release(activeId, [itemId]);
    restore([item.text]);
  }

  /**
   * Throws a queued message away.
   *
   * @param itemId - Its id in the unsent list.
   */
  function discard(itemId: string) {
    if (activeId) {
      turns.release(activeId, [itemId]);
    }
  }

  return {
    activeId,
    session,
    activeModel,
    setModel,
    /** The prompt of the turn in flight. */
    pending,
    question,
    live: turn.parts,
    turnStats: turn.stats,
    startedAt: turn.startedAt,
    failure: turn.failure,
    send,
    queue,
    /** What was typed while this chat's turn ran and is not in the transcript yet. */
    unsent,
    stop,
    pullBack,
    discard,
    answerQuestion,
    retry,
    edit,
  };
}
