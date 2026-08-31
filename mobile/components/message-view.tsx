import { Feather } from "@expo/vector-icons";
import type { LivePart } from "@shared/client/live.ts";
import { statsLine } from "@shared/client/usage.ts";
import type { LlmConfig, StoredMessage, TurnStats } from "@shared/types.ts";
import { type ReactNode, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { MarkdownBody } from "@/components/markdown.tsx";
import { useColors } from "@/lib/theme.ts";
import { cn } from "@/lib/utils.ts";

function text(content: StoredMessage["content"]): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => ("text" in part && typeof part.text === "string" ? part.text : ""))
    .join("");
}

function Bubble({ from, children }: { from: "user" | "assistant"; children: ReactNode }) {
  return (
    <View className={cn("flex-row", from === "user" ? "justify-end" : "justify-start")}>
      <View
        className={cn(
          "max-w-[88%] rounded-lg px-3 py-2",
          from === "user" ? "bg-primary" : "bg-muted",
        )}
      >
        {typeof children === "string" ? (
          <Text
            className={cn(
              "text-sm leading-5",
              from === "user" ? "text-primary-foreground" : "text-foreground",
            )}
          >
            {children}
          </Text>
        ) : (
          children
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
 * The web app uses `<details>`; React Native has no equivalent, so open state is held
 * here. Everything else about the two collapsible rows is kept the same.
 */
function Details({
  icon,
  title,
  summary,
  tone,
  defaultOpen,
  children,
}: {
  icon: React.ComponentProps<typeof Feather>["name"];
  title: string;
  summary?: string;
  tone?: "error" | "dashed";
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const colors = useColors();
  const [open, setOpen] = useState(Boolean(defaultOpen));

  return (
    <View
      className={cn(
        "rounded-lg border bg-card",
        tone === "error" ? "border-destructive/40" : "border-border",
        tone === "dashed" && "border-dashed",
      )}
    >
      <Pressable
        onPress={() => setOpen((value) => !value)}
        className="flex-row items-center gap-1.5 px-3 py-2"
      >
        <Feather
          name={open ? "chevron-down" : "chevron-right"}
          size={13}
          color={colors.mutedForeground}
        />
        <Feather
          name={icon}
          size={13}
          color={tone === "error" ? colors.destructive : colors.mutedForeground}
        />
        <Text className="font-medium text-xs text-foreground" numberOfLines={1}>
          {title}
        </Text>
        {!open && summary ? (
          <Text className="flex-1 text-xs text-muted-foreground" numberOfLines={1}>
            {summary}
          </Text>
        ) : null}
      </Pressable>
      {open ? <View className="border-t border-border px-3 py-2">{children}</View> : null}
    </View>
  );
}

const Mono = ({ children, tone }: { children: string; tone?: "error" }) => (
  // Long tool output would otherwise stretch the bubble past the screen.
  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
    <Text
      className={cn(
        "font-mono text-xs",
        tone === "error" ? "text-destructive" : "text-muted-foreground",
      )}
    >
      {children}
    </Text>
  </ScrollView>
);

const Caption = ({ children }: { children: string }) => (
  <Text className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
    {children}
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
      icon={isError ? "alert-circle" : "tool"}
      title={name}
      tone={isError ? "error" : undefined}
      summary={result === undefined ? "running…" : preview(result) || "(no output)"}
    >
      <Caption>arguments</Caption>
      <Mono>{input || "{}"}</Mono>
      {result !== undefined ? (
        <View className="mt-3">
          <Caption>{isError ? "error" : "result"}</Caption>
          <Mono tone={isError ? "error" : undefined}>{result}</Mono>
        </View>
      ) : null}
    </Details>
  );
}

function Reasoning({ children, defaultOpen }: { children: string; defaultOpen?: boolean }) {
  return (
    <Details
      icon="cpu"
      title="Thinking"
      tone="dashed"
      summary={preview(children)}
      defaultOpen={defaultOpen}
    >
      <Text className="text-xs text-muted-foreground">{children}</Text>
    </Details>
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
        <Pressable
          key={item}
          onPress={() => onPick(item)}
          className="rounded-full border border-border px-2.5 py-1 active:bg-accent"
        >
          <Text className="text-xs text-muted-foreground">{item}</Text>
        </Pressable>
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
  const results = new Map<string, { content: string; isError: boolean }>();
  for (const item of messages) {
    if (item.role === "tool") {
      results.set(item.tool_call_id, { content: text(item.content), isError: false });
    }
  }

  return (
    <View className="gap-3">
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
          <View key={key} className="gap-2">
            {item.reasoning_content ? <Reasoning>{item.reasoning_content}</Reasoning> : null}
            {body ? (
              <Bubble from="assistant">
                <MarkdownBody>{body}</MarkdownBody>
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
          </View>
        );
      })}

      {live.map((part) => {
        if (part.kind === "tool") {
          return (
            <ToolCall
              key={part.key}
              name={part.name}
              input={part.input}
              result={part.result}
              isError={part.isError}
            />
          );
        }
        if (part.kind === "reasoning") {
          // Thinking that is arriving right now is worth watching; stored thinking is not.
          return (
            <Reasoning key={part.key} defaultOpen>
              {part.text}
            </Reasoning>
          );
        }
        return (
          <Bubble key={part.key} from="assistant">
            <MarkdownBody>{part.text}</MarkdownBody>
          </Bubble>
        );
      })}
    </View>
  );
}
