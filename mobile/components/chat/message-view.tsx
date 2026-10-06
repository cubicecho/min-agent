import type { LivePart } from "@shared/client/live.ts";
import { messageText } from "@shared/client/transcript.ts";
import { statsLine } from "@shared/client/usage.ts";
import { shownCall } from "@shared/tool-proxy.ts";
import type { HookNote, LlmConfig, StoredMessage, TurnStats } from "@shared/types.ts";
import { INJECT_EVENTS } from "@shared/types.ts";
import { type ComponentType, memo, type ReactNode, useMemo, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { ActionButton } from "@/components/action-button";
import { Cpu, Volume2, Wrench, Zap } from "@/components/app/app-icons";
import { MarkdownBody } from "@/components/chat/markdown.tsx";
import { DisclosureRow } from "@/components/disclosure-row";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { CircleAlert, Pencil, RefreshCw, Square } from "@/components/ui/icons";
import { cn, type SlotNode } from "@/lib/utils.ts";

type Glyph = ComponentType<{ className?: string; "aria-hidden"?: boolean }>;

/** A bubble holds either plain words or something already drawn — markdown, for a reply. */
function Bubble({
  from,
  aside,
  text,
  content,
}: {
  from: "user" | "assistant";
  /** Sits outside the bubble, on the side the bubble is not: the edit button on a question. */
  aside?: ReactNode;
  text?: string;
  content?: ReactNode;
}) {
  return (
    <View
      className={cn(
        "flex-row items-center gap-1",
        from === "user" ? "justify-end" : "justify-start",
      )}
    >
      {aside}
      <View
        className={cn(
          "max-w-[88%] rounded-lg px-3 py-2",
          from === "user" ? "bg-primary" : "bg-muted",
        )}
      >
        {content ?? (
          <Text
            className={cn(
              "text-sm leading-5",
              from === "user" ? "text-primary-foreground" : "text-foreground",
            )}
          >
            {text}
          </Text>
        )}
      </View>
    </View>
  );
}

/** Collapsed rows show a one-line taste of what is inside, so they read as openable. */
function preview(value: string, limit = 60) {
  const line = value.replace(/\s+/g, " ").trim();
  return line.length > limit ? `${line.slice(0, limit - 1)}…` : line;
}

/**
 * The collapsible rows of a transcript — a tool call, thinking, what a hook added. The row is
 * cubeui's; what is held here is whether it is open, since nothing outside a row opens it.
 */
function Details({
  icon: Icon,
  title,
  summary,
  tone,
  defaultOpen,
  content,
}: {
  icon: Glyph;
  title: string;
  summary?: string;
  tone?: "error" | "dashed";
  defaultOpen?: boolean;
  content: SlotNode;
}) {
  const [open, setOpen] = useState(Boolean(defaultOpen));

  return (
    <DisclosureRow
      open={open}
      onOpenChange={setOpen}
      badgesSlot={
        <Icon
          aria-hidden
          className={cn(
            "size-3.5",
            tone === "error" ? "text-destructive" : "text-muted-foreground",
          )}
        />
      }
      title={title}
      // Only while closed: once the row is open the whole of it is right underneath.
      description={!open && summary ? summary : undefined}
      contentSlot={content}
      className={cn(
        "bg-card",
        tone === "error" && "border-destructive/40",
        tone === "dashed" && "border-dashed",
      )}
    />
  );
}

const Mono = ({ text, tone }: { text: string; tone?: "error" }) => (
  // Long tool output would otherwise stretch the bubble past the screen.
  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
    <Text
      className={cn(
        "font-mono text-xs",
        tone === "error" ? "text-destructive" : "text-muted-foreground",
      )}
    >
      {text}
    </Text>
  </ScrollView>
);

const Caption = ({ text }: { text: string }) => (
  <Text className="mb-1 font-medium text-[10px] text-muted-foreground/70 uppercase tracking-wide">
    {text}
  </Text>
);

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
    <Details
      icon={isError ? CircleAlert : Wrench}
      title={name}
      tone={isError ? "error" : undefined}
      summary={result === undefined ? "running…" : preview(result) || "(no output)"}
      content={
        <>
          <View>
            <Caption text="arguments" />
            <Mono text={input || "{}"} />
          </View>
          {result !== undefined ? (
            <View className="mt-1">
              <Caption text={isError ? "error" : "result"} />
              <Mono text={result} tone={isError ? "error" : undefined} />
            </View>
          ) : null}
        </>
      }
    />
  );
}

