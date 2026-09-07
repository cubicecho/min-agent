import { voiceBaseUrlFor } from "@shared/types.ts";
import { Text, View } from "react-native";
import { Card, CardDescription, CardTitle, Field, Input, Muted, Switch } from "@/components/ui.tsx";
import { ConfigForm } from "./config-form.tsx";
import { SettingsLink } from "./link.tsx";

/**
 * Speaking and listening: which models do it, and where they are.
 *
 * Its own panel rather than the fifth card on the Agent one, because it is the only group on
 * the settings screen that is genuinely optional — the whole app works with every box here
 * empty — and it was the group people scrolled past.
 *
 * What is *not* here is when the microphone button sends, which is under Device: it is stored
 * on the device rather than on the server, because it is about how you are holding the thing.
 * The link at the bottom says so, since this is where anyone would look for it first.
 */
export function VoicePanel() {
  return (
    <ConfigForm tab="voice">
      {({ draft, set }) => (
        <>
          <Card>
            <CardTitle>Where the audio runs</CardTitle>
            <CardDescription>
              Leave both models blank and voice runs on whatever the device already has: a browser
              and an Android build both read replies aloud and take dictation with the recogniser
              they ship with. Naming a model moves that work to the server, which is the only way
              the desktop build gets a microphone button of its own. A tcp://host:port in place of a
              model name is a Wyoming server — the voice services Home Assistant speaks to — and the
              audio base URL and API key are not used for it.
            </CardDescription>

            <Field
              label="Audio base URL"
              hint={`Where the transcription and speech endpoints are, when that is not where the chat model is — a local Ollama serves no audio. Blank uses ${voiceBaseUrlFor(draft) || "the endpoint under Model"}. The same API key is sent either way.`}
            >
              <Input
                value={draft.voiceBaseUrl}
                onChangeText={(value) => set("voiceBaseUrl", value)}
                placeholder={draft.baseUrl || "https://api.openai.com/v1"}
                autoCapitalize="none"
                autoCorrect={false}
                inputMode="url"
              />
            </Field>
          </Card>

          <Card>
            <CardTitle>Models</CardTitle>

            <View className="flex-row gap-3">
              <View className="flex-1">
                <Field
                  label="Speech to text"
                  hint="whisper-1, or tcp://host:10300 for a Wyoming one. Blank uses the device."
                >
                  <Input
                    value={draft.sttModel}
                    onChangeText={(value) => set("sttModel", value)}
                    placeholder="off"
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                </Field>
              </View>
              <View className="flex-1">
                <Field
                  label="Text to speech"
                  hint="tts-1, or tcp://host:10200 for a Wyoming one. Blank uses the device."
                >
                  <Input
                    value={draft.ttsModel}
                    onChangeText={(value) => set("ttsModel", value)}
                    placeholder="off"
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                </Field>
              </View>
            </View>

            <Field
              label="Voice"
              hint="Which voice the speech model uses — a Piper voice name for Wyoming. Blank takes its default."
            >
              <Input
                value={draft.ttsVoice}
                onChangeText={(value) => set("ttsVoice", value)}
                placeholder="alloy"
                autoCapitalize="none"
                autoCorrect={false}
              />
            </Field>
          </Card>

          <Card>
            <CardTitle>Playback</CardTitle>

            <View className="flex-row items-center gap-3">
              <Switch
                value={draft.speakReplies}
                onValueChange={(value) => set("speakReplies", value)}
              />
              <Text className="flex-1 text-sm text-foreground">Read every reply aloud</Text>
            </View>

            <Muted>
              When the microphone button sends what you dictated is set per device, not here.
            </Muted>
            <View className="flex-row">
              <SettingsLink tab="device">Settings → Device</SettingsLink>
            </View>
          </Card>
        </>
      )}
    </ConfigForm>
  );
}
