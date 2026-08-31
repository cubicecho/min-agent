import type { LivePart } from "@shared/client/live.ts";
import { statsLine } from "@shared/client/usage.ts";
import type { LlmConfig, StoredMessage, TurnStats } from "@shared/types.ts";
import { AlertCircle, Brain, ChevronRight, Wrench } from "lucide-react";
import { memo, useMemo } from "react";
import { Markdown } from "@/components/markdown";
import { cn } from "@/lib/utils";

function text(content: StoredMessage["content"]): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => ("text" in part && typeof part.text === "string" ? part.text : ""))
    .join("");
}

function Bubble({ from, children }: { from: "user" | "assistant"; children: React.ReactNode }) {
  return (
    <div className={cn("flex", from === "user" ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[85%] rounded-lg px-3 py-2 text-sm leading-relaxed",
          from === "user"
            ? "whitespace-pre-wrap bg-primary text-primary-foreground"
            : "min-w-0 bg-muted",
        )}
      >
        {children}
      </div>
    </div>
  );
}

/** Collapsed rows show a one-line taste of what is inside, so they read as openable. */
function preview(value: string, limit = 90) {
  const line = value.replace(/\s+/g, " ").trim();
  return line.length > limit ? `${line.slice(0, limit - 1)}…` : line;
}

/** Shared chrome for the two collapsible rows: a rotating chevron and a real hover target. */
const DETAILS =
  "group rounded-lg border bg-card/50 text-xs transition-colors hover:border-foreground/25";
const SUMMARY =
  "flex cursor-pointer list-none items-center gap-1.5 px-3 py-2 text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden";
const CHEVRON = "size-3.5 shrink-0 transition-transform duration-150 group-open:rotate-90";

function ToolCall({
  name,
  input,
  result,
  isError,
}: {
  name: string;
  input: string;
  result?: string;
  isError?: boolean;
}) {
  return (
    <details className={cn(DETAILS, isError && "border-destructive/40")}>
      <summary className={SUMMARY}>
        <ChevronRight className={CHEVRON} />
        {isError ? (
          <AlertCircle className="size-3.5 shrink-0 text-destructive" />
        ) : (
          <Wrench className="size-3.5 shrink-0" />
        )}
        <span className="font-mono font-medium text-foreground">{name}</span>
        {result === undefined ? (
          <span className="animate-pulse">running…</span>
        ) : (
          <span className="min-w-0 flex-1 truncate opacity-70 group-open:hidden">
            {preview(result) || "(no output)"}
          </span>
        )}
        <span className="ml-auto shrink-0 pl-2 opacity-0 transition-opacity group-hover:opacity-60 group-open:hidden">
          expand
        </span>
      </summary>

      <div className="border-t px-3 py-2">
        <p className="mb-1 font-medium uppercase tracking-wide opacity-60">arguments</p>
        <pre className="overflow-x-auto whitespace-pre-wrap break-all text-muted-foreground">
          {input || "{}"}
        </pre>
        {result !== undefined ? (
          <>
            <p className="mb-1 mt-3 font-medium uppercase tracking-wide opacity-60">
              {isError ? "error" : "result"}
            </p>
            <pre
              className={cn(
                "overflow-x-auto whitespace-pre-wrap break-all",
                isError ? "text-destructive" : "text-muted-foreground",
              )}
            >
              {result}
            </pre>
          </>
        ) : null}
      </div>
    </details>
  );
}

/**
 * `defaultOpen` is passed straight through as the `open` attribute. React only writes it when the
 * prop itself changes, so a reader can still collapse a panel that started open.
 */
function Reasoning({ children, defaultOpen }: { children: string; defaultOpen?: boolean }) {
  return (
    <details className={cn(DETAILS, "border-dashed")} open={defaultOpen}>
      <summary className={SUMMARY}>
        <ChevronRight className={CHEVRON} />
        <Brain className="size-3.5 shrink-0" />
        <span className="font-medium">Thinking</span>
        <span className="min-w-0 flex-1 truncate opacity-70 group-open:hidden">
          {preview(children)}
        </span>
        <span className="ml-auto shrink-0 pl-2 opacity-0 transition-opacity group-hover:opacity-60 group-open:hidden">
          expand
        </span>
      </summary>
      <div className="whitespace-pre-wrap border-t px-3 py-2 text-muted-foreground">{children}</div>
    </details>
  );
}