function Reasoning({ text, defaultOpen }: { text: string; defaultOpen?: boolean }) {
  return (
    <Details
      icon={Cpu}
      title="Thinking"
      tone="dashed"
      summary={preview(text)}
      defaultOpen={defaultOpen}
      content={<Text className="text-muted-foreground text-xs">{text}</Text>}
    />
  );
}

/**
 * Suggested next questions, under the reply that prompted them. Only the last message
 * gets them — chips further up are answers to questions already moved past.
 */
function Followups({ items, onPick }: { items: string[]; onPick: (text: string) => void }) {
  return (
    <View className="flex-row flex-wrap gap-1.5">
      {items.map((item) => (
        <Button
          key={item}
          variant="outline"
          size="xs"
          className="h-auto rounded-full py-1"
          onPress={() => onPick(item)}
          content={item}
        />
      ))}
    </View>
  );
}

/** The quiet footnote under a finished turn: throughput, latency, effort. */
const Stats = ({ stats, pricing }: { stats: TurnStats; pricing?: LlmConfig["pricing"] }) => (
  <Text className="px-1 text-[11px] text-muted-foreground/70">
    {statsLine(stats, pricing).join(" · ")}
  </Text>
);

/**
 * What one of the MCP servers' hooks did for a turn: the context it added, or why it did not.
 *
 * Context opens like thinking does, since it is what the model read ahead of the question. A
 * failure, or a note stored before notes kept their text, is a line: there is nothing to open.
 */
const HookLine = ({ hook }: { hook: HookNote }) =>
  hook.text ? (
    <Details
      icon={Zap}
      title={`${hook.source} · added ~${hook.tokens ?? 0} tokens`}
      tone="dashed"
      summary={preview(hook.text)}
      content={<Text className="text-muted-foreground text-xs">{hook.text}</Text>}
    />
  ) : (
    <View className="flex-row items-center gap-1.5 px-1">
      {hook.error ? (
        <CircleAlert aria-hidden className="size-3 text-destructive" />
      ) : (
        <Zap aria-hidden className="size-3 text-muted-foreground" />
      )}
      <Text
        className={cn(
          "flex-1 text-[11px]",
          hook.error ? "text-destructive" : "text-muted-foreground/70",
        )}
        numberOfLines={1}
      >
        {hook.error
          ? `${hook.source} · ${hook.hookId} failed: ${hook.error}`
          : `${hook.source} · added ~${hook.tokens ?? 0} tokens`}
      </Text>
    </View>
  );

/**
 * Everything already on disk.
 *
 * Split out and memoised because it is the expensive half and the half that does not change:
 * a token delta grows the live tail while the stored transcript above it — every markdown
 * body, every tool panel — is identical to the frame before.
 */
