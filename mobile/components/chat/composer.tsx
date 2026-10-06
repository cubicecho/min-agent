import { Platform, Text, View } from "react-native";
import { ActionButton } from "@/components/action-button.tsx";
import { BookOpen, Mic, Send } from "@/components/app/app-icons";
import { MUTED } from "@/components/chat/token-readouts.tsx";
import { SettingsLink } from "@/components/settings/link.tsx";
import { Alert } from "@/components/ui/alert.tsx";
import { Square } from "@/components/ui/icons";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils.ts";
import type { Dictation } from "@/lib/voice.ts";

/** What ties the composer to its label. One composer is on screen at a time. */
const COMPOSER_ID = "composer";

/**
 * The foot of a chat: what went wrong with the last turn, the box, and the buttons beside it.
 *
 * It holds nothing of its own. The draft is written by dictation and by the prompt picker as
 * well as by typing, and the turn belongs to whoever is showing it.
 */
export function Composer({
  draft,
  onDraft,
  activeModel,
  busy,
  failure,
  speechError,
  dictation,
  onSend,
  onStop,
  onPickPrompt,
}: {
  draft: string;
  onDraft: (text: string) => void;
  /** The model a turn would run on. Empty when there is none, and then nothing can be sent. */
  activeModel: string;
  /** Whether a turn is in flight, which is when send becomes stop. */
  busy: boolean;
  failure: string | null;
  speechError: string | null;
  dictation: Dictation;
  onSend: () => void;
  onStop: () => void;
  /** Opens the MCP prompts. Left out where no server offers one. */
  onPickPrompt?: () => void;
}) {
  return (
    <View className="mx-auto w-full max-w-3xl gap-2">
      {failure ? (
        <Alert variant="destructive" title="The turn failed" description={failure} />
      ) : null}

      {/* A microphone that would not open, or a reply that would not play. Its own line:
        it has nothing to do with whether the turn itself worked. */}
      {dictation.error || speechError ? (
        <Alert
          variant="destructive"
          title="Voice is not working"
          description={dictation.error ?? speechError ?? ""}
        />
      ) : null}

      {/*
        Nothing below this can work without a model, and the composer cannot say where to
        get one — a placeholder is not something you can press. So the way out sits above
        it, as a button rather than as the name of a screen to go and find.
      */}
      {activeModel ? null : (
        <View className="flex-row items-center gap-3">
          <Text className={cn(MUTED, "flex-1")}>
            No model selected, so a turn has nothing to run on.
          </Text>
          <SettingsLink tab="model" label="Pick a model" />
        </View>
      )}
      <View className="flex-row items-end gap-2">
        {/*
          The box's name. A placeholder is not one, and `Textarea` takes no `aria-label`,
          so it is a label nobody sees — on the web, the one place `htmlFor` reaches.
        */}
        {Platform.OS === "web" ? (
          <Label htmlFor={COMPOSER_ID} className="sr-only">
            Message
          </Label>
        ) : null}
        {/*
          cubeui's box: as tall as what is in it up to seven lines, and in a browser a bare
          Enter sends. On a phone the return key is a new line and the send button is an
          inch away.
        */}
        <Textarea
          id={COMPOSER_ID}
          rows={1}
          maxRows={7}
          value={draft}
          onChangeText={onDraft}
          onSubmitEditing={onSend}
          placeholder={activeModel ? "Send a message…" : "Pick a model to start"}
          className="min-h-11 flex-1 py-2.5"
        />
        {/*
          Absent where no server offers a prompt, for the same reason as the microphone
          below: a button that opens an empty list is a button that teaches you not to
          press it.
        */}
        {onPickPrompt ? (
          <ActionButton
            variant="secondary"
            size="icon-lg"
            label="Insert an MCP prompt"
            onPress={onPickPrompt}
            iconSlot={<BookOpen aria-hidden className="size-4" />}
          />
        ) : null}
        {/*
          Absent rather than disabled where neither engine can run — a device build with no
          transcription model configured, or Firefox. There is nothing to press it for, and
          the phone keyboard already has a microphone key of its own.
        */}
        {dictation.supported ? (
          <ActionButton
            variant={dictation.listening ? "destructive" : "secondary"}
            size="icon-lg"
            label={dictation.listening ? "Stop dictating" : "Dictate a message"}
            disabled={dictation.transcribing}
            onPress={dictation.toggle}
            iconSlot={
              <DictationIcon
                transcribing={dictation.transcribing}
                listening={dictation.listening}
              />
            }
          />
        ) : null}
        {busy ? (
          <ActionButton
            variant="secondary"
            size="icon-lg"
            label="Stop the turn"
            onPress={onStop}
            iconSlot={<Square aria-hidden className="size-4" />}
          />
        ) : (
          <ActionButton
            size="icon-lg"
            label="Send"
            disabled={!draft.trim()}
            onPress={onSend}
            iconSlot={<Send aria-hidden className="size-4" />}
          />
        )}
      </View>
    </View>
  );
}

/** What the microphone button shows: working, recording, or ready. */
function DictationIcon({ transcribing, listening }: { transcribing: boolean; listening: boolean }) {
  if (transcribing) {
    return <Spinner label="Transcribing" />;
  }
  if (listening) {
    return <Square aria-hidden className="size-4" />;
  }
  return <Mic aria-hidden className="size-4" />;
}
