import { tokenizeLines } from "@shared/highlight.ts";
import { memo } from "react";
import { ScrollView, Text, View } from "react-native";
import { CopyButton } from "@/components/ui.tsx";
import { colors, syntax } from "@/lib/theme.ts";

/**
 * A fenced code block, syntax-highlighted.
 *
 * The tokenising is `shared/highlight.ts` — the same lowlight registry as ever, kept
 * out of here so it stays testable from the root test runner, which cannot load a React Native
 * component. This file is only the part that has to be React Native: `<Text>` spans in place of
 * the `hljs-*` classes a stylesheet would have coloured.
 *
 * Lines are laid out one row each rather than as a single string, because there is no
 * `white-space: pre` here — a long line has to scroll sideways, and it can only do that if the
 * row it is in is a thing that scrolls.
 *
 * Memoised because the tokenising is the expensive part of drawing a message and almost none
 * of it is ever needed twice: a streaming reply re-renders every frame, and without this each
 * frame re-highlights every fence in it — including the ones the model finished writing
 * seconds ago. Both props are strings, so a fence whose text has stopped changing costs
 * nothing to leave on screen.
 */
export const CodeBlock = memo(function CodeBlock({
  code,
  language,
}: {
  code: string;
  language?: string | null;
}) {
  // A fence usually ends in a newline, which would otherwise render as a blank final row.
  const lines = tokenizeLines(code.replace(/\n$/, ""), language);

  return (
    <View
      style={{
        backgroundColor: colors.muted,
        borderColor: colors.border,
        borderWidth: 1,
        borderRadius: 8,
        marginBottom: 8,
      }}
    >
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ padding: 10 }}
      >
        <View>
          {lines.map((tokens, line) => (
            <Text
              // A line's identity is its position: rows never reorder, insert or delete,
              // because the only thing that changes them is new code, replacing all of them.
              // biome-ignore lint/suspicious/noArrayIndexKey: a row is identified by position
              key={line}
              style={{ fontFamily: "monospace", fontSize: 12, lineHeight: 18 }}
            >
              {tokens.map((token, position) => (
                <Text
                  // biome-ignore lint/suspicious/noArrayIndexKey: likewise within a line
                  key={position}
                  style={{ color: (token.scope && syntax[token.scope]) || colors.foreground }}
                >
                  {token.text}
                </Text>
              ))}
              {/* An empty line still needs a glyph's worth of height. */}
              {tokens.length === 0 ? " " : null}
            </Text>
          ))}
        </View>
      </ScrollView>

      {/*
        Over the code rather than beside it: the fence is as wide as the message and the rows
        inside it scroll sideways, so there is no column to put this in that a long line will
        not run under. It sits outside the scroller so it stays put, and carries the block's
        own background so it masks the line it covers instead of tangling with it.
      */}
      <View style={{ position: "absolute", right: 4, top: 4 }}>
        <CopyButton text={code} label="Copy code" className="bg-muted" />
      </View>
    </View>
  );
});
