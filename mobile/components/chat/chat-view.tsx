import { type LivePart, liveCharCount } from "@shared/client/live.ts";
import { messageText, turnStart } from "@shared/client/transcript.ts";
import {
  type BreakdownPart,
  breakdownRows,
  contextFill,
  costOf,
  formatDuration,
  formatRate,
  formatTokens,
  formatUsage,
  latestStats,
  usageDetail,
} from "@shared/client/usage.ts";
import { useLiveParts } from "@shared/client/use-live-parts.ts";
import type { LlmConfig, TokenUsage, TurnStats } from "@shared/types.ts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Platform,
  ScrollView,
  Text,
  View,
} from "react-native";
import { ActionButton } from "@/components/action-button";
import { ArrowDown, BookOpen, MessageSquare, Mic, Send } from "@/components/app/app-icons";
import { MessageView } from "@/components/chat/message-view.tsx";
import { PromptPicker, useMcpPrompts } from "@/components/chat/prompt-picker.tsx";
import { SessionsPanel, SessionsScreen } from "@/components/chat/session-list.tsx";
import { DescriptionList, PropertyRow } from "@/components/description-list";
import { DialogLayout } from "@/components/dialog-layout";
import { HeaderContentFooter } from "@/components/header-content-footer";
import { OptionSelect } from "@/components/option-select";
import { EmptyState } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { SettingsLink } from "@/components/settings/link.tsx";
import { SplitLayout } from "@/components/split-layout";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Square } from "@/components/ui/icons";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { api, streamTurn } from "@/lib/client.ts";
import { useWide } from "@/lib/layout.ts";
import { cn } from "@/lib/utils.ts";
import { useDictation, useSpeech } from "@/lib/voice.ts";
import { useVoiceSettings } from "@/lib/voice-settings.ts";

/**
 * Chats, in the two arrangements the window has room for.
 *
 * Wide, it is the desktop shape: the chat takes the space and the sessions sit in a panel on
 * the right, so switching between them never leaves the conversation. Narrow, there is
 * only room for one at a time, so the list and the chat are the separate screens they
 * have always been — the list at `/`, a conversation at `/chat/[id]`.
 *
 * Both routes render this, which is what lets the panel stay put while the route under it
 * changes.
 */
export function ChatsView({ sessionId }: { sessionId?: string }) {
  const wide = useWide();

  if (!wide) return sessionId ? <ChatPane sessionId={sessionId} /> : <SessionsScreen />;

  return (
    <SplitLayout
      className="h-full flex-1 bg-background"
      // The panel is a rail with a width of its own; the chat has whatever is left.
      secondWidth="auto"
      stackBelow="never"
      divider="none"
      firstSlot={<ChatPane sessionId={sessionId} />}
      secondSlot={<SessionsPanel activeId={sessionId} />}
    />
  );
}

