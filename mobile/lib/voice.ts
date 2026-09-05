import { speakableText, spokenChunk } from "@shared/client/voice.ts";
import {
  createAudioPlayer,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
} from "expo-audio";
import { File, Paths } from "expo-file-system";
import * as Speech from "expo-speech";
import { ExpoSpeechRecognitionModule, ExpoWebSpeechRecognition } from "expo-speech-recognition";
import { useCallback, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import { voice } from "./client.ts";

/**
 * Talking to min-agent, and being answered out loud.
 *
 * Each half has two engines, and which one runs is decided by whether a model is named under
 * **Settings → Agent → Voice**:
 *
 * - **Dictation.** With a transcription model, the microphone is recorded and the clip posted
 *   to the agent. Without one, the platform's own recogniser does it for free: a browser's
 *   `SpeechRecognition` — Chrome, Edge and Safari have it, Firefox does not — and on Android
 *   the system recogniser behind `expo-speech-recognition`, which is the same engine as the
 *   microphone key on the keyboard. That leaves the desktop build, where neither exists, so
 *   there `supported` is false and the composer omits the microphone rather than offering a
 *   button that cannot work.
 * - **Speech.** With a speech model, the agent returns audio to play. Without one,
 *   `expo-speech` reads the reply in the device's own voice, which it has on every platform
 *   this ships to — `speechSynthesis` in a browser, the system voice on Android.
 *
 * The device engines are the default because they cost nothing, need no key and no second
 * server, and are already installed. The model engines exist because they are better, and
 * because the device ones are missing in exactly the two builds a self-hoster is most likely
 * to be using.
 */

/** What a device voice will take in one call, and past which the tail is silence anyway. */
const MAX_SPOKEN = 4000;

/* ------------------------------------------------------------------ recordings */

/**
 * What the model engine records with. `HIGH_QUALITY` with the level meter switched on, which
 * is off by default and is what silence detection reads: without it `getStatus().metering` is
 * undefined and a recording only ever ends when the button ends it. A module constant because
 * `useAudioRecorder` builds a new recorder for a new object, and a literal is a new object on
 * every render.
 */
const METERED = { ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true };

/** How often the level is read while the model engine records. */
const LEVEL_POLL = 150;

/**
 * The two levels silence detection works between — not absolute ones, but decibels above the
 * quietest thing heard so far. Louder than `SPEECH_OVER` is you; within `QUIET_OVER` is the
 * room again; between the two is the dip between two words, which is neither.
 *
 * Measured against a floor rather than against a fixed dBFS number because there is no fixed
 * number that is right twice. A phone on a desk reports a room at about -50 dBFS and one in a
 * kitchen at -32, so a threshold low enough to work in the first is a threshold the second
 * never once crosses — which is a recording that never ends on its own, in the room where you
 * most want it to.
 */
const SPEECH_OVER = 18;
const QUIET_OVER = 8;

/**
 * Below this, the microphone is reporting nothing rather than a quiet room: `metering` is
 * -160 exactly when the amplitude was zero, which is what the first reading after `record()`
 * is and what a muted microphone is forever. It counts as silence — it is silence — but it is
 * never allowed to become the floor everything else is measured against.
 */
const NO_SIGNAL = -100;

/**
 * What a recorded file holds, by the name it was saved under.
 *
 * `RecordingPresets.HIGH_QUALITY` writes `.m4a` on a device and `audio/webm` in a browser,
 * so those are the two that occur; the map is here because the transcription model decides
 * how to decode by what the upload is called, and a wrong name reads as a corrupt file.
 */
const MIME_BY_EXTENSION: Record<string, string> = {
  m4a: "audio/mp4",
  mp4: "audio/mp4",
  "3gp": "audio/3gpp",
  webm: "audio/webm",
  ogg: "audio/ogg",
  wav: "audio/wav",
};

const mimeOf = (uri: string) =>
  MIME_BY_EXTENSION[uri.split("?")[0]?.split(".").pop()?.toLowerCase() ?? ""] ?? "audio/mp4";

/**
 * The recording as base64, which is the one encoding both runtimes will hand over without a
 * second transport: a browser holds a `blob:` URL a `FileReader` can read, and a device holds
 * a real file `expo-file-system` can. See `server/voice.ts` for why the wire format is this.
 */
async function readRecording(uri: string) {
  if (Platform.OS !== "web") return { audio: await new File(uri).base64(), mime: mimeOf(uri) };

  const blob = await fetch(uri).then((response) => response.blob());
  const audio = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("could not read the recording"));
    // A data URI, whose payload is everything after the comma.
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.readAsDataURL(blob);
  });
  return { audio, mime: blob.type || "audio/webm" };
}

