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
import { useLocalSearchParams, useNavigation } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from "react-native";
import { MessageView } from "@/components/message-view.tsx";
import { Button, ErrorNote, Muted, Select, Textarea } from "@/components/ui.tsx";
import { api, streamTurn } from "@/lib/client.ts";
import { cn } from "@/lib/utils.ts";

export default function ChatScreen() {
  const { id: sessionId } = useLocalSearchParams<{ id: string }>();
  const navigation = useNavigation();
  const queryClient = useQueryClient();

  const session = useQuery({
    queryKey: ["session", sessionId],
    queryFn: () => api.session(sessionId),
    enabled: Boolean(sessionId),
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
  const scroller = useRef<ScrollView>(null);

  const activeModel = model || session.data?.model || config.data?.model || "";
  // While a turn streams, the server's count lands just before "done"; once the session is
  // refetched the stored running total takes over.
  const shownUsage = pending ? turnStats : (session.data?.usage ?? null);
  // The window is only measured at the end of a turn, so during one we keep showing the
  // last known fill rather than blanking the meter out.
  const fill = contextFill(turnStats ?? latestStats(session.data?.messages ?? []));

  // The drawer owns the header, so the session title is pushed up to it.
  useEffect(() => {
    navigation.setOptions({ title: session.data?.title ?? "Chat" });
  }, [navigation, session.data?.title]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: these deps are the scroll triggers.
  useEffect(() => {
    scroller.current?.scrollToEnd({ animated: true });
  }, [session.data?.messages.length, live, pending]);

  async function send(text?: string) {
    const prompt = (text ?? draft).trim();
    if (!prompt || pending || !sessionId) return;

    // A chip sends its own text; anything half-typed in the box is left alone.
    if (!text) setDraft("");
    setPending(prompt);
    setLive([]);
    setTurnStats(null);
    setFailure(null);
    setStartedAt(Date.now());
    abort.current = new AbortController();

    try {
      await streamTurn({
        sessionId,
        prompt,
        model: activeModel,
        signal: abort.current.signal,
        onEvent: (event) => {
          setLive((parts) => applyEvent(parts, event));
          if (event.type === "stats") setTurnStats(event.stats);
          if (event.type === "error") setFailure(event.message);
        },
      });
    } catch (error) {
      if (!abort.current.signal.aborted) setFailure((error as Error).message);
    } finally {
      abort.current = null;
      // Refetch *before* dropping the optimistic bubbles, or the turn blinks out of the
      // window for a frame while the stored session is on its way back.
      await queryClient.invalidateQueries({ queryKey: ["session", sessionId] });
      await queryClient.invalidateQueries({ queryKey: ["sessions"] });
      setPending(null);
      setLive([]);
      setTurnStats(null);
    }
  }

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-background"
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View className="gap-2 border-b border-border px-4 py-2">
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
        <View className="flex-row items-center gap-3">
          {fill ? <ContextMeter fill={fill} /> : null}
          {shownUsage ? (
            <Muted>
              {formatUsage(shownUsage, config.data?.pricing)} · {usageDetail(shownUsage)}
            </Muted>
          ) : null}
        </View>
      </View>

      <ScrollView
        ref={scroller}
        className="flex-1"
        contentContainerClassName="p-4"
        keyboardShouldPersistTaps="handled"
      >
        <MessageView
          messages={session.data?.messages ?? []}
          live={live}
          pricing={config.data?.pricing}
          onFollowup={pending ? undefined : (text) => void send(text)}
        />
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
      </ScrollView>

      {failure ? (
        <View className="px-4 pb-2">
          <ErrorNote error={new Error(failure)} />
        </View>
      ) : null}

      <View className="flex-row items-end gap-2 border-t border-border px-4 py-3">
        <Textarea
          value={draft}
          onChangeText={setDraft}
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