/** The quiet footnote under a finished turn: throughput, latency, effort. */
/**
 * Suggested next questions, under the reply that prompted them.
 *
 * Only the last message gets them. Chips further up the transcript are answers to questions
 * already moved past, and a column of them turns the chat into a menu.
 */
function Followups({ items, onPick }: { items: string[]; onPick: (text: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5 pt-0.5">
      {items.map((item) => (
        <button
          key={item}
          type="button"
          onClick={() => onPick(item)}
          className="rounded-full border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          {item}
        </button>
      ))}
    </div>
  );
}

function Stats({ stats, pricing }: { stats: TurnStats; pricing?: LlmConfig["pricing"] }) {
  return (
    <p
      className="px-1 text-[11px] tabular-nums text-muted-foreground/70"
      title={`${stats.model} — ${stats.promptTokens.toLocaleString()} prompt + ${stats.completionTokens.toLocaleString()} completion tokens`}
    >
      {statsLine(stats, pricing).join(" · ")}
    </p>
  );
}

/**
 * Everything already on disk.
 *
 * Split out and memoised because it is the expensive half and the half that does not change:
 * a token delta grows the live tail while the stored transcript above it — every markdown
 * body, every tool panel — is identical to the frame before. `messages` only gets a new
 * identity when the session is refetched, which is exactly when this should render again.
 */
const StoredMessages = memo(function StoredMessages({
  messages,
  pricing,
  onFollowup,
}: {
  messages: StoredMessage[];
  pricing?: LlmConfig["pricing"];
  onFollowup?: (text: string) => void;
}) {
  const results = useMemo(() => {
    const map = new Map<string, { content: string; isError: boolean }>();
    for (const item of messages) {
      if (item.role === "tool") {
        map.set(item.tool_call_id, { content: text(item.content), isError: false });
      }
    }
    return map;
  }, [messages]);

  return (
    <>
      {messages.map((item, index) => {
        if (item.role === "tool" || item.role === "system") return null;
        const key = `${item.role}-${index}`;

        if (item.role === "user") {
          return (
            <Bubble key={key} from="user">
              {text(item.content)}
            </Bubble>
          );
        }
        if (item.role !== "assistant") return null;

        const body = text(item.content);
        return (
          <div key={key} className="flex flex-col gap-2">
            {item.reasoning_content ? <Reasoning>{item.reasoning_content}</Reasoning> : null}
            {body ? (
              <Bubble from="assistant">
                <Markdown>{body}</Markdown>
              </Bubble>
            ) : null}
            {(item.tool_calls ?? []).map((call) => {
              if (call.type !== "function") return null;
              const result = results.get(call.id);
              return (
                <ToolCall
                  key={call.id}
                  name={call.function.name}
                  input={call.function.arguments}
                  result={result?.content}
                  isError={result?.isError}
                />
              );
            })}
            {item.stats ? <Stats stats={item.stats} pricing={pricing} /> : null}
            {item.followups?.length && onFollowup && index === messages.length - 1 ? (
              <Followups items={item.followups} onPick={onFollowup} />
            ) : null}
          </div>
        );
      })}
    </>
  );
});

/**
 * One row of the in-flight turn. `applyEvent` rebuilds only the part a delta touches and passes
 * the rest through by reference, so memoising per row means a token lands on the last bubble
 * without re-rendering the tool panels above it.
 */
const LiveRow = memo(function LiveRow({ part }: { part: LivePart }) {
  if (part.kind === "tool") {
    return (
      <ToolCall name={part.name} input={part.input} result={part.result} isError={part.isError} />
    );
  }
  // Thinking that is arriving right now is worth watching; stored thinking is not.
  if (part.kind === "reasoning") return <Reasoning defaultOpen>{part.text}</Reasoning>;
  return (
    <Bubble from="assistant">
      <Markdown>{part.text}</Markdown>
    </Bubble>
  );
});

/** Renders stored turns, then whatever is streaming in right now. */
export function MessageView({
  messages,
  live,
  pricing,
  onFollowup,
}: {
  messages: StoredMessage[];
  live: LivePart[];
  pricing?: LlmConfig["pricing"];
  onFollowup?: (text: string) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <StoredMessages messages={messages} pricing={pricing} onFollowup={onFollowup} />
      {live.map((part) => (
        <LiveRow key={part.key} part={part} />
      ))}
    </div>
  );
}