/* --------------------------------------------------- the browser's own listening */

/**
 * The shape of `SpeechRecognition`, which TypeScript's DOM library does not describe and
 * half the browsers spell with a `webkit` prefix. Only the handful of members used below,
 * plus the one Android addition.
 */
interface Recognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  /** Android only, and only honoured when the locale's model is on disk. See `onDeviceLocales`. */
  requiresOnDeviceRecognition?: boolean;
  /** Android only. How long a pause the system endpointer sits through before it gives up on you. */
  androidIntentOptions?: {
    EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS?: number;
    EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS?: number;
  };
  start(): void;
  stop(): void;
  abort(): void;
  onresult:
    | ((event: {
        /** Where this event's own results begin; everything before it has been seen already. */
        resultIndex?: number;
        results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
      }) => void)
    | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
}

/**
 * Whoever recognises speech here.
 *
 * On web that is the browser's own, deliberately: it is already there, it needs no permission
 * dance of ours, and `expo-speech-recognition` on web is a wrapper around this same object.
 * Off web it is that package, which reaches Android's system recogniser — the one the
 * keyboard's microphone key uses. The cast is because the polyfill is typed against the full
 * DOM `SpeechRecognition` and this is the smaller contract the app actually depends on.
 */
function recognitionClass(): (new () => Recognition) | undefined {
  if (Platform.OS !== "web") return ExpoWebSpeechRecognition as unknown as new () => Recognition;
  if (typeof window === "undefined") return undefined;
  const scope = window as unknown as Record<string, (new () => Recognition) | undefined>;
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition;
}

/** What to ask to be recognised in, which off web has no `navigator` to read it from. */
function currentLocale(): string {
  if (typeof navigator !== "undefined" && navigator.language) return navigator.language;
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale || "en-US";
  } catch {
    return "en-US";
  }
}

/**
 * The locales Android can recognise without sending the audio anywhere.
 *
 * Android's recogniser is network-backed by default — the clip goes to Google — and the
 * offline model is a per-device download the user has to have made, so whether this is
 * possible is a fact about the phone rather than a setting. Asked once and matched exactly:
 * a near miss falls back to the default service, which always works, rather than to a
 * `no-speech` error from a model that is not installed for the language being spoken.
 */
async function onDeviceLocales(): Promise<string[]> {
  if (Platform.OS === "web" || !ExpoSpeechRecognitionModule.supportsOnDeviceRecognition())
    return [];
  const { installedLocales } = await ExpoSpeechRecognitionModule.getSupportedLocales({}).catch(
    () => ({ installedLocales: [] as string[] }),
  );
  return installedLocales;
}

/* ---------------------------------------------------------------------- dictation */

export interface Dictation {
  /** False when neither engine is available here, and the microphone should not be offered. */
  supported: boolean;
  /** The microphone is open. */
  listening: boolean;
  /** The clip is with the transcription model. Only ever true on the model engine. */
  transcribing: boolean;
  error: string | null;
  /** Start listening, or stop and deliver what was said. */
  toggle: () => void;
}

/**
 * A microphone that hands finished utterances to `onText`.
 *
 * `onText` is read through a ref: the composer's handler closes over the draft and so is a
 * new function every keystroke, and re-arming a recogniser mid-sentence would lose it.
 *
 * `silence` is how long a pause has to last before what was said counts as finished, or null
 * to leave that decision to the button. Each engine honours it the only way it can: the
 * platform recogniser is an endpointer already and is asked to be that patient, while a
 * recording has nothing deciding for it and gets its level watched instead. `onDone` fires
 * after that, once per session that actually heard something, which is what lets the composer
 * send without a press.
 */
