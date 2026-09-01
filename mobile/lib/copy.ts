import * as Clipboard from "expo-clipboard";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Copying text, and saying that it worked.
 *
 * There is nowhere to put a toast in this app and nothing that owns one, so the confirmation
 * is the button itself: it turns into a tick for a moment and then goes back to offering. The
 * tick only appears if the write actually happened — a browser can refuse the clipboard, and
 * a button that lies about it is worse than one that does nothing.
 */

/** How long the button says it worked before going back to offering. */
const CONFIRM_FOR = 1500;

export function useCopy() {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The timer outlives the component otherwise, and fires setState into nothing.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const copy = useCallback(async (text: string) => {
    const ok = await Clipboard.setStringAsync(text).catch(() => false);
    if (!ok) return;
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), CONFIRM_FOR);
  }, []);

  return { copied, copy };
}
