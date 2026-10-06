import { messageOf } from "@shared/errors.ts";
import { useStore } from "@tanstack/react-form";
import * as Updates from "expo-updates";
import { useState } from "react";
import { Platform, Text } from "react-native";
import { useAppForm } from "@/components/app/app-form";
import { DescriptionList, PropertyRow } from "@/components/description-list";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import { CircleCheck, Download, RefreshCw } from "@/components/ui/icons";
import { setVoiceSettings, useVoiceSettings } from "@/lib/voice-settings.ts";
import { useReportDirty } from "./dirty.tsx";
import { PanelBody } from "./panel-body.tsx";
import { SettingsCard } from "./settings-card.tsx";

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
const updatable = Platform.OS !== "web" && Updates.isEnabled && __DEV__ === false;

/** Enough of an update's id to tell two apart at a glance. */
const SHORT_ID_CHARS = 8;

/** The running update, in the four facts that identify it. */
function Running() {
  const built = Updates.createdAt;
  const id = Updates.updateId;
  return (
    <DescriptionList
      contentSlot={
        <>
          <PropertyRow label="Channel" value={Updates.channel || "None"} />
          <PropertyRow label="Runtime" value={Updates.runtimeVersion || "Unknown"} />
          <PropertyRow
            label="Update"
            value={id ? id.slice(0, SHORT_ID_CHARS) : "The JavaScript this app was built with"}
          />
          {built ? <PropertyRow label="Published" value={built.toLocaleString()} /> : null}
        </>
      }
    />
  );
}

/**
 * What the microphone does when it finishes, as a form with a Save like every other setting:
 * the switch is a draft until it is saved.
 */
function Dictation() {
  const voice = useVoiceSettings();
  const form = useAppForm({
    defaultValues: { autoSend: voice.autoSend },
    onSubmit: async ({ value, formApi }) => {
      await setVoiceSettings({ autoSend: value.autoSend });
      formApi.reset(value);
    },
  });

  const dirty = useStore(form.store, (state) => state.isDefaultValue === false);
  useReportDirty("device", dirty);

  return (
    <form.AppForm>
      <SettingsCard
        title="Dictation"
        description="What the microphone button does when it finishes. Stored on this device, not on the server, so each phone and tablet answers for itself."
        contentSlot={
          <Form className="gap-3">
            <form.AppField name="autoSend">
              {(field) => <field.SwitchField label="Send as soon as the microphone is done" />}
            </form.AppField>
            {/* Which is not the same moment on both engines, and the difference is the whole
                question of whether you have to touch the phone again. */}
            <Text className="text-muted-foreground text-sm">
              Android's recogniser decides that itself, when you stop talking — so with this on, a
              message can be spoken and sent without touching the phone again. A transcription model
              records until you press the button a second time, and sends then.
            </Text>
            <Text className="text-muted-foreground text-sm">
              With this off the button is the only thing that sends, and what was said is added to
              whatever is already in the box — so a message can be dictated in as many goes as it
              takes.
            </Text>
          </Form>
        }
        footerActionsSlot={<form.SubmitButton createLabel="Save" disabled={dirty === false} />}
      />
    </form.AppForm>
  );
}

export function DevicePanel() {
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
      const isUpToDate = found.isAvailable === false;
      if (isUpToDate) {
        setProgress({ kind: "none" });
        return;
      }
      setProgress({ kind: "downloading" });
      await Updates.fetchUpdateAsync();
      setProgress({ kind: "ready" });
    } catch (error) {
      setProgress({
        kind: "failed",
        detail: messageOf(error),
      });
    }
  };

  const busy = progress.kind === "checking" || progress.kind === "downloading";

  return (
    <PanelBody
      content={
        <>
          <Dictation />

          <SettingsCard
            title="Updates"
            description="This app installs its JavaScript over the air: a change that does not touch the native side is published as an update and picked up on the next launch. This is how to pick one up without waiting for that."
            contentClassName="flex flex-col gap-3"
            contentSlot={
              <>
                <Running />
                {updatable ? null : (
                  <Text className="text-muted-foreground text-sm">
                    {Platform.OS === "web"
                      ? "A browser reloads the page instead; there is nothing to fetch here."
                      : "This build is attached to Metro, which serves its own JavaScript. Updates apply to installed builds."}
                  </Text>
                )}
                {progress.kind === "none" ? (
                  <Alert iconSlot={<CircleCheck />} title="Already up to date" />
                ) : null}
                {progress.kind === "ready" ? (
                  <Alert
                    iconSlot={<Download />}
                    title="Downloaded"
                    description="It runs after a restart. Anything half-typed goes with it."
                  />
                ) : null}
                {progress.kind === "failed" ? (
                  <Alert variant="destructive" title="Failed" description={progress.detail} />
                ) : null}
              </>
            }
            footerActionsSlot={
              updatable ? (
                <>
                  {progress.kind === "ready" ? (
                    <Button
                      variant="outline"
                      onPress={() => void Updates.reloadAsync()}
                      iconSlot={<RefreshCw className="size-4" />}
                      content="Restart now"
                    />
                  ) : null}
                  <Button
                    onPress={check}
                    loading={busy}
                    iconSlot={<Download className="size-4" />}
                    content={progress.kind === "downloading" ? "Downloading" : "Check for updates"}
                  />
                </>
              ) : undefined
            }
          />
        </>
      }
    />
  );
}