export function useDictation({
  model,
  onText,
  onDone,
  silence = null,
}: {
  model: string;
  onText: (text: string) => void;
  onDone?: () => void;
  silence?: number | null;
}): Dictation {
  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const deliver = useRef(onText);
  deliver.current = onText;
  const finished = useRef(onDone);
  finished.current = onDone;
  /** Read from inside a session that started before the setting was last changed. */
  const pause = useRef(silence);
  pause.current = silence;

  const recorder = useAudioRecorder(METERED);
  /**
   * The recogniser, built once and started again and again.
   *
   * One instance rather than one per press, and not for tidiness. Off web this is
   * `expo-speech-recognition`'s polyfill, and every handler set on one of those becomes a
   * listener on the module's single native emitter — a subscription nothing removes when the
   * session ends, because `stop()` and `abort()` are module-level functions that know nothing
   * about the object they were called on. A new recogniser per press therefore left the old
   * one listening: on the third press three of them heard the same sentence and handed it over
   * three times, which is what "it repeats what I said" was. The instance is reconfigured
   * before each `start()` instead, so there is exactly one of everything.
   */
  const recognition = useRef<Recognition | null>(null);
  /** Whether the microphone is open, readable from a handler that runs between renders. */
  const open = useRef(false);
  /** False once this hook has been torn down, for the one listener that cannot be removed. */
  const alive = useRef(true);
  /** A press while the last one is still opening or closing the microphone would race it. */
  const busy = useRef(false);
  /** The locales this device can recognise offline, once the answer has come back. */
  const offline = useRef<string[]>([]);
  /**
   * Everything this session has heard, and empty until it has heard anything — which is also
   * how "was this session worth acting on" is answered when it ends.
   */
  const heard = useRef("");
  /** The level watch, while the model engine is recording. */
  const watching = useRef<ReturnType<typeof setInterval> | null>(null);

  const viaModel = Boolean(model.trim());
  const supported = viaModel || Boolean(recognitionClass());

  /**
   * Everything reaches the composer through here, and what it hands over is the whole of what
   * this session has heard rather than the phrase that just arrived.
   *
   * That is the contract `onText` is written against: each call *replaces* the last one's
   * text, so a second press of the microphone is a second attempt at saying something and not
   * a second sentence added to the first. A recogniser that settles a sentence in two goes
   * still ends up with one sentence in the box, because both of them are in this string.
   */
  const hand = useCallback((phrase: string) => {
    heard.current = heard.current ? `${heard.current} ${phrase}` : phrase;
    deliver.current(heard.current);
  }, []);

  /**
   * Runs one microphone transition at a time.
   *
   * Opening and closing are both asynchronous and `listening` is set optimistically, so two
   * quick presses used to reach `stop()` on a recorder that had not finished starting — which
   * ends as "nothing was recorded", a true sentence about the wrong thing.
   */
  const only = useCallback((work: () => Promise<void>) => {
    if (busy.current) return;
    busy.current = true;
    work()
      .catch((thrown) => setError((thrown as Error).message))
      .finally(() => {
        busy.current = false;
      });
  }, []);

  const unwatch = useCallback(() => {
    if (watching.current) clearInterval(watching.current);
    watching.current = null;
  }, []);

  useEffect(() => {
    let live = true;
    void onDeviceLocales().then((locales) => {
      if (live) offline.current = locales;
    });
    return () => {
      live = false;
    };
  }, []);

  // Leaving a screen with the microphone open would keep it open — the recogniser holds it,
  // and so does a recording in progress. Neither stop is awaited: the component is going and
  // there is nobody left to hand a transcript to.
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      unwatch();
      const session = recognition.current;
      recognition.current = null;
      open.current = false;
      if (session) {
        session.abort();
        // Nulling these is what takes the listeners off the native emitter; abandoning the
        // object does not, and the next mount's recogniser would be talking over this one's.
        // `onend` is the exception — the polyfill files its subscription under the wrapper it
        // registered and looks it up by the handler it was given, so that one can only be
        // ignored, which is what `alive` is for.
        session.onresult = null;
        session.onerror = null;
        session.onend = null;
      }
      if (!recorder.isRecording) return;
      void recorder.stop().catch(() => {});
      void setAudioModeAsync({ allowsRecording: false }).catch(() => {});
    };
  }, [recorder, unwatch]);

  const transcribe = useCallback(async () => {
    unwatch();
    await recorder.stop();
    // Recording holds the audio session on iOS, and a reply read aloud straight after would
    // come out of the earpiece. Handing it back costs nothing on the platforms it does not.
    await setAudioModeAsync({ allowsRecording: false }).catch(() => {});

    const uri = recorder.uri;
    if (!uri) throw new Error("nothing was recorded");

    setTranscribing(true);
    try {
      const text = await voice.transcribe(await readRecording(uri));
      if (text) hand(text);
    } finally {
      setTranscribing(false);
    }
    if (heard.current) finished.current?.();
  }, [hand, recorder, unwatch]);

  /** How a recording ends, whether the button ended it or the pause did. */
  const stopAndSend = useCallback(() => {
    only(async () => {
      setListening(false);
      await transcribe();
    });
  }, [only, transcribe]);

  /**
   * Stops the recording once the room has been quiet for long enough.
   *
   * The room is whatever the quietest reading so far was — every level below is read as how
   * far above that one it is, so the same two numbers work on a phone in a kitchen and on one
   * on a desk. The floor can only fall, and a reading that sets a new one is by definition
   * silence, which is what makes the measure self-correcting: it starts wherever the first
   * reading happens to land and walks down to the truth within a second or two.
   *
   * Nothing is armed until something has been heard over it. The pause before you start
   * talking is longer than the one at the end, and a watch armed on the first tick would end
   * the recording before there was anything in it. A recorder that reports no level at all —
   * the web one — never arms and is left to the button, which still works.
   */
  const watchForSilence = useCallback(() => {
    const quiet = pause.current;
    if (!quiet) return;
    /** The quietest reading so far, and NaN until there has been one. */
    let floor = Number.NaN;
    let spoke = false;
    let since = 0;
    watching.current = setInterval(() => {
      const level = recorder.getStatus().metering;
      if (level === undefined) return;

      const signal = level > NO_SIGNAL;
      // `!(floor <= level)` rather than `level < floor`, so the first reading takes it.
      if (signal && !(floor <= level)) floor = level;
      const over = signal ? level - floor : 0;

      if (over > SPEECH_OVER) {
        spoke = true;
        since = 0;
        return;
      }
      if (!spoke) return;
      // Between the two is neither talking nor silence, and the timer neither starts nor
      // resets: it is the dip between two words, which is not the end of a sentence.
      if (over > QUIET_OVER) return;
      if (!since) since = Date.now();
      if (Date.now() - since < quiet) return;
      unwatch();
      stopAndSend();
    }, LEVEL_POLL);
  }, [recorder, stopAndSend, unwatch]);

  const record = useCallback(async () => {
    const permission = await requestRecordingPermissionsAsync();
    if (!permission.granted) throw new Error("the microphone was not allowed");
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    await recorder.prepareToRecordAsync();
    recorder.record();
    watchForSilence();
  }, [recorder, watchForSilence]);

  /** The recogniser and its three handlers, made on first use and kept from then on. */
  const recogniser = useCallback(() => {
    if (recognition.current) return recognition.current;

    const Recogniser = recognitionClass();
    if (!Recogniser) throw new Error("this build has no speech recognition");
    const session = new Recogniser();

    session.onresult = ({ results, resultIndex = 0 }) => {
      if (!alive.current) return;
      let phrase = "";
      // From `resultIndex`, not from zero: `results` is the session's history rather than its
      // latest event, and a recogniser that settles a second phrase hands the first one back
      // along with it.
      for (let index = resultIndex; index < results.length; index++) {
        const result = results[index];
        if (!result?.isFinal) continue;
        phrase = phrase ? `${phrase} ${result[0].transcript}` : result[0].transcript;
      }
      if (phrase.trim()) hand(phrase.trim());
    };
    // `no-speech` and `aborted` are what a held-and-released button sounds like, not faults.
    session.onerror = ({ error: reason }) => {
      if (!alive.current) return;
      if (reason !== "no-speech" && reason !== "aborted") setError(reason);
    };
    session.onend = () => {
      if (!alive.current || !open.current) return;
      open.current = false;
      setListening(false);
      // The recogniser stopping on its own is the only sign there is that you have finished
      // talking. A session that heard nothing is a button pressed twice, and not that.
      if (heard.current) finished.current?.();
    };

    recognition.current = session;
    return session;
  }, [hand]);

  /** The platform engine ends on its own — at a pause, or when `stop()` is called. */
  const listen = useCallback(async () => {
    const session = recogniser();

    // A browser asks for the microphone itself, as part of starting. Android does not.
    if (Platform.OS !== "web") {
      const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!permission.granted) throw new Error("the microphone was not allowed");
    }

    // Every setting written afresh, because the object outlives the session: `start()` reads
    // these as they stand, so anything left over from last time is what would be asked for.
    const locale = currentLocale();
    session.continuous = false;
    session.interimResults = false;
    session.lang = locale;
    session.requiresOnDeviceRecognition = offline.current.includes(locale);
    // How long a pause the endpointer should sit through before calling it finished. Android
    // documents these as advisory and plenty of recognisers ignore them, so this is the
    // setting being asked for rather than the setting being enforced.
    session.androidIntentOptions = pause.current
      ? {
          EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS: pause.current,
          EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS: pause.current,
        }
      : undefined;

    open.current = true;
    try {
      session.start();
    } catch (thrown) {
      open.current = false;
      throw thrown;
    }
  }, [recogniser]);

  const toggle = useCallback(() => {
    setError(null);

    // Optimistic in both directions, so the button answers the press rather than the
    // permission dialog. A refusal puts it back.
    const start = (open: () => Promise<void>) =>
      only(async () => {
        heard.current = "";
        setListening(true);
        try {
          await open();
        } catch (thrown) {
          setListening(false);
          throw thrown;
        }
      });

    if (!viaModel) {
      if (listening) recognition.current?.stop();
      else start(listen);
      return;
    }

    if (listening) {
      stopAndSend();
      return;
    }

    start(record);
  }, [listen, listening, only, record, stopAndSend, viaModel]);

  return { supported, listening, transcribing, error, toggle };
}

