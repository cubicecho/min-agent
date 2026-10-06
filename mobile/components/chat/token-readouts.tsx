import { type LivePart, liveCharCount } from "@shared/client/live.ts";
import {
  type BreakdownPart,
  breakdownRows,
  contextFill,
  costOf,
  formatDuration,
  formatRate,
  formatTokens,
} from "@shared/client/usage.ts";
import { CHAT_DEFAULTS } from "@shared/defaults.ts";
import type { LlmConfig, TokenUsage, TurnStats } from "@shared/types.ts";
import { MS_PER_SECOND, PERCENT } from "@shared/units.ts";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { DescriptionList, PropertyRow } from "@/components/description-list.tsx";
import { DialogLayout } from "@/components/dialog-layout.tsx";
import { EmptyState } from "@/components/page.tsx";
import { Separator } from "@/components/ui/separator.tsx";
import { cn } from "@/lib/utils.ts";

/** The small grey line: a readout, a hint, a footnote. */
export const MUTED = "text-muted-foreground text-xs";

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
export function TokensDialog({
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
                  style={{ width: `${row.ratio * PERCENT}%` }}
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
                    {Math.round(row.ratio * PERCENT)}%
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
        const isClosing = open === false;
        if (isClosing) {
          onClose();
        }
      }}
      title="Tokens"
      contentSlot={<View className="gap-3">{body}</View>}
    />
  );
}

/** The meter's colour, which warns as the window fills. */
function meterTone(ratio: number) {
  if (ratio > CHAT_DEFAULTS.meterDangerShare) {
    return "bg-destructive";
  }
  if (ratio > CHAT_DEFAULTS.meterWarnShare) {
    return "bg-amber-500";
  }
  return "bg-primary";
}

export function ContextMeter({ fill }: { fill: NonNullable<ReturnType<typeof contextFill>> }) {
  const tone = meterTone(fill.ratio);
  return (
    <View className="flex-row items-center gap-2">
      <View className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
        <View
          className={cn("h-full rounded-full", tone)}
          style={{ width: `${fill.ratio * PERCENT}%` }}
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
export function LiveMeter({ startedAt, live }: { startedAt: number; live: LivePart[] }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), CHAT_DEFAULTS.liveMeterTickMs);
    return () => clearInterval(timer);
  }, []);

  if (!startedAt) {
    return null;
  }
  const elapsed = Math.max(now - startedAt, 0);
  const tokens = Math.round(liveCharCount(live) / CHAT_DEFAULTS.charsPerToken);
  const seconds = elapsed / MS_PER_SECOND;

  return (
    <View className="mt-2 flex-row items-center gap-2">
      <Text className={MUTED}>{formatDuration(elapsed)}</Text>
      {tokens > 0 ? (
        <>
          <Text className={MUTED}>·</Text>
          <Text className={MUTED}>~{formatTokens(tokens)} tok</Text>
          {seconds > CHAT_DEFAULTS.rateAfterSeconds ? (
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
