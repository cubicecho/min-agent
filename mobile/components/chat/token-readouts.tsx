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
import { MS_PER_SECOND } from "@shared/consts.ts";
import { CHAT_DEFAULTS } from "@shared/defaults.ts";
import type { LlmConfig, TokenUsage, TurnStats } from "@shared/types.ts";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { DialogLayout } from "@/components/dialog-layout.tsx";
import { EmptyState } from "@/components/empty-state.tsx";
import { PropertyList, PropertyRow } from "@/components/property-list.tsx";
import { BreakdownBar } from "@/components/ui/breakdown-bar";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator.tsx";
import { formatCount } from "@/lib/format";
import { cn } from "@/lib/utils.ts";

/** The small grey line: a readout, a hint, a footnote. */
export const MUTED = "text-muted-foreground text-xs";

/**
 * A colour per part, so the bar and the rows under it are the same thing said twice rather
 * than a legend you have to hold in your head. Hexes, because `BreakdownBar` takes a part's
 * colour as one and lifts or darkens it to show on the theme it is drawn in.
 */
const PART_COLOR: Record<BreakdownPart, string> = {
  // The standing overhead is the blue end, the conversation the warm one, this turn green,
  // and a part's tool traffic is the lighter shade of whatever it belongs to — so the bar
  // reads as three things before it reads as nine.
  system: "#0ea5e9", // sky-500
  guidance: "#38bdf8", // sky-400
  catalogue: "#7dd3fc", // sky-300
  tools: "#8b5cf6", // violet-500
  summary: "#f59e0b", // amber-500
  // Was `bg-primary`, which is black or white by theme and so no colour a hex can name; the
  // deeper amber keeps the conversation the warm one beside its lighter tool traffic.
  history: "#d97706", // amber-600
  historyTools: "#fcd34d", // amber-300
  input: "#10b981", // emerald-500
  inputTools: "#6ee7b7", // emerald-300
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
        <PropertyList
          contentSlot={
            <>
              {usage ? (
                <>
                  <PropertyRow label="Total" value={formatCount(usage.totalTokens)} />
                  <PropertyRow label="Sent" value={formatCount(usage.promptTokens)} />
                  <PropertyRow label="Received" value={formatCount(usage.completionTokens)} />
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
            <BreakdownBar
              parts={rows.map((row) => ({
                label: row.label,
                value: row.tokens,
                color: PART_COLOR[row.key],
                valueLabel: formatTokens(row.tokens),
              }))}
            />
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

/** How full the context window is, warning as it fills. */
export function ContextMeter({ fill }: { fill: NonNullable<ReturnType<typeof contextFill>> }) {
  return (
    <View className="flex-row items-center gap-2">
      <Progress
        value={fill.used}
        max={fill.limit}
        warningAt={fill.limit * CHAT_DEFAULTS.meterWarnShare}
        negativeAt={fill.limit * CHAT_DEFAULTS.meterDangerShare}
        label="Context window"
        valueLabel={`${fill.label}, ${fill.percent}`}
        className="h-1.5 w-16"
      />
      <Text className={MUTED}>{fill.label}</Text>
    </View>
  );
}

/**
 * While a turn streams the server has not reported anything yet, so we show our own
 * clock and a character-derived token estimate — marked "~" so it is never mistaken
 * for the exact numbers that replace it.
 */
export function LiveMeter({
  startedAt,
  live,
  waiting = false,
}: {
  startedAt: number;
  live: LivePart[];
  /** A tool's server has asked the person something, and the turn will not move until they answer. */
  waiting?: boolean;
}) {
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
      {waiting ? (
        <>
          <Text className={MUTED}>·</Text>
          <Text role="status" className="text-warning text-xs">
            Waiting on you
          </Text>
        </>
      ) : null}
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
