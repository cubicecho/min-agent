import "highlight.js/styles/github-dark.css";
import { Check, Copy } from "lucide-react";
import { memo, type ReactNode, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { rehypeHighlight } from "./highlight.ts";

/** Code fence with a copy button; `pre` is replaced wholesale so the button can sit on top. */
function Pre({ children }: { children?: ReactNode }) {
  const ref = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(ref.current?.innerText ?? "");
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }

  return (
    <div className="group relative">
      <pre ref={ref}>{children}</pre>
      <button
        type="button"
        onClick={copy}
        aria-label="Copy code"
        className="absolute right-2 top-2 rounded border bg-background/80 p-1 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
      >
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      </button>
    </div>
  );
}

const COMPONENTS = { pre: Pre };
const REMARK = [remarkGfm];
const REHYPE = [rehypeHighlight];

/**
 * Assistant output is markdown; user input is shown verbatim, so this is only used for replies.
 *
 * Memoised on the text: parsing and highlighting a reply is the most expensive thing in the
 * transcript, and without this every finished reply is re-parsed on every frame of the turn
 * still streaming below it.
 */
export const Markdown = memo(function Markdown({ children }: { children: string }) {
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={REMARK} rehypePlugins={REHYPE} components={COMPONENTS}>
        {children}
      </ReactMarkdown>
    </div>
  );
});