function ChatPane({ sessionId }: { sessionId?: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();

  // A chat started from the empty pane has an id before it has a route: the turn is
  // already streaming into this component, and navigating mid-stream would unmount it and
  // drop the output on the floor. The address bar catches up when the turn ends.
  const [created, setCreated] = useState<string | null>(null);
  const activeId = sessionId ?? created;

  const session = useQuery({
    queryKey: ["session", activeId],
    queryFn: () => api.session(activeId as string),
    enabled: Boolean(activeId),
  });
  const config = useQuery({ queryKey: ["config"], queryFn: api.config });
  const models = useQuery({ queryKey: ["models"], queryFn: api.models });

  const [model, setModel] = useState("");
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const { parts: live, push: pushLive, reset: resetLive } = useLiveParts();
  const [turnStats, setTurnStats] = useState<TurnStats | null>(null);
  const [startedAt, setStartedAt] = useState(0);
  const [failure, setFailure] = useState<string | null>(null);
  /** Which stored reply is being read aloud, so its button can offer to stop instead. */
  const [spoken, setSpoken] = useState<number | null>(null);
  // Scrolling follows the turn only while the reader is already at the bottom. Reading back
  // through the transcript mid-turn used to be impossible: every delta yanked the view down.
  const [pinned, setPinned] = useState(true);
  const [tokensOpen, setTokensOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const prompts = useMcpPrompts();
  const abort = useRef<AbortController | null>(null);
  const scroller = useRef<ScrollView>(null);
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

  const speech = useSpeech({ model: config.data?.ttsModel ?? "" });
  const voiceSettings = useVoiceSettings();
  /**
   * The draft as it stands right now, rather than as this render saw it. Dictation delivers
   * its text and ends the session in the same tick, so the handler that sends has to read
   * what the handler that typed just wrote — which React has not rendered yet.
   */
  const draftNow = useRef(draft);
  draftNow.current = draft;

  const dictation = useDictation({
    model: config.data?.sttModel ?? "",
    // Dictation adds to the box rather than replacing it: what is already typed was typed on
    // purpose, and a message is often said in more than one go — a press to think between two
    // sentences should leave you with both of them.
    onText: (text) => {
      const next = draftNow.current.trim() ? `${draftNow.current.trim()} ${text}` : text;
      draftNow.current = next;
      setDraft(next);
    },
    // Hands free. The microphone said it was finished, so the box goes as it stands — emptied
    // here rather than by `send`, which leaves a prompt it was handed alone.
    onDone: voiceSettings.autoSend
      ? () => {
          const spokenDraft = draftNow.current;
          draftNow.current = "";
          setDraft("");
          void send(spokenDraft);
        }
      : undefined,
  });

  // Playback ends by itself, and the button on the message it belongs to has to notice.
  useEffect(() => {
    if (!speech.speaking) setSpoken(null);
  }, [speech.speaking]);

  const activeModel = model || session.data?.model || config.data?.model || "";
  // While a turn streams, the server's count lands just before "done"; once the session is
  // refetched the stored running total takes over.
  const shownUsage = pending ? turnStats : (session.data?.usage ?? null);
  const stored = session.data?.messages ?? [];
  /** The question in flight, for as long as the stored transcript is still without it. */
  const question = pending && stored.length <= asked.current ? pending : null;
  // The window is only measured at the end of a turn, so during one we keep showing the
  // last known fill rather than blanking the meter out.
  const recent = turnStats ?? latestStats(stored);
  const fill = contextFill(recent);

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
    if (route.current === sessionId) return;
    route.current = sessionId;
    setCreated(null);
    setPending(null);
    setDraft("");
    setModel("");
    setTurnStats(null);
    setStartedAt(0);
    setFailure(null);
    setSpoken(null);
    setPinned(true);
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

  /** A hundred pixels of slack, so a stray flick does not count as leaving the bottom. */
  function onScroll({ nativeEvent }: NativeSyntheticEvent<NativeScrollEvent>) {
    const { contentSize, contentOffset, layoutMeasurement } = nativeEvent;
    const now = contentSize.height - contentOffset.y - layoutMeasurement.height < 100;
    // Bail out when nothing changed: scrolling fires many times a second and every real state
    // write here would re-render the transcript.
    setPinned((was) => (was === now ? was : now));
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: these deps are the scroll triggers.
  useEffect(() => {
    if (!pinned) return;
    // Animation cannot keep up with a stream, and trying looks like stutter; during a turn the
    // view is simply moved.
    scroller.current?.scrollToEnd({ animated: !pending });
  }, [session.data?.messages.length, live, pending, pinned]);

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
    await queryClient.invalidateQueries({ queryKey: ["session", id] });
    await queryClient.invalidateQueries({ queryKey: ["sessions"] });
    // Tidying up after a turn the reader has already walked away from would take the
    // composer and the transcript of whatever they walked to with it.
    if (showing.current !== id) return;
    setPending(null);
    resetLive();
    setTurnStats(null);
    // A reply that read itself aloud is still the one being read, and the button on it is
    // the only way to stop it. Claimed here rather than at `done` because the index is the
    // one in the stored transcript, which is what the refetch above has just settled — a
    // turn with tool calls in it has more messages than the answer alone.
    if (read) {
      const messages =
        queryClient.getQueryData<{ messages: { role: string }[] }>(["session", id])?.messages ?? [];
      const last = messages.findLastIndex((message) => message.role === "assistant");
      if (last !== -1) setSpoken(last);
    }
  }

  async function send(text?: string) {
    const prompt = (text ?? draft).trim();
    if (!prompt || pending) return;

    let id = activeId;
    if (!id) {
      const fresh = await api.createSession();
      id = fresh.id;
      setCreated(id);
      await queryClient.invalidateQueries({ queryKey: ["sessions"] });
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
      queryClient.getQueryData<{ messages: unknown[] }>(["session", turnId])?.messages.length ?? 0;

    // A chip sends its own text; anything half-typed in the box is left alone.
    if (!text) setDraft("");
    setPending(prompt);
    speech.stop();
    resetLive();
    setTurnStats(null);
    setFailure(null);
    setStartedAt(Date.now());
    setPinned(true);
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
      if (settled) return;
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
          if (event.type === "followups")
            void queryClient.invalidateQueries({ queryKey: ["session", turnId] });
          // The same goes for a hook that reports after the answer, once the turn has settled
          // and there is no live tail left to put it on: the stored turn has it.
          if (event.type === "hook" && settled) {
            void queryClient.invalidateQueries({ queryKey: ["session", turnId] });
            return;
          }
          if (event.type === "done") {
            if (config.data?.speakReplies && showing.current === turnId)
              read = speech.speak(answer);
            void finish();
          }
          if (event.type === "text_delta") answer += event.text;
          // The rest is this turn showing itself, and it only has somewhere to show while
          // the chat it belongs to is the one being looked at. Switch away and the turn
          // runs on into its own session; the transcript has it when you come back.
          if (showing.current !== turnId) return;
          pushLive(event);
          if (event.type === "stats") setTurnStats(event.stats);
          if (event.type === "error") setFailure(event.message);
        },
      });
    } catch (error) {
      if (!controller.signal.aborted && showing.current === turnId)
        setFailure((error as Error).message);
    } finally {
      if (abort.current === controller) abort.current = null;
      await finish();
      // The address bar catches up once the stream is really over, not on `done`: moving the
      // route mid-stream would remount this pane and drop what is still arriving on it.
      if (!sessionId) router.replace(`/chat/${turnId}`);
    }
  }

  /**
   * Forgets the transcript from `index` on, and reads back what is left.
   *
   * Both of the things below are this move plus one more: what makes retrying and editing
   * different is only what happens after the cut.
   */
  async function rewind(index: number) {
    if (!activeId) return;
    await api.truncateSession(activeId, index);
    await queryClient.invalidateQueries({ queryKey: ["session", activeId] });
    await queryClient.invalidateQueries({ queryKey: ["sessions"] });
  }

  /**
   * Answers again. The cut goes back to the question, not to the reply: a turn is the
   * question plus everything the model did about it, and the server re-sends the prompt
   * itself, so leaving the old copy in place would ask it twice.
   */
  async function retry(index: number) {
    const messages = session.data?.messages ?? [];
    const start = turnStart(messages, index);
    if (start < 0 || pending) return;
    const prompt = messageText(messages[start]);
    await rewind(start);
    await send(prompt);
  }

  /** Puts a question back in the composer, with everything it led to forgotten. */
  async function edit(index: number) {
    const messages = session.data?.messages ?? [];
    const message = messages[index];
    if (!message || pending) return;
    await rewind(index);
    setDraft(messageText(message));
  }

  // A chip must not change identity every render, or the memoised transcript re-renders on
  // every token. The ref keeps the callback stable while still calling the current `send`.
  const sendRef = useRef(send);
  sendRef.current = send;
  const followup = useCallback((text: string) => void sendRef.current(text), []);
  // Same for the two transcript buttons, which hang off every stored message.
  const retryRef = useRef(retry);
  retryRef.current = retry;
  const onRetry = useCallback((index: number) => void retryRef.current(index), []);
  const editRef = useRef(edit);
  editRef.current = edit;
  const onEdit = useCallback((index: number) => void editRef.current(index), []);

  /** Pressing the button on whatever is already being read is how you stop it. */
  function toggleSpeak(index: number, text: string) {
    if (spoken === index && speech.speaking) {
      speech.stop();
      return;
    }
    if (speech.speak(text)) setSpoken(index);
  }
  const speakRef = useRef(toggleSpeak);
  speakRef.current = toggleSpeak;
  const onSpeak = useCallback((index: number, text: string) => speakRef.current(index, text), []);

  /** What the conversation has cost so far, as the one line the header has room for. */
  const usageLine = shownUsage
    ? `${formatUsage(shownUsage, config.data?.pricing)} · ${usageDetail(shownUsage)}`
    : null;

  return (
    <>
      {/*
        No `KeyboardAvoidingView`. Under Android's edge-to-edge window it has nothing to react
        to — the window is not resized when the keyboard opens — so the composer below reserves
        the room itself and this column shrinks around it.
      */}
      <HeaderContentFooter
        className="h-full flex-1 bg-background"
        headerClassName="border-border border-b px-4 py-2"
        // The transcript scrolls itself rather than the shell doing it: following a turn needs
        // the scroll position, and the shell's own scroller does not report one.
        contentClassName="flex flex-col"
        footerClassName="border-border border-t px-4 py-3"
        headerSlot={
          <PageHeader
            level={3}
            // The page draws its own title now. The empty pane has no conversation to name, so
            // it is still "Chats".
            title={activeId ? (session.data?.title ?? "Chat") : "Chats"}
            actionSlot={
              <View className="flex-row flex-wrap items-center justify-end gap-3">
                {/*
                  The readout is the way in to the breakdown: it is already the thing you look at
                  when you wonder where the window went, and a second control beside it saying
                  the same numbers would only be one more thing in a header that is mostly the
                  model picker.
                */}
                {fill || usageLine ? (
                  <ActionButton
                    variant="ghost"
                    size="sm"
                    label="What the tokens went on"
                    className="h-auto flex-wrap gap-3 px-1 py-0.5"
                    onPress={() => setTokensOpen(true)}
                    iconSlot={fill ? <ContextMeter fill={fill} /> : null}
                    content={usageLine ? <Text className={MUTED}>{usageLine}</Text> : null}
                  />
                ) : null}
                <OptionSelect
                  aria-label="Model"
                  searchable
                  searchPlaceholder="Find a model…"
                  className="w-64 max-w-full"
                  value={activeModel}
                  options={(models.data?.models ?? []).map((entry) => ({
                    label: entry.id,
                    value: entry.id,
                  }))}
                  onValueChange={setModel}
                  disabled={!models.data?.models.length}
                  placeholder={models.isError ? "server unreachable" : "select a model"}
                />
              </View>
            }
          />
        }
        contentSlot={
          <>
            <ScrollView
              ref={scroller}
              className="flex-1"
              contentContainerClassName="p-4"
              keyboardShouldPersistTaps="handled"
              onScroll={onScroll}
              scrollEventThrottle={16}
            >
              {/* Wide, the column is centred and capped for readability; narrow, the cap is
                wider than the screen and does nothing. */}
              <View className="w-full max-w-3xl self-center">
                {activeId ? (
                  <MessageView
                    messages={stored}
                    pending={question}
                    live={live}
                    pricing={config.data?.pricing}
                    onFollowup={pending ? undefined : followup}
                    onRetry={pending ? undefined : onRetry}
                    onEdit={pending ? undefined : onEdit}
                    onSpeak={onSpeak}
                    speakingIndex={spoken}
                  />
                ) : (
                  <Nothing configured={Boolean(activeModel)} />
                )}
                {pending ? <LiveMeter startedAt={startedAt} live={live} /> : null}
              </View>
            </ScrollView>

            {pinned ? null : (
              <View className="absolute bottom-4 self-center">
                <Button
                  variant="outline"
                  size="xs"
                  className="rounded-full bg-card"
                  onPress={() => {
                    setPinned(true);
                    scroller.current?.scrollToEnd({ animated: true });
                  }}
                  iconSlot={<ArrowDown aria-hidden className="size-3.5" />}
                  content="Jump to latest"
                />
              </View>
            )}
          </>
        }
        /*
          The composer is the bottom of the screen on a phone, over the gesture pill and under
          the keyboard — but neither is its problem: the app shell pads the whole scene by both,
          so the column above simply ends higher up when the keys come up, and the transcript
          shrinks by the height of them rather than sliding behind them.
        */
        footerSlot={
          <View className="mx-auto w-full max-w-3xl gap-2">
            {failure ? (
              <Alert variant="destructive" title="The turn failed" description={failure} />
            ) : null}

            {/* A microphone that would not open, or a reply that would not play. Its own line:
              it has nothing to do with whether the turn itself worked. */}
            {dictation.error || speech.error ? (
              <Alert
                variant="destructive"
                title="Voice is not working"
                description={dictation.error ?? speech.error ?? ""}
              />
            ) : null}

            {/*
              Nothing below this can work without a model, and the composer cannot say where to
              get one — a placeholder is not something you can press. So the way out sits above
              it, as a button rather than as the name of a screen to go and find.
            */}
            {activeModel ? null : (
              <View className="flex-row items-center gap-3">
                <Text className={cn(MUTED, "flex-1")}>
                  No model selected, so a turn has nothing to run on.
                </Text>
                <SettingsLink tab="model" label="Pick a model" />
              </View>
            )}
            <View className="flex-row items-end gap-2">
              {/*
                The box's name. A placeholder is not one, and `Textarea` takes no `aria-label`,
                so it is a label nobody sees — on the web, the one place `htmlFor` reaches.
              */}
              {Platform.OS === "web" ? (
                <Label htmlFor={COMPOSER_ID} className="sr-only">
                  Message
                </Label>
              ) : null}
              {/*
                cubeui's box: as tall as what is in it up to seven lines, and in a browser a bare
                Enter sends. On a phone the return key is a new line and the send button is an
                inch away.
              */}
              <Textarea
                id={COMPOSER_ID}
                rows={1}
                maxRows={7}
                value={draft}
                onChangeText={setDraft}
                onSubmitEditing={() => void send()}
                placeholder={activeModel ? "Send a message…" : "Pick a model to start"}
                className="min-h-11 flex-1 py-2.5"
              />
              {/*
                Absent where no server offers a prompt, for the same reason as the microphone
                below: a button that opens an empty list is a button that teaches you not to
                press it.
              */}
              {prompts.data?.length ? (
                <ActionButton
                  variant="secondary"
                  size="icon-lg"
                  label="Insert an MCP prompt"
                  onPress={() => setPicking(true)}
                  iconSlot={<BookOpen aria-hidden className="size-4" />}
                />
              ) : null}
              {/*
                Absent rather than disabled where neither engine can run — a device build with no
                transcription model configured, or Firefox. There is nothing to press it for, and
                the phone keyboard already has a microphone key of its own.
              */}
              {dictation.supported ? (
                <ActionButton
                  variant={dictation.listening ? "destructive" : "secondary"}
                  size="icon-lg"
                  label={dictation.listening ? "Stop dictating" : "Dictate a message"}
                  disabled={dictation.transcribing}
                  onPress={dictation.toggle}
                  iconSlot={
                    dictation.transcribing ? (
                      <Spinner label="Transcribing" />
                    ) : dictation.listening ? (
                      <Square aria-hidden className="size-4" />
                    ) : (
                      <Mic aria-hidden className="size-4" />
                    )
                  }
                />
              ) : null}
              {pending ? (
                <ActionButton
                  variant="secondary"
                  size="icon-lg"
                  label="Stop the turn"
                  onPress={() => abort.current?.abort()}
                  iconSlot={<Square aria-hidden className="size-4" />}
                />
              ) : (
                <ActionButton
                  size="icon-lg"
                  label="Send"
                  disabled={!draft.trim()}
                  onPress={() => void send()}
                  iconSlot={<Send aria-hidden className="size-4" />}
                />
              )}
            </View>
          </View>
        }
      />

      <TokensDialog
        visible={tokensOpen}
        onClose={() => setTokensOpen(false)}
        usage={shownUsage}
        stats={recent}
        pricing={config.data?.pricing}
      />

      {/*
        Expanded into the draft rather than sent: a template is a starting point, and the one
        thing the person picking it knows that the server does not is what they meant to ask.
      */}
      <PromptPicker
        visible={picking}
        onClose={() => setPicking(false)}
        onInsert={(text) =>
          setDraft((held) => (held.trim() ? `${held.trimEnd()}\n\n${text}` : text))
        }
      />
    </>
  );
}

