import * as Updates from "expo-updates";
import { useState } from "react";
import { Platform, Text, View } from "react-native";
import {
  Badge,
  Button,
  Card,
  CardDescription,
  CardTitle,
  Muted,
  Screen,
  Switch,
} from "@/components/ui.tsx";
import { setVoiceSettings, useVoiceSettings } from "@/lib/voice-settings.ts";

/**
 * The settings that belong to this install rather than to the agent.
 *
 * Everything on the other panels is stored on the server and is the same for every client
 * that talks to it. These two are not: whether dictation sends for you is about how you are
 * holding the thing, and which JavaScript this binary is running is about this binary. They
 * live in the device's own storage, and this is where they are set.
 */

/** What the update button is doing, and what it last found out. */
type Progress =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "downloading" }
  | { kind: "none" }
  | { kind: "ready" }
  | { kind: "failed"; detail: string };

/**
 * Whether there is anything for the update button to do.
 *
 * A Metro-attached build serves its own JavaScript and `checkForUpdateAsync` refuses outright
 * there; a browser has the page's own reload. Neither is a failure worth a red badge, so the
 * card says which one it is and drops the button rather than offering one that throws.
 */
const updatable = Platform.OS !== "web" && Updates.isEnabled && !__DEV__;

/** The running update, in the four facts that identify it. */
function Running() {
  const built = Updates.createdAt;
  const id = Updates.updateId;
  return (
    <View className="gap-1">
      <Muted>
        {Updates.channel ? `Channel ${Updates.channel}` : "No channel"} · runtime{" "}
        {Updates.runtimeVersion || "unknown"}
      </Muted>
      <Muted>
        {id ? `Update ${id.slice(0, 8)}` : "The JavaScript this app was built with"}
        {built ? ` · ${built.toLocaleString()}` : ""}
      </Muted>
    </View>
  );
}

export function DevicePanel() {
  const voice = useVoiceSettings();
  const [progress, setProgress] = useState<Progress>({ kind: "idle" });

  /**
   * Check, and download what there is to download — one press rather than two, because an
   * update you have been told about and not taken is not a state anybody wants to be left in.
   * Restarting is still a decision: it throws away whatever is half-typed on the screen behind
   * this one, so it gets its own button.
   */
  const check = async () => {
    setProgress({ kind: "checking" });
    try {
      const found = await Updates.checkForUpdateAsync();
      if (!found.isAvailable) {
        setProgress({ kind: "none" });
        return;
      }
      setProgress({ kind: "downloading" });
      await Updates.fetchUpdateAsync();
      setProgress({ kind: "ready" });
    } catch (error) {
      setProgress({
        kind: "failed",
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const busy = progress.kind === "checking" || progress.kind === "downloading";

  return (
    <Screen>
      <Card>
        <CardTitle>Dictation</CardTitle>
        <CardDescription>
          What the microphone button does when it finishes. Stored on this device, not on the
          server, so each phone and tablet answers for itself.
        </CardDescription>

        <View className="flex-row items-center gap-3">
          <Switch
            value={voice.autoSend}
            onValueChange={(autoSend) => void setVoiceSettings({ autoSend })}
          />
          <Text className="flex-1 text-sm text-foreground">
            Send as soon as the microphone is done
          </Text>
        </View>

        {/* Which is not the same moment on both engines, and the difference is the whole
            question of whether you have to touch the phone again. */}
        <Muted>
          Android's recogniser decides that itself, when you stop talking — so with this on, a
          message can be spoken and sent without touching the phone again. A transcription model
          records until you press the button a second time, and sends then.
        </Muted>
        <Muted>
          With this off the button is the only thing that sends, and what was said is added to
          whatever is already in the box — so a message can be dictated in as many goes as it takes.
        </Muted>
      </Card>

      <Card>
        <CardTitle>Updates</CardTitle>
        <CardDescription>
          This app installs its JavaScript over the air: a change that does not touch the native
          side is published as an update and picked up on the next launch. This is how to pick one
          up without waiting for that.
        </CardDescription>

        <Running />

        {updatable ? (
          <>
            <View className="flex-row gap-2">
              <Button onPress={check} busy={busy} icon="download">
                {progress.kind === "downloading" ? "Downloading" : "Check for updates"}
              </Button>
              {progress.kind === "ready" ? (
                <Button
                  variant="outline"
                  icon="refresh-cw"
                  onPress={() => void Updates.reloadAsync()}
                >
                  Restart now
                </Button>
              ) : null}
            </View>

            {progress.kind === "none" ? <Muted>Already up to date.</Muted> : null}
            {progress.kind === "ready" ? (
              <View className="flex-row items-center gap-2">
                <Badge variant="secondary">Downloaded</Badge>
                <Text className="flex-1 text-xs text-muted-foreground">
                  It runs after a restart. Anything half-typed goes with it.
                </Text>
              </View>
            ) : null}
            {progress.kind === "failed" ? (
              <View className="flex-row items-center gap-2">
                <Badge variant="destructive">Failed</Badge>
                <Text className="flex-1 text-xs text-muted-foreground">{progress.detail}</Text>
              </View>
            ) : null}
          </>
        ) : (
          <Muted>
            {Platform.OS === "web"
              ? "A browser reloads the page instead; there is nothing to fetch here."
              : "This build is attached to Metro, which serves its own JavaScript. Updates apply to installed builds."}
          </Muted>
        )}
      </Card>
    </Screen>
  );
}
