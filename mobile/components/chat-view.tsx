import { applyEvent, type LivePart, liveCharCount } from "@shared/client/live.ts";
import {
  contextFill,
  formatDuration,
  formatRate,
  formatTokens,
  formatUsage,
  latestStats,
  usageDetail,
} from "@shared/client/usage.ts";
import type { TurnStats } from "@shared/types.ts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigation, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from "react-native";
import { MessageView } from "@/components/message-view.tsx";
import { SessionsPanel, SessionsScreen } from "@/components/session-list.tsx";
import { Button, Empty, ErrorNote, Muted, Select, Textarea } from "@/components/ui.tsx";
import { api, streamTurn } from "@/lib/client.ts";
import { useWide } from "@/lib/layout.ts";
import { cn } from "@/lib/utils.ts";

/**
 * Chats, in the two arrangements the window has room for.
 *
 * Wide, it is the web app's: the chat takes the space and the sessions sit in a panel on
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
    <View className="flex-1 flex-row bg-background">
      <ChatPane sessionId={sessionId} />
      <SessionsPanel activeId={sessionId} />
    </View>
  );
}

function ChatPane({ sessionId }: { sessionId?: string }) {
  const navigation = useNavigation();
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
  const [live, setLive] = useState<LivePart[]>([]);
  const [turnStats, setTurnStats] = useState<TurnStats | null>(null);
  const [startedAt, setStartedAt] = useState(0);
  const [failure, setFailure] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const settled = useRef(false);
  const scroller = useRef<ScrollView>(null);

  const activeModel = model || session.data?.model || config.data?.model || "";
  // While a turn streams, the server's count lands just before "done"; once the session is
  // refetched the stored running total takes over.
  const shownUsage = pending ? turnStats : (session.data?.usage ?? null);
  // The window is only measured at the end of a turn, so during one we keep showing the
  // last known fill rather than blanking the meter out.
  const fill = contextFill(turnStats ?? latestStats(session.data?.messages ?? []));

  // The drawer owns the header, so the session title is pushed up to it. The empty pane
  // leaves it alone: that screen is still "Chats".
  useEffect(() => {
    if (sessionId) navigation.setOptions({ title: session.data?.title ?? "Chat" });
  }, [navigation, sessionId, session.data?.title]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: these deps are the scroll triggers.
  useEffect(() => {
    scroller.current?.scrollToEnd({ animated: true });
  }, [session.data?.messages.length, live, pending]);

  /**
   * Puts the window back on the stored session and drops the optimistic bubbles — the refetch
   * first, or the turn blinks out of the window for a frame while the stored session is on its
   * way back.
   *
   * This runs on `done` rather than on the end of the stream: a turn that writes follow-up
   * chips holds its stream open for the second they take, and the composer has no business
   * waiting on that. Whichever arrives first settles the turn; the other is a no-op.
   */
  async function settle(id: string) {
    if (settled.current) return;
    settled.current = true;
    await queryClient.invalidateQueries({ queryKey: ["session", id] });
    await queryClient.invalidateQueries({ queryKey: ["sessions"] });
    setPending(null);
    setLive([]);
    setTurnStats(null);
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

    // A chip sends its own text; anything half-typed in the box is left alone.
    if (!text) setDraft("");
    setPending(prompt);
    setLive([]);
    setTurnStats(null);
    setFailure(null);
    setStartedAt(Date.now());
    settled.current = false;
    abort.current = new AbortController();

    try {
      await streamTurn({
        sessionId: turnId,
        prompt,
        model: activeModel,
        signal: abort.current.signal,
        onEvent: (event) => {
          setLive((parts) => applyEvent(parts, event));
          if (event.type === "stats") setTurnStats(event.stats);
          if (event.type === "error") setFailure(event.message);
          if (event.type === "done") void settle(turnId);
          // Chips are written to the session after the answer; read them back from there
          // rather than growing a second path for the same data.
          if (event.type === "followups")
            void queryClient.invalidateQueries({ queryKey: ["session", turnId] });
        },
      });
    } catch (error) {
      if (!abort.current.signal.aborted) setFailure((error as Error).message);
    } finally {
      abort.current = null;
      await settle(turnId);
      // The address bar catches up once the stream is really over, not on `done`: moving the
      // route mid-stream would remount this pane and drop what is still arriving on it.
      if (!sessionId) router.replace(`/chat/${turnId}`);
    }
  }

  return (
    <KeyboardAvoidingView
      className="min-w-0 flex-1 bg-background"
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View className="flex-row flex-wrap items-center justify-end gap-3 border-b border-border px-4 py-2">
        {fill ? <ContextMeter fill={fill} /> : null}
        {shownUsage ? (
          <Muted>
            {formatUsage(shownUsage, config.data?.pricing)} · {usageDetail(shownUsage)}
          </Muted>
        ) : null}
        <View className="w-64 max-w-full">
          <Select
            value={activeModel}
            options={(models.data?.models ?? []).map((entry) => ({
              label: entry.id,
              value: entry.id,
            }))}
            onChange={setModel}
            disabled={!models.data?.models.length}
            placeholder={models.isError ? "server unreachable" : "select a model"}
          />
        </View>
      </View>

      <ScrollView
        ref={scroller}
        className="flex-1"
        contentContainerClassName="p-4"
        keyboardShouldPersistTaps="handled"
      >
        {/* Wide, the column is centred and capped as on the web app; narrow, the cap is
            wider than the screen and does nothing. */}
        <View className="w-full max-w-3xl self-center">
          {activeId ? (
            <MessageView
              messages={session.data?.messages ?? []}
              live={live}
              pricing={config.data?.pricing}
              onFollowup={pending ? undefined : (text) => void send(text)}
            />
          ) : (
            <Empty>Start a chat, or open one from the right.</Empty>
          )}
          {pending ? (
            <>
              <View className="mt-3 flex-row justify-end">
                <View className="max-w-[88%] rounded-lg bg-primary px-3 py-2 opacity-70">
                  <Text className="text-sm leading-5 text-primary-foreground">{pending}</Text>
                </View>
              </View>
              <LiveMeter startedAt={startedAt} live={live} />
            </>
          ) : null}
        </View>
      </ScrollView>

      {failure ? (
        <View className="px-4 pb-2">
          <ErrorNote error={new Error(failure)} />
        </View>
      ) : null}

      <View className="border-t border-border px-4 py-3">
        <View className="w-full max-w-3xl flex-row items-end gap-2 self-center">
          <Textarea
            value={draft}
            onChangeText={setDraft}
            onSubmit={() => void send()}
            placeholder={activeModel ? "Send a message…" : "Pick a model in Config first"}
            className="min-h-11 max-h-40 flex-1"
          />
          {pending ? (
            <Button
              variant="secondary"
              size="icon"
              icon="square"
              onPress={() => abort.current?.abort()}
            />
          ) : (
            <Button size="icon" icon="send" disabled={!draft.trim()} onPress={() => void send()} />
          )}
        </View>
      </View>
    </KeyboardAvoidingView>
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
      <Muted>{fill.label}</Muted>
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
      <Muted>{formatDuration(elapsed)}</Muted>
      {tokens > 0 ? (
        <>
          <Muted>·</Muted>
          <Muted>~{formatTokens(tokens)} tok</Muted>
          {seconds > 0.5 ? (
            <>
              <Muted>·</Muted>
              <Muted>~{formatRate(tokens / seconds)}</Muted>
            </>
          ) : null}
        </>
      ) : null}
    </View>
  );
}