/** The small grey line: a readout, a hint, a footnote. */
const MUTED = "text-muted-foreground text-xs";

/** What ties the composer to its label. One composer is on screen at a time. */
const COMPOSER_ID = "composer";

/**
 * The empty pane, wide, with no conversation open. On a fresh install it is also the first
 * thing anyone sees, and "start a chat" is unhelpful advice to someone whose server has not
 * been pointed at a model yet — so which of the two it says depends on whether there is one.
 */
function Nothing({ configured }: { configured: boolean }) {
  if (configured) {
    return (
      <EmptyState
        icon={MessageSquare}
        title="No chat open"
        description="Send a message to start one, or open one from the list."
      />
    );
  }
  return (
    <EmptyState
      icon={MessageSquare}
      title="No model yet"
      description="Point min-agent at an OpenAI-compatible server and pick a model, and this becomes a chat."
      actionSlot={<SettingsLink tab="model" label="Set up a model" />}
    />
  );
}

/**
 * A colour per part, so the bar and the rows under it are the same thing said twice rather
 * than a legend you have to hold in your head.
 */
const PART_COLOR: Record<BreakdownPart, string> = {
  // The standing overhead is the blue end, the conversation the warm one, this turn green,
  // and a part's tool traffic is the lighter shade of whatever it belongs to — so the bar
  // reads as three things before it reads as nine.
  system: "bg-sky-500",
  guidance: "bg-sky-400",
  catalogue: "bg-sky-300",
  tools: "bg-violet-500",
  summary: "bg-amber-500",
  history: "bg-primary",
  historyTools: "bg-amber-300",
  input: "bg-emerald-500",
  inputTools: "bg-emerald-300",
};

