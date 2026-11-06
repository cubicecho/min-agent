import { MS_PER_MINUTE } from "@shared/consts.ts";
import { UPDATE_DEFAULTS } from "@shared/defaults.ts";
import * as Updates from "expo-updates";
import { useEffect } from "react";
import { AppState, Platform } from "react-native";

/**
 * Whether this build takes over-the-air updates at all.
 *
 * A Metro-attached build serves its own JavaScript and `checkForUpdateAsync` refuses outright
 * there; a browser has the page's own reload, and the desktop build carries its own copy. Only an
 * installed Android build has anything to fetch.
 */
export const UPDATABLE = Platform.OS !== "web" && Updates.isEnabled && __DEV__ === false;

const CHECK_EVERY = UPDATE_DEFAULTS.foregroundCheckMinutes * MS_PER_MINUTE;

/** When the server was last asked. Starts at launch, because expo-updates asks then by itself. */
let lastCheck = Date.now();

/** Asks for an update and downloads it if there is one. Restarting into it is the reader's call. */
async function checkAndFetch() {
  lastCheck = Date.now();
  const found = await Updates.checkForUpdateAsync();
  if (found.isAvailable) {
    await Updates.fetchUpdateAsync();
  }
}

/**
 * Looks for an update each time the app comes back to the screen, at most once every
 * `foregroundCheckMinutes`, and downloads it in the background.
 *
 * What it finds reaches the screen through `Updates.useUpdates()`, which follows these calls as
 * well as the launch check. A failed check is not shown here: it is `checkError` there, and the
 * Device panel's own Check button says what went wrong when someone asks.
 *
 * Mount it only where `UPDATABLE` is true; anywhere else the calls reject.
 */
export function useForegroundUpdateCheck() {
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      const isDue = state === "active" && Date.now() - lastCheck >= CHECK_EVERY;
      if (isDue) {
        checkAndFetch().catch(() => {});
      }
    });
    return () => subscription.remove();
  }, []);
}
