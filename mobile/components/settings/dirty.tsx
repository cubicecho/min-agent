import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { SettingsTab } from "./tabs.ts";

/**
 * Which panels are holding something typed and unsaved.
 *
 * The panels stay mounted once visited, so a draft survives a trip to another tab — which is
 * the point, but it also means a form can be left half-typed behind a tab that looks idle.
 * Each panel reports up, and the tab row draws a dot. Nothing here blocks anything: leaving a
 * draft is allowed, and the dot is only there so you know you did.
 */

type Report = (tab: SettingsTab, dirty: boolean) => void;

const DirtyContext = createContext<Report>(() => {});

export const DirtyProvider = DirtyContext.Provider;

/** Held by the settings shell, which owns the map the tab row reads. */
export function useDirtyPanels() {
  const [dirty, setDirty] = useState<Partial<Record<SettingsTab, boolean>>>({});
  // Identity matters: it is a dependency of the effect below, and a new function every render
  // would report on every render.
  const report = useCallback<Report>((tab, value) => {
    setDirty((current) =>
      Boolean(current[tab]) === value ? current : { ...current, [tab]: value },
    );
  }, []);
  return { dirty, report };
}

/** Called by a panel with its own answer to "is there anything unsaved in here". */
export function useReportDirty(tab: SettingsTab, dirty: boolean) {
  const report = useContext(DirtyContext);
  useEffect(() => report(tab, dirty), [report, tab, dirty]);
  // A panel that goes away takes its dot with it, however it left.
  useEffect(() => () => report(tab, false), [report, tab]);
}