/**
 * Where the tokens went.
 *
 * The header can only ever be one line, and the interesting question when a window is filling
 * up is not how full it is but what is filling it — a system prompt that grew, a tool
 * catalogue nobody calls, or the conversation itself. So the totals that used to have to fit
 * in that line are in here with room around them, and the split is under them.
 *
 * The split is only ever of the last request: it is measured on the way out and scaled to the
 * prompt tokens the server reported, so it describes the shape of what the *next* turn will
 * send too, which is the thing worth knowing before you send it.
 */
function TokensDialog({
  visible,
  onClose,
  usage,
  stats,
  pricing,
}: {
  visible: boolean;
  onClose: () => void;
  usage: TokenUsage | null;
  stats: TurnStats | null;
  pricing?: LlmConfig["pricing"];
}) {
  const rows = stats?.breakdown ? breakdownRows(stats.breakdown) : [];
  const cleared = stats?.breakdown?.cleared ?? 0;
  const fill = contextFill(stats);
  const cost = usage ? costOf(usage, pricing) : null;

  const body = (
    <>
      {usage || fill ? (
        <DescriptionList
          contentSlot={
            <>
              {usage ? (
                <>
                  <PropertyRow label="Total" value={usage.totalTokens.toLocaleString()} />
                  <PropertyRow label="Sent" value={usage.promptTokens.toLocaleString()} />
                  <PropertyRow label="Received" value={usage.completionTokens.toLocaleString()} />
                  {cost !== null ? (
                    <PropertyRow label="Cost" value={`$${cost.toFixed(4)}`} />
                  ) : null}
                </>
              ) : null}
              {fill ? (
                <PropertyRow label="Context window" value={`${fill.label} · ${fill.percent}`} />
              ) : null}
            </>
          }
        />
      ) : null}

      {rows.length ? (
        <>
          <Separator />
          <View className="gap-2">
            <Text className={MUTED}>What the last request was made of</Text>
            <View className="h-2 flex-row overflow-hidden rounded-full bg-muted">
              {rows.map((row) => (
                <View
                  key={row.key}
                  className={PART_COLOR[row.key]}
                  style={{ width: `${row.ratio * 100}%` }}
                />
              ))}
            </View>
            {rows.map((row) => (
              <View key={row.key} className="flex-row items-center gap-2">
                <View className={cn("h-2 w-2 rounded-full", PART_COLOR[row.key])} />
                <Text className={cn(MUTED, "flex-1")}>{row.label}</Text>
                <Text className="text-sm text-foreground">
                  {formatTokens(row.tokens)}
                  <Text className="text-muted-foreground">
                    {"  "}
                    {Math.round(row.ratio * 100)}%
                  </Text>
                </Text>
              </View>
            ))}
            {/*
              Under the parts and not among them: it is what the request did not carry, so it has
              no colour in the bar and no share of the total. Only there once something has been
              cleared, which for most chats is never.
            */}
            {cleared > 0 ? (
              <View className="flex-row items-center gap-2">
                <View className="h-2 w-2 rounded-full border border-muted-foreground" />
                <Text className={cn(MUTED, "flex-1")}>Old tool results left out</Text>
                <Text className="text-sm text-foreground">−{formatTokens(cleared)}</Text>
              </View>
            ) : null}
            {/*
              Said plainly rather than with a "~" nobody would decode: a completion reports how
              many prompt tokens it read and nothing about where they came from, so the shares
              are measured from the request we sent and only the total is the server's.
            */}
            <Text className={MUTED}>
              The total is the server's; the split is measured from the request and is approximate.
            </Text>
          </View>
        </>
      ) : null}

      {!usage && !rows.length ? (
        <EmptyState compact title="Nothing measured yet — send a message." />
      ) : null}
    </>
  );

  return (
    <DialogLayout
      open={visible}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Tokens"
      contentSlot={<View className="gap-3">{body}</View>}
    />
  );
}

