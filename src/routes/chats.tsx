import type { TurnStats } from "@shared/types.ts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { Bot, Plus, Send, Square, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { MessageView } from "@/components/message-view";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { api, streamTurn } from "@/lib/api";
import { applyEvent, type LivePart, liveCharCount } from "@/lib/live";
import {
  contextFill,
  formatDuration,
  formatRate,
  formatTokens,
  formatUsage,
  latestStats,
  usageDetail,
} from "@/lib/usage";
import { cn } from "@/lib/utils";

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

export function ChatsRoute() {
  const { sessionId } = useParams({ strict: false }) as { sessionId?: string };
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const sessions = useQuery({ queryKey: ["sessions"], queryFn: api.sessions });
  const session = useQuery({
    queryKey: ["session", sessionId],
    queryFn: () => api.session(sessionId as string),
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
  const abort = useRef<AbortController | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  const activeModel = model || session.data?.model || config.data?.model || "";
  // While a turn streams, the server's count lands just before "done"; once the session is
  // refetched the stored running total takes over.
  const shownUsage = pending ? turnStats : (session.data?.usage ?? null);
  // The window is only measured at the end of a turn, so during one we keep showing the
  // last known fill rather than blanking the meter out.
  const fill = contextFill(turnStats ?? latestStats(session.data?.messages ?? []));

  // biome-ignore lint/correctness/useExhaustiveDependencies: these deps are the scroll triggers.
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [session.data?.messages.length, live, pending]);

  const newChat = useMutation({
    mutationFn: api.createSession,
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({ queryKey: ["sessions"] });
      navigate({ to: "/chats/$sessionId", params: { sessionId: created.id } });
    },
  });

  const remove = useMutation({
    mutationFn: api.deleteSession,
    onSuccess: async (_data, id) => {
      await queryClient.invalidateQueries({ queryKey: ["sessions"] });
      if (id === sessionId) navigate({ to: "/chats" });
    },
  });

  async function send() {
    const prompt = draft.trim();
    if (!prompt || pending) return;

    let id = sessionId;
    if (!id) {
      const created = await api.createSession();
      id = created.id;
      await queryClient.invalidateQueries({ queryKey: ["sessions"] });
      navigate({ to: "/chats/$sessionId", params: { sessionId: id } });
    }

    setDraft("");
    setPending(prompt);
    setLive([]);
    setTurnStats(null);
    setStartedAt(Date.now());
    abort.current = new AbortController();

    try {
      await streamTurn({
        sessionId: id,
        prompt,
        model: activeModel,
        signal: abort.current.signal,
        onEvent: (event) => {
          setLive((parts) => applyEvent(parts, event));
          if (event.type === "stats") setTurnStats(event.stats);
          if (event.type === "error") toast.error(event.message);
        },
      });
    } catch (error) {
      if (!abort.current.signal.aborted) toast.error((error as Error).message);
    } finally {
      abort.current = null;
      // Refetch *before* dropping the optimistic bubbles, or the turn blinks out of the
      // window for a frame while the stored session is on its way back.
      await queryClient.invalidateQueries({ queryKey: ["session", id] });
      await queryClient.invalidateQueries({ queryKey: ["sessions"] });
      setPending(null);
      setLive([]);
      setTurnStats(null);
    }
  }

  return (
    <div className="flex h-full min-h-0">
      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-4 border-b px-6 py-3">
          <h1 className="truncate text-sm font-medium">{session.data?.title ?? "New chat"}</h1>
          <div className="flex items-center gap-3">
            {fill ? <ContextMeter fill={fill} /> : null}
            {shownUsage ? (
              <span
                className="shrink-0 text-xs tabular-nums text-muted-foreground"
                title={`${usageDetail(shownUsage)} — ${pending ? "this turn" : "session total"}`}
              >
                {formatUsage(shownUsage, config.data?.pricing)}
              </span>
            ) : null}
            <Select
              value={activeModel}
              onValueChange={setModel}
              disabled={!models.data?.models.length}
            >
              <SelectTrigger className="w-64" size="sm">
                <SelectValue
                  placeholder={models.isError ? "server unreachable" : "select a model"}
                />
              </SelectTrigger>
              <SelectContent>
                {(models.data?.models ?? []).map((entry) => (
                  <SelectItem key={entry.id} value={entry.id}>
                    {entry.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          <div className="mx-auto max-w-3xl">
            {session.data || pending ? (
              <MessageView
                messages={session.data?.messages ?? []}
                live={live}
                pricing={config.data?.pricing}
              />
            ) : (
              <Empty />
            )}
            {pending ? (
              <>
                <div className="mt-3 flex justify-end">
                  <div className="max-w-[85%] whitespace-pre-wrap rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground opacity-70">
                    {pending}
                  </div>
                </div>
                <LiveMeter startedAt={startedAt} live={live} />
              </>
            ) : null}
            <div ref={bottom} />
          </div>
        </div>

        <footer className="border-t px-6 py-4">
          <div className="mx-auto flex max-w-3xl items-end gap-2">
            <Textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void send();
                }
              }}
              placeholder={activeModel ? "Send a message…" : "Pick a model in Config first"}
              className="max-h-48 min-h-[44px] resize-none"
              rows={1}
            />
            {pending ? (
              <Button variant="secondary" size="icon" onClick={() => abort.current?.abort()}>
                <Square className="size-4" />
              </Button>
            ) : (
              <Button size="icon" onClick={() => void send()} disabled={!draft.trim()}>
                <Send className="size-4" />
              </Button>
            )}
          </div>
        </footer>
      </section>

      <aside className="flex w-72 shrink-0 flex-col border-l bg-sidebar">
        <div className="flex items-center justify-between px-3 py-3">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Sessions
          </span>
          <Button size="sm" variant="ghost" onClick={() => newChat.mutate()}>
            <Plus className="size-4" />
            New
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {(sessions.data ?? []).map((item) => (
            <div key={item.id} className="group relative">
              <Link
                to="/chats/$sessionId"
                params={{ sessionId: item.id }}
                className={cn(
                  "block rounded-md px-3 py-2 pr-8 text-sm hover:bg-accent",
                  item.id === sessionId && "bg-accent",
                )}
              >
                <div className="truncate">{item.title}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {item.source === "cron" ? "cron · " : ""}
                  {when(item.updatedAt)}
                </div>
              </Link>
              <button
                type="button"
                aria-label={`Delete ${item.title}`}
                onClick={() => remove.mutate(item.id)}
                className="absolute right-2 top-2 hidden rounded p-1 text-muted-foreground hover:text-destructive group-hover:block"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
          {sessions.data?.length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">No sessions yet.</p>
          ) : null}
        </div>
      </aside>
    </div>
  );
}

function ContextMeter({ fill }: { fill: NonNullable<ReturnType<typeof contextFill>> }) {
  const tone =
    fill.ratio > 0.9 ? "bg-destructive" : fill.ratio > 0.75 ? "bg-amber-500" : "bg-primary";
  return (
    <div
      className="flex shrink-0 items-center gap-2"
      title={`Context after the last turn: ${fill.used.toLocaleString()} of ${fill.limit.toLocaleString()} tokens (${fill.percent})`}
    >
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full", tone)}
          style={{ width: `${fill.ratio * 100}%` }}
        />
      </div>
      <span className="text-xs tabular-nums text-muted-foreground">{fill.label}</span>
    </div>
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
    <div className="mt-2 flex items-center gap-2 text-xs tabular-nums text-muted-foreground">
      <span>{formatDuration(elapsed)}</span>
      {tokens > 0 ? (
        <>
          <span>·</span>
          <span title="Estimated from the streamed text — exact counts arrive when the turn ends">
            ~{formatTokens(tokens)} tok
          </span>
          {seconds > 0.5 ? (
            <>
              <span>·</span>
              <span>~{formatRate(tokens / seconds)}</span>
            </>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function Empty() {
  return (
    <div className="flex flex-col items-center gap-2 pt-24 text-center text-muted-foreground">
      <Bot className="size-8" />
      <p className="text-sm">Start a chat, or open one from the right.</p>
    </div>
  );
}
