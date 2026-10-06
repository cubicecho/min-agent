import { contextFill, formatUsage, latestStats, usageDetail } from "@shared/client/usage.ts";
import { CHAT_DEFAULTS } from "@shared/defaults.ts";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  ScrollView,
  Text,
  View,
} from "react-native";
import { ActionButton } from "@/components/action-button.tsx";
import { ArrowDown, MessageSquare } from "@/components/app/app-icons";
import { Composer } from "@/components/chat/composer.tsx";
import { MessageView } from "@/components/chat/message-view.tsx";
import { PromptPicker, useMcpPrompts } from "@/components/chat/prompt-picker.tsx";
import { SessionsPanel, SessionsScreen } from "@/components/chat/session-list.tsx";
import { ContextMeter, LiveMeter, MUTED, TokensDialog } from "@/components/chat/token-readouts.tsx";
import { useTurn } from "@/components/chat/use-turn.ts";
import { HeaderContentFooter } from "@/components/header-content-footer.tsx";
import { OptionSelect } from "@/components/option-select.tsx";
import { EmptyState } from "@/components/page.tsx";
import { PageHeader } from "@/components/page-header.tsx";
import { SettingsLink } from "@/components/settings/link.tsx";
import { SplitLayout } from "@/components/split-layout.tsx";
import { Button } from "@/components/ui/button.tsx";
import { api } from "@/lib/client.ts";
import { useWide } from "@/lib/layout.ts";
import { queryKeys } from "@/lib/queries.ts";
import { useStableCallback } from "@/lib/stable-callback.ts";
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

  const isNarrow = wide === false;
  if (isNarrow) {
    return sessionId ? <ChatPane sessionId={sessionId} /> : <SessionsScreen />;
  }

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
  const config = useQuery({ queryKey: queryKeys.config, queryFn: api.config });
  const models = useQuery({ queryKey: queryKeys.models, queryFn: api.models });

  const [draft, setDraft] = useState("");
  /** Which stored reply is being read aloud, so its button can offer to stop instead. */
  const [spoken, setSpoken] = useState<number | null>(null);
  // Scrolling follows the turn only while the reader is already at the bottom. Reading back
  // through the transcript mid-turn used to be impossible: every delta yanked the view down.
  const [pinned, setPinned] = useState(true);
  const [tokensOpen, setTokensOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const prompts = useMcpPrompts();
  const scroller = useRef<ScrollView>(null);

  const speech = useSpeech({ model: config.data?.ttsModel ?? "" });
  const {
    activeId,
    session,
    activeModel,
    setModel,
    pending,
    question,
    live,
    turnStats,
    startedAt,
    failure,
    send,
    stop,
    retry,
    edit,
  } = useTurn({
    sessionId,
    defaultModel: config.data?.model ?? "",
    speakReplies: Boolean(config.data?.speakReplies),
    draft,
    setDraft,
    speech,
    onStart: () => setPinned(true),
    onLeave: () => {
      setSpoken(null);
      setPinned(true);
    },
    onRead: setSpoken,
  });
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
    const isSilent = speech.speaking === false;
    if (isSilent) {
      setSpoken(null);
    }
  }, [speech.speaking]);

  // While a turn streams, the server's count lands just before "done"; once the session is
  // refetched the stored running total takes over.
  const shownUsage = pending ? turnStats : (session.data?.usage ?? null);
  const stored = session.data?.messages ?? [];
  // The window is only measured at the end of a turn, so during one we keep showing the
  // last known fill rather than blanking the meter out.
  const recent = turnStats ?? latestStats(stored);
  const fill = contextFill(recent);

  /** With some slack, so a stray flick does not count as leaving the bottom. */
  function onScroll({ nativeEvent }: NativeSyntheticEvent<NativeScrollEvent>) {
    const { contentSize, contentOffset, layoutMeasurement } = nativeEvent;
    const now =
      contentSize.height - contentOffset.y - layoutMeasurement.height < CHAT_DEFAULTS.bottomSlackPx;
    // Bail out when nothing changed: scrolling fires many times a second and every real state
    // write here would re-render the transcript.
    setPinned((was) => (was === now ? was : now));
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: these deps are the scroll triggers.
  useEffect(() => {
    const isScrolledAway = pinned === false;
    if (isScrolledAway) {
      return;
    }
    // Animation cannot keep up with a stream, and trying looks like stutter; during a turn the
    // view is simply moved.
    scroller.current?.scrollToEnd({ animated: !pending });
  }, [session.data?.messages.length, live, pending, pinned]);

  // A chip must not change identity every render, or the memoised transcript re-renders on
  // every token.
  const followup = useStableCallback((text: string) => void send(text));
  // Same for the two transcript buttons, which hang off every stored message.
  const onRetry = useStableCallback((index: number) => void retry(index));
  const onEdit = useStableCallback((index: number) => void edit(index));

  /** Pressing the button on whatever is already being read is how you stop it. */
  const onSpeak = useStableCallback((index: number, text: string) => {
    if (spoken === index && speech.speaking) {
      speech.stop();
      return;
    }
    if (speech.speak(text)) {
      setSpoken(index);
    }
  });

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
          <Composer
            draft={draft}
            onDraft={setDraft}
            activeModel={activeModel}
            busy={Boolean(pending)}
            failure={failure}
            speechError={speech.error}
            dictation={dictation}
            onSend={() => void send()}
            onStop={stop}
            onPickPrompt={prompts.data?.length ? () => setPicking(true) : undefined}
          />
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
