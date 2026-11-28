import { Text, View } from "react-native";
import { ColorDot } from "@/components/ui/color-dot";
import { useSurfaceColors } from "@/components/ui/surface-colors";
import { hexToAccent } from "@/lib/color";
import { cn } from "@/lib/utils";

/** One part of the whole. */
export type BreakdownPart = {
  /** What the part is, as its row in the legend says it: "System prompt", "Focus". */
  label: string;
  /**
   * How much of the whole it is, in any unit, since a share is of the parts' sum: tokens,
   * seconds, bytes. A part of 0 keeps its row in the legend and draws nothing in the bar.
   */
  value: number;
  /**
   * The part's colour, as a hex a tag or a kind was given. It is made just light or dark enough to
   * show on the page and a card of the theme it is drawn in, as `ColorDot`'s is. Any other CSS
   * colour is drawn as given.
   */
  color: string;
  /**
   * The amount in words, in the part's row before its share: "12.4k", "1h 20m". Left out, the row
   * says the share alone.
   */
  valueLabel?: string | undefined;
};

export type BreakdownBarProps = {
  /** The parts, in the order the bar draws them from its start and the legend lists them. */
  parts: readonly BreakdownPart[];
  /** On the whole: the bar and the legend under it. */
  className?: string | undefined;
};

const PERCENT = 100;

/** The parts' sum, and each part's share of it as a percentage; every share is 0 when it is. */
function sharesOf(parts: readonly BreakdownPart[]): { total: number; shares: number[] } {
  const amounts = parts.map((part) =>
    Number.isFinite(part.value) && part.value > 0 ? part.value : 0,
  );
  const total = amounts.reduce((sum, amount) => sum + amount, 0);
  const shares = amounts.map((amount) => (total === 0 ? 0 : (amount / total) * PERCENT));
  return { total, shares };
}

/** A whole split into its parts: a bar of shares, and a legend naming each part. */
export function BreakdownBar({ parts, className }: BreakdownBarProps) {
  const [drawnIn, surfaces] = useSurfaceColors();
  const { total, shares } = sharesOf(parts);

  return (
    <View testID="breakdown-bar" className={cn("gap-2", className)}>
      <View
        ref={(node) => {
          drawnIn.current = node;
        }}
        testID="breakdown-bar-track"
        aria-hidden
        className="h-2 w-full flex-row gap-0.5 overflow-hidden rounded-full"
      >
        {total === 0 ? (
          // Nothing measured: the empty track, so the bar is there and reads as empty.
          <View className="h-full w-full bg-foreground/10" />
        ) : (
          parts.map((part, index) =>
            shares[index] === 0 ? null : (
              <View
                key={part.label}
                testID="breakdown-bar-part"
                className="h-full"
                // A grow rather than a width, so the 2px between the parts comes out of them all.
                style={{
                  flexGrow: shares[index],
                  flexBasis: 0,
                  backgroundColor: hexToAccent(part.color, surfaces) ?? part.color,
                }}
              />
            ),
          )
        )}
      </View>
      <View testID="breakdown-bar-legend" role="list" className="gap-1">
        {parts.map((part, index) => (
          <View key={part.label} role="listitem" className="flex-row items-center gap-2">
            <ColorDot color={part.color} />
            <Text className="flex-1 text-sm text-foreground">{part.label}</Text>
            {part.valueLabel === undefined ? null : (
              <Text className="text-sm text-foreground tabular-nums">{part.valueLabel}</Text>
            )}
            {/* Last and of one width, so the shares are a column and the amounts end against it. */}
            <Text className="w-10 text-right text-sm text-foreground/60 tabular-nums">
              {`${Math.round(shares[index] ?? 0)}%`}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}
