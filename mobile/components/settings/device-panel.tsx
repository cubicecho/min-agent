import * as Updates from "expo-updates";
import { useState } from "react";
import { Platform, Text, View } from "react-native";
import {
  Badge,
  Button,
  Card,
  CardDescription,
  CardTitle,
  Field,
  Muted,
  Screen,
  Select,
  Switch,
} from "@/components/ui.tsx";
import { setVoiceSettings, useVoiceSettings } from "@/lib/voice-settings.ts";

/**
 * The settings that belong to this install rather than to the agent.
 *
 * Everything on the other panels is stored on the server and is the same for every client
 * that talks to it. These two are not: how long a pause you leave when you dictate is about
 * the room you are in, and which JavaScript this binary is running is about this binary. They
 * live in the device's own storage, and this is where they are set.
 */

/**
 * The pauses worth offering. A slider would suggest the difference between 1.4 and 1.5
 * seconds is one anybody can hear; these are the four answers people actually want, which are
 * "before I have finished thinking", "about right", "I trail off", and "let me stop talking
 * properly first".
 */
const PAUSES = [
  { label: "Three quarters of a second", value: "750" },
  { label: "One second", value: "1000" },
  { label: "A second and a half", value: "1500" },
  { label: "Two seconds", value: "2000" },
  { label: "Three seconds", value: "3000" },
];

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
          What the microphone button does when you stop talking. Stored on this device, not on the
          server, so each phone and tablet answers for itself.
        </CardDescription>

        <View className="flex-row items-center gap-3">
          <Switch
            value={voice.autoSend}
            onValueChange={(autoSend) => void setVoiceSettings({ autoSend })}
          />
          <Text className="flex-1 text-sm text-foreground">Send as soon as I stop talking</Text>
        </View>

        <Field
          label="Pause before it counts as finished"
          hint={
            "Android's recogniser treats this as a suggestion and may keep its own timing; a transcription model, which records until the pause, always honours it."
          }
        >
          <Select
            value={String(voice.silenceMs)}
            options={PAUSES}
            disabled={!voice.autoSend}
            onChange={(value) => void setVoiceSettings({ silenceMs: Number(value) })}
          />
        </Field>

        {/* The one thing that is easy to get wrong: leaving this on and then wondering why a
            half-finished sentence went. */}
        <Muted>
          With this off the microphone button is the only thing that sends, and what was said is
          added to whatever is already in the box.
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