/* ------------------------------------------------------------------------ speech */

export interface Speaker {
  speaking: boolean;
  error: string | null;
  /**
   * Reads `text` aloud, markdown and all — the markup is stripped on the way. False when
   * there was nothing left to say: a reply that is one fenced block strips to an empty
   * string, and a caller that marked it as being read would leave a stop button on silence.
   */
  speak: (text: string) => boolean;
  stop: () => void;
}

/** One thing is being read at a time, and starting another is how you stop the first. */
export function useSpeech({ model }: { model: string }): Speaker {
  const [speaking, setSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Whatever is making noise right now, so a second `speak` can silence it first. */
  const playing = useRef<{ stop: () => void } | null>(null);
  /**
   * Which request the answer belongs to. A slow `/speak` that lands after the reader has
   * moved on must not start playing over whatever they asked for next.
   */
  const turn = useRef(0);

  const silence = useCallback(() => {
    turn.current += 1;
    playing.current?.stop();
    playing.current = null;
    void Speech.stop();
    setSpeaking(false);
  }, []);

  useEffect(() => silence, [silence]);

  /**
   * Plays audio the model produced.
   *
   * Two paths because only one of them can say when it has finished: `expo-audio`'s web
   * player does not emit a status update on `ended`, so a browser is given an `Audio`
   * element, whose `onended` it does. A device gets the file written to the cache and
   * `didJustFinish` off the player, which there is reported.
   */
  const play = useCallback(async (bytes: ArrayBuffer, mime: string, mine: number) => {
    if (Platform.OS === "web") {
      const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
      const element = new Audio(url);
      const done = () => {
        URL.revokeObjectURL(url);
        if (turn.current === mine) setSpeaking(false);
      };
      element.onended = done;
      element.onerror = done;
      playing.current = {
        stop: () => {
          element.pause();
          done();
        },
      };
      await element.play();
      return;
    }

    // A file rather than a data URI: the native player takes a source it can open, and the
    // cache is where a thing that is listened to once and never again belongs.
    const file = new File(Paths.cache, `min-agent-reply.${mime.includes("wav") ? "wav" : "mp3"}`);
    file.create({ overwrite: true });
    file.write(new Uint8Array(bytes));

    const player = createAudioPlayer(file.uri);
    const subscription = player.addListener("playbackStatusUpdate", (status) => {
      if (!status.didJustFinish) return;
      subscription.remove();
      player.remove();
      if (turn.current === mine) setSpeaking(false);
    });
    playing.current = {
      // `pause` first, and not for tidiness: on Android `remove` only drops the module's
      // handle on the player — the teardown that actually stops the sound is on the shared
      // object's release, which happens whenever the JS object is next collected. Removing a
      // playing player therefore silenced nothing, and the reply talked over its successor.
      stop: () => {
        player.pause();
        subscription.remove();
        player.remove();
      },
    };
    player.play();
  }, []);

  /** Whether anything is being read: a reply that is all code strips to nothing to say. */
  const speak = useCallback(
    (text: string): boolean => {
      silence();
      const body = speakableText(text);
      if (!body) return false;

      const mine = turn.current;
      setError(null);
      setSpeaking(true);

      if (!model.trim()) {
        // The device's own voice, which `expo-speech` provides on every platform this ships
        // to. `onStopped` fires for the cancel in `silence`, which is not an interruption
        // worth reporting — the state it would clear has already been claimed by the
        // utterance that replaced it, hence the guard on every one of these.
        Speech.speak(spokenChunk(body, MAX_SPOKEN), {
          onDone: () => {
            if (turn.current === mine) setSpeaking(false);
          },
          onStopped: () => {
            if (turn.current === mine) setSpeaking(false);
          },
          onError: (thrown) => {
            if (turn.current !== mine) return;
            setError(thrown.message);
            setSpeaking(false);
          },
        });
        return true;
      }

      voice
        .speak(body)
        .then(({ bytes, mime }) => {
          if (turn.current !== mine) return undefined;
          return play(bytes, mime, mine);
        })
        .catch((thrown: Error) => {
          if (turn.current !== mine) return;
          setError(thrown.message);
          setSpeaking(false);
        });
      return true;
    },
    [model, play, silence],
  );

  return { speaking, error, speak, stop: silence };
}