const StoredMessages = memo(function StoredMessages({
  messages,
  pricing,
  onFollowup,
  onRetry,
  onEdit,
  onSpeak,
  speakingIndex,
}: {
  messages: StoredMessage[];
  pricing?: LlmConfig["pricing"];
  onFollowup?: (text: string) => void;
  /** Run the turn this message belongs to again. Absent while one is already running. */
  onRetry?: (index: number) => void;
  /** Put this question back in the composer, and forget everything after it. */
  onEdit?: (index: number) => void;
  /** Read this reply out, or stop reading it. Absent where no voice is available. */
  onSpeak?: (index: number, text: string) => void;
  /** Which reply is being read right now, so its button offers to stop instead. */
  speakingIndex?: number | null;
}) {
  const results = useMemo(() => {
    const map = new Map<string, { content: string; isError: boolean }>();
    for (const item of messages) {
      if (item.role === "tool") {
        map.set(item.tool_call_id, { content: messageText(item), isError: false });
      }
    }
    return map;
  }, [messages]);

  return (
    <>
      {messages.map((item, index) => {
        if (item.role === "tool" || item.role === "system") {
          return null;
        }
        const key = `${item.role}-${index}`;

        if (item.role === "user") {
          return (
            <Bubble
              key={key}
              from="user"
              // Outside the bubble rather than under it: a row of its own beneath every
              // question would double the space a short exchange takes up.
              aside={
                onEdit ? (
                  <ActionButton
                    variant="ghost"
                    size="icon-sm"
                    label="Edit this message"
                    onPress={() => onEdit(index)}
                    iconSlot={<Pencil aria-hidden className="size-3.5 text-muted-foreground" />}
                  />
                ) : null
              }
              text={messageText(item)}
            />
          );
        }
        if (item.role !== "assistant") {
          return null;
        }

        const body = messageText(item);
        // Where the live turn had them: a hook that ran ahead of the question is noted ahead of
        // the answer, and one that reported after it stays under it.
        const hooks = item.stats?.hooks ?? [];
        const before = hooks.filter((hook) => INJECT_EVENTS.has(hook.event));
        const after = hooks.filter((hook) => !INJECT_EVENTS.has(hook.event));
        return (
          <View key={key} className="gap-2">
            {before.map((hook) => (
              <HookLine key={`${hook.event}-${hook.source}-${hook.hookId}`} hook={hook} />
            ))}
            {item.reasoning_content ? <Reasoning text={item.reasoning_content} /> : null}
            {body ? <Bubble from="assistant" content={<MarkdownBody text={body} />} /> : null}
            {(item.tool_calls ?? []).map((call) => {
              if (call.type !== "function") {
                return null;
              }
              const result = results.get(call.id);
              const shown = shownCall(call.function.name, call.function.arguments);
              return (
                <ToolCall
                  key={call.id}
                  name={shown.name}
                  input={shown.input}
                  result={result?.content}
                  isError={result?.isError}
                />
              );
            })}
            {/*
              The markdown as the model wrote it, not as it is drawn: what you want out of a
              reply is usually the thing you are about to paste somewhere that renders it.
            */}
            {body || item.stats ? (
              <View className="flex-row items-center gap-1">
                {body ? <CopyButton value={body} label="Copy reply" /> : null}
                {onRetry ? (
                  <ActionButton
                    variant="ghost"
                    size="icon-sm"
                    label="Retry this reply"
                    onPress={() => onRetry(index)}
                    iconSlot={<RefreshCw aria-hidden className="size-3.5 text-muted-foreground" />}
                  />
                ) : null}
                {/*
                  One button for both directions: whatever is being read is the only thing
                  that can be stopped, so pressing it again is the way to stop it.
                */}
                {onSpeak && body ? (
                  <ActionButton
                    variant="ghost"
                    size="icon-sm"
                    label={speakingIndex === index ? "Stop reading" : "Read this reply aloud"}
                    onPress={() => onSpeak(index, body)}
                    iconSlot={
                      speakingIndex === index ? (
                        <Square aria-hidden className="size-3.5 text-muted-foreground" />
                      ) : (
                        <Volume2 aria-hidden className="size-3.5 text-muted-foreground" />
                      )
                    }
                  />
                ) : null}
                {item.stats ? <Stats stats={item.stats} pricing={pricing} /> : null}
              </View>
            ) : null}
            {after.map((hook) => (
              <HookLine key={`${hook.event}-${hook.source}-${hook.hookId}`} hook={hook} />
            ))}
            {item.followups?.length && onFollowup && index === messages.length - 1 ? (
              <Followups items={item.followups} onPick={onFollowup} />
            ) : null}
          </View>
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
  if (part.kind === "hook") {
    return <HookLine hook={part.hook} />;
  }
  // Thinking that is arriving right now is worth watching; stored thinking is not.
  if (part.kind === "reasoning") {
    return <Reasoning defaultOpen text={part.text} />;
  }
  return <Bubble from="assistant" content={<MarkdownBody text={part.text} />} />;
});

/**
 * Renders stored turns, the question that has not been written down yet, and then whatever is
 * streaming in right now — in that order, because that is the order they will be in once the
 * turn is stored and read back.
 */
export function MessageView({
  messages,
  pending,
  live,
  pricing,
  onFollowup,
  onRetry,
  onEdit,
  onSpeak,
  speakingIndex,
}: {
  messages: StoredMessage[];
  /**
   * The question this turn is answering, until the stored transcript has it. Held here rather
   * than left to the refetch so that the reply streams in under the question that asked for it.
   */
  pending?: string | null;
  live: LivePart[];
  pricing?: LlmConfig["pricing"];
  onFollowup?: (text: string) => void;
  onRetry?: (index: number) => void;
  onEdit?: (index: number) => void;
  onSpeak?: (index: number, text: string) => void;
  speakingIndex?: number | null;
}) {
  return (
    <View className="gap-3">
      <StoredMessages
        messages={messages}
        pricing={pricing}
        onFollowup={onFollowup}
        onRetry={onRetry}
        onEdit={onEdit}
        onSpeak={onSpeak}
        speakingIndex={speakingIndex}
      />
      {/* Dimmed: it is on screen before the server has said it has it. */}
      {pending ? (
        <View className="opacity-70">
          <Bubble from="user" text={pending} />
        </View>
      ) : null}
      {live.map((part) => (
        <LiveRow key={part.key} part={part} />
      ))}
    </View>
  );
}
