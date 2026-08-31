import { useCallback, useEffect, useRef, useState } from "react";
import type { StreamEvent } from "../types.ts";
import { applyEvent, type LivePart } from "./live.ts";

/**
 * The in-flight turn, repainted at most once a frame.
 *
 * A fast model sends token deltas far quicker than a screen can show them — several hundred a
 * second is ordinary — and setting state on each one asks React to render the whole transcript
 * that many times. The frames are dropped either way; the work is not. So events are collected
 * in a ref and folded in together on the next animation frame, which turns a burst of thirty
 * deltas into one render showing the same text.
 *
 * Batching in a ref also keeps the fold correct under React 18's automatic batching, where
 * several `setState(fn)` calls in one tick would otherwise each re-run `applyEvent` against a
 * queued value rather than a rendered one.
 */
export function useLiveParts() {
  const [parts, setParts] = useState<LivePart[]>([]);
  const queued = useRef<StreamEvent[]>([]);
  const frame = useRef<ReturnType<typeof requestAnimationFrame> | null>(null);

  const flush = useCallback(() => {
    frame.current = null;
    const batch = queued.current;
    if (!batch.length) return;
    queued.current = [];
    setParts((current) => batch.reduce(applyEvent, current));
  }, []);

  const push = useCallback(
    (event: StreamEvent) => {
      queued.current.push(event);
      if (frame.current === null) frame.current = requestAnimationFrame(flush);
    },
    [flush],
  );

  /** Between turns: drop what was showing and anything still queued for a frame that has not run. */
  const reset = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    queued.current = [];
    setParts([]);
  }, []);

  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );

  return { parts, push, reset };
}
