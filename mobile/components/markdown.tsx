import Markdown, { type RenderRules } from "@ronradtke/react-native-markdown-display";
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
  link: { color: colors.foreground, textDecorationLine: "underline" as const },
  bullet_list: { marginBottom: 8 },
  ordered_list: { marginBottom: 8 },
  code_inline: {
    backgroundColor: colors.muted,
    color: colors.foreground,
    borderRadius: 4,
    paddingHorizontal: 4,
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

export function MarkdownBody({ children }: { children: string }) {
  return (
    <Markdown style={styles} rules={rules}>
      {children}
    </Markdown>
  );
}
