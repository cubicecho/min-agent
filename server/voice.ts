import express from "express";
import OpenAI, { toFile } from "openai";
import { spokenChunk } from "../shared/client/voice.ts";
import { type LlmConfig, voiceBaseUrlFor, wyomingAddress } from "../shared/types.ts";
import { toPcm, wav } from "./audio.ts";
import { loadLlmConfig, resolveApiKey } from "./config.ts";
import { synthesize, transcribe } from "./wyoming.ts";

/**
 * Speaking and being spoken to, proxied.
 *
 * Everything else the app does goes over GraphQL; this does not, because both halves of it
 * are bytes. A recording is a blob to be posted and a reply read aloud is an audio stream to
 * be played, and neither survives a round trip through a JSON scalar worth the trouble.
 *
 * It is a proxy rather than something the app calls directly for the reason the API key is
 * write-only: the key is a thing the server has and the browser does not, and a phone on the
 * LAN reaching a provider on its own would need one of its own. The app posts to the agent,
 * the agent posts to the model.
 *
 * Both routes are off unless a model is named under **Settings → Agent → Voice**. Left blank
 * — the default — the app never calls them: it dictates and speaks with whatever the browser
 * or the phone already has, and nothing here is reached at all.
 *
 * A `tcp://host:port` in place of a model name is a Wyoming server — Home Assistant's voice
 * protocol, so a whisper or a Piper someone already runs at home answers instead of a vendor.
 * It is the same proxy for the same reason and swaps only the wire; see `wyoming.ts`.
 */

/** Whisper's own ceiling. A minute of speech is about a megabyte, so a turn is nowhere near. */
const MAX_AUDIO = "25mb";

/** OpenAI's ceiling on one `speech` call, and long enough for any reply worth hearing. */
const MAX_SPEECH = 4096;

/**
 * Whisper decides how to decode by the *filename*, so the upload needs an extension that
 * matches what was recorded — a `.webm` name on m4a bytes comes back as a decode failure.
 * The two that matter are the two the app produces: `audio/webm` in a browser, `audio/mp4`
 * on Android. The rest are here so a hand-rolled client is not made to care.
 */
const EXTENSIONS: Record<string, string> = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
  "audio/m4a": "m4a",
  "audio/x-m4a": "m4a",
  "audio/aac": "m4a",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/flac": "flac",
};

/** `audio/webm;codecs=opus` is what a browser actually sends; the parameters are not the type. */
export const audioExtension = (mime: string): string =>
  EXTENSIONS[mime.split(";")[0]?.trim().toLowerCase() ?? ""] ?? "webm";

/** The audio endpoints, which are the chat server's unless told otherwise. */
const voiceClient = (config: LlmConfig) =>
  new OpenAI({
    baseURL: voiceBaseUrlFor(config),
    apiKey: resolveApiKey(config) || "min-agent",
  });

/**
 * A model that is not configured is not an error anyone should meet as a 500 — it is the
 * normal state of a fresh install, and the app is meant to have checked before calling. 409
 * rather than 404 because the route exists and it is the configuration that is missing.
 */
function requireModel(model: string, what: string, response: express.Response): boolean {
  if (model.trim()) return true;
  response.status(409).json({ error: `no ${what} model configured` });
  return false;
}

/** Whatever the provider said, as a sentence, so the app can put it under the composer. */
function failed(label: string, error: unknown, response: express.Response) {
  const message = (error as Error).message || String(error);
  console.warn(`[voice] ${label}: ${message}`);
  response.status(502).json({ error: message });
}

export const voice = express.Router();

/**
 * Audio in, text out.
 *
 * The body is base64 in JSON rather than the bytes themselves because the app sends the same
 * request from three builds and only one of them holds a `Blob`: on a device the recording is
 * a file URI, and base64 is what `expo-file-system` and a browser `FileReader` both hand back
 * without a second transport. A voice clip is kilobytes, and the third it costs to encode is
 * not worth a multipart parser to save.
 */
voice.post("/transcribe", express.json({ limit: MAX_AUDIO }), async (request, response) => {
  const config = loadLlmConfig();
  if (!requireModel(config.sttModel, "transcription", response)) return;

  const { audio, mime } = request.body as { audio?: string; mime?: string };
  if (!audio) {
    response.status(400).json({ error: "no audio" });
    return;
  }

  try {
    const bytes = Buffer.from(audio, "base64");
    const extension = audioExtension(mime ?? "");
    const wyoming = wyomingAddress(config.sttModel);

    // Wyoming speaks PCM and the app records AAC or Opus, so this path decodes on the way in.
    // See `audio.ts` for why that is `ffmpeg` and not a recording setting.
    if (wyoming) {
      response.json({ text: await transcribe(wyoming, await toPcm(bytes, extension)) });
      return;
    }

    const file = await toFile(bytes, `speech.${extension}`, { type: mime || "audio/webm" });
    const result = await voiceClient(config).audio.transcriptions.create({
      file,
      model: config.sttModel,
    });
    response.json({ text: result.text.trim() });
  } catch (error) {
    failed("transcribe", error, response);
  }
});

/**
 * Text in, audio out.
 *
 * Buffered rather than streamed: a reply is a few seconds of speech and the app plays it as
 * one sound anyway, so passing a stream through would add a failure mode and save nothing.
 */
voice.post("/speak", express.json({ limit: "1mb" }), async (request, response) => {
  const config = loadLlmConfig();
  if (!requireModel(config.ttsModel, "speech", response)) return;

  const { text } = request.body as { text?: string };
  if (!text?.trim()) {
    response.status(400).json({ error: "no text" });
    return;
  }

  try {
    const wyoming = wyomingAddress(config.ttsModel);

    // Nothing to transcode in this direction: Piper hands back samples, and 44 bytes of
    // header is the whole difference between those and a file the app can play.
    if (wyoming) {
      const { pcm, ...format } = await synthesize(
        wyoming,
        spokenChunk(text, MAX_SPEECH),
        config.ttsVoice,
      );
      const file = wav(pcm, format);
      response.setHeader("Content-Type", "audio/wav");
      response.setHeader("Content-Length", file.byteLength);
      response.send(file);
      return;
    }

    const spoken = await voiceClient(config).audio.speech.create({
      model: config.ttsModel,
      // The API insists on a voice; a server that has only one ignores what it is told.
      voice: config.ttsVoice.trim() || "alloy",
      input: spokenChunk(text, MAX_SPEECH),
    });
    const audio = Buffer.from(await spoken.arrayBuffer());
    response.setHeader("Content-Type", spoken.headers.get("content-type") ?? "audio/mpeg");
    response.setHeader("Content-Length", audio.byteLength);
    response.send(audio);
  } catch (error) {
    failed("speak", error, response);
  }
});
