import { useCallback, useRef } from "react";

/**
 * A callback whose identity never changes and which always calls the newest `fn`.
 *
 * For a handler passed to a memoised child: it closes over state that changes every render, and
 * handing the child a new function each time would re-render it each time.
 */
export function useStableCallback<Args extends unknown[], Result>(
  fn: (...args: Args) => Result,
): (...args: Args) => Result {
  const latest = useRef(fn);
  latest.current = fn;
  return useCallback((...args: Args) => latest.current(...args), []);
}