function ContextMeter({ fill }: { fill: NonNullable<ReturnType<typeof contextFill>> }) {
  const tone =
    fill.ratio > 0.9 ? "bg-destructive" : fill.ratio > 0.75 ? "bg-amber-500" : "bg-primary";
  return (
    <View className="flex-row items-center gap-2">
      <View className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
        <View
          className={cn("h-full rounded-full", tone)}
          style={{ width: `${fill.ratio * 100}%` }}
        />
      </View>
      <Text className={MUTED}>{fill.label}</Text>
    </View>
  );
}

/**
 * While a turn streams the server has not reported anything yet, so we show our own
 * clock and a character-derived token estimate — marked "~" so it is never mistaken
 * for the exact numbers that replace it.
 */
function LiveMeter({ startedAt, live }: { startedAt: number; live: LivePart[] }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, []);

  if (!startedAt) return null;
  const elapsed = Math.max(now - startedAt, 0);
  const tokens = Math.round(liveCharCount(live) / 4);
  const seconds = elapsed / 1000;

  return (
    <View className="mt-2 flex-row items-center gap-2">
      <Text className={MUTED}>{formatDuration(elapsed)}</Text>
      {tokens > 0 ? (
        <>
          <Text className={MUTED}>·</Text>
          <Text className={MUTED}>~{formatTokens(tokens)} tok</Text>
          {seconds > 0.5 ? (
            <>
              <Text className={MUTED}>·</Text>
              <Text className={MUTED}>~{formatRate(tokens / seconds)}</Text>
            </>
          ) : null}
        </>
      ) : null}
    </View>
  );
}
