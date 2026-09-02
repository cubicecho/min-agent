import Markdown, { type RenderRules } from "@ronradtke/react-native-markdown-display";
import { memo } from "react";
import { CodeBlock } from "@/components/code-block.tsx";
import { colors } from "@/lib/theme.ts";

/**
 * Assistant replies render as markdown inside a chat bubble, so the styles here are
 * tuned for a narrow column.
 * The renderer takes a style object rather than classes, so this cannot be shared.
 */
const styles = {
  body: { color: colors.foreground, fontSize: 14, lineHeight: 20 },
  paragraph: { marginTop: 0, marginBottom: 8 },
  heading1: { fontSize: 18, fontWeight: "600" as const, marginBottom: 6 },
  heading2: { fontSize: 16, fontWeight: "600" as const, marginBottom: 6 },
  heading3: { fontSize: 15, fontWeight: "600" as const, marginBottom: 6 },
  // `marginBottom` is zeroed for the same reason the padding below is: the library's own
  // `link` default carries `marginBottom: -4`, which rides a link a few pixels out of its line.
  link: {
    color: colors.foreground,
    textDecorationLine: "underline" as const,
    marginBottom: 0,
  },
  bullet_list: { marginBottom: 8 },
  ordered_list: { marginBottom: 8 },
  code_inline: {
    backgroundColor: colors.muted,
    color: colors.foreground,
    borderRadius: 4,
    // The library merges its own defaults under these, and its `code_inline` carries
    // `padding: 10` and a light `borderWidth: 1`. Vertical padding on a span inside a
    // line of text makes its background taller than the line, so chips on neighbouring
    // lines overlap; both defaults have to be turned off by name, not just written over
    // with `paddingHorizontal`.
    padding: 0,
    paddingHorizontal: 4,
    borderWidth: 0,
    fontFamily: "monospace" as const,
    fontSize: 13,
  },
  fence: {
    backgroundColor: colors.muted,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    color: colors.foreground,
    fontFamily: "monospace" as const,
    fontSize: 12,
  },
  code_block: {
    backgroundColor: colors.muted,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    color: colors.foreground,
    fontFamily: "monospace" as const,
    fontSize: 12,
  },
  blockquote: {
    backgroundColor: "transparent",
    borderLeftWidth: 2,
    borderColor: colors.border,
    paddingLeft: 10,
    marginLeft: 0,
  },
  hr: { backgroundColor: colors.border, height: 1 },
  table: { borderColor: colors.border },
  tr: { borderColor: colors.border },
};

/**
 * Fenced code is rendered by hand so it can be highlighted; everything else keeps the
 * library's own rule. A fence's info string is `ts title="x"` at its most elaborate, so the
 * language is the first word of it — the same reading the rule being replaced does.
 */
const rules: RenderRules = {
  fence: (node) => (
    <CodeBlock
      key={node.key}
      code={node.content}
      language={typeof node.sourceInfo === "string" ? node.sourceInfo.trim().split(/\s+/)[0] : null}
    />
  ),
  // An indented block has no language to declare, so it goes to auto-detection.
  code_block: (node) => <CodeBlock key={node.key} code={node.content} />,
};

/**
 * Memoised on the text, which is the whole of its input: the library re-parses the string on
 * every render, and the transcript re-renders for reasons that have nothing to do with what
 * any message says — a reply starting to be read aloud, a turn finishing and being read back.
 * Every stored body was re-parsed on each of those.
 */
export const MarkdownBody = memo(function MarkdownBody({ children }: { children: string }) {
  return (
    <Markdown style={styles} rules={rules}>
      {children}
    </Markdown>
  );
});
