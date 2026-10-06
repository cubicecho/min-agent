import { voiceBaseUrlFor } from "@shared/types.ts";
import { View } from "react-native";
import { SettingRow } from "@/components/setting-row.tsx";
import { FieldRow } from "@/components/ui/form.tsx";
import { ConfigForm } from "./config-form.tsx";
import { TextField } from "./fields.tsx";
import { SettingsLink } from "./link.tsx";
import { SettingsCard } from "./settings-card.tsx";

/**
 * Speaking and listening: which models do it, and where they are.
 *
 * Its own panel rather than the fifth card on the Agent one, because it is the only group on
 * the settings screen that is genuinely optional — the whole app works with every box here
 * empty — and it was the group people scrolled past.
 *
 * What is *not* here is when the microphone button sends, which is under Device: it is stored
 * on the device rather than on the server, because it is about how you are holding the thing.
 * The row at the bottom says so, since this is where anyone would look for it first.
 */
export function VoicePanel() {
  return (
    <ConfigForm
      tab="voice"
      fields={({ voiceBaseUrl, sttModel, ttsModel, ttsVoice, speakReplies }) => ({
        voiceBaseUrl,
        sttModel,
        ttsModel,
        ttsVoice,
        speakReplies,
      })}
      // The chat endpoint is the Model panel's field, so what is quoted here is the saved one.
      content={({ form, draft, view }) => (
        <>
          <SettingsCard
            title="Where the audio runs"
            description="Leave both models blank and voice runs on whatever the device already has: a browser and an Android build both read replies aloud and take dictation with the recogniser they ship with. Naming a model moves that work to the server, which is the only way the desktop build gets a microphone button of its own. A tcp://host:port in place of a model name is a Wyoming server — the voice services Home Assistant speaks to — and the audio base URL and API key are not used for it."
            contentSlot={
              <form.AppField name="voiceBaseUrl">
                {() => (
                  <TextField
                    label="Audio base URL"
                    description={`Where the transcription and speech endpoints are, when that is not where the chat model is — a local Ollama serves no audio. Blank uses ${voiceBaseUrlFor({ ...view, ...draft }) || "the endpoint under Model"}. The same API key is sent either way.`}
                    placeholder={view.baseUrl || "https://api.openai.com/v1"}
                    inputMode="url"
                  />
                )}
              </form.AppField>
            }
          />

          <SettingsCard
            title="Models"
            contentSlot={
              <>
                <FieldRow>
                  <form.AppField name="sttModel">
                    {() => (
                      <TextField
                        label="Speech to text"
                        description="whisper-1, or tcp://host:10300 for a Wyoming one. Blank uses the device."
                        placeholder="off"
                      />
                    )}
                  </form.AppField>
                  <form.AppField name="ttsModel">
                    {() => (
                      <TextField
                        label="Text to speech"
                        description="tts-1, or tcp://host:10200 for a Wyoming one. Blank uses the device."
                        placeholder="off"
                      />
                    )}
                  </form.AppField>
                </FieldRow>

                <form.AppField name="ttsVoice">
                  {() => (
                    <TextField
                      label="Voice"
                      description="Which voice the speech model uses — a Piper voice name for Wyoming. Blank takes its default."
                      placeholder="alloy"
                    />
                  )}
                </form.AppField>
              </>
            }
          />

          <SettingsCard
            title="Playback"
            contentSlot={
              <>
                <form.AppField name="speakReplies">
                  {(field) => <field.SwitchField label="Read every reply aloud" />}
                </form.AppField>

                <SettingRow
                  description="When the microphone button sends what you dictated is set per device, not here."
                  actionSlot={
                    <View className="flex-row">
                      <SettingsLink tab="device" />
                    </View>
                  }
                />
              </>
            }
          />
        </>
      )}
    />
  );
}
